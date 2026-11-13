-- Apply this migration in the Supabase SQL Editor before deploying the RPC-based client.
-- It is safe to re-run. The allow-listed administrator email must match the app account.

begin;

alter table public.materials enable row level security;
alter table public.transactions enable row level security;

-- Refuse to create case-insensitive uniqueness if existing data already conflicts.
do $$
begin
  if exists (
    select lower(part)
    from public.materials
    group by lower(part)
    having count(*) > 1
  ) then
    raise exception 'Duplicate material part numbers ignoring case must be resolved first.';
  end if;
end;
$$;

create unique index if not exists materials_part_case_insensitive_uidx
  on public.materials (lower(part));
create index if not exists materials_updated_at_idx
  on public.materials (updated_at desc);
create index if not exists transactions_created_at_idx
  on public.transactions (created_at desc);
create index if not exists transactions_material_created_at_idx
  on public.transactions (material_id, created_at desc);

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
create table if not exists app_private.warehouse_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'operator')),
  created_at timestamptz not null default now()
);
alter table app_private.warehouse_roles enable row level security;
revoke all on app_private.warehouse_roles from public, anon, authenticated;

-- Bind roles to existing Auth user IDs, not to a client-controlled UI value.
insert into app_private.warehouse_roles(user_id, role)
select id, case lower(email)
  when 'admin@mmp.local' then 'admin'
  else 'operator'
end
from auth.users
where lower(email) in ('admin@mmp.local', 'operator@mmp.local')
on conflict (user_id) do update set role = excluded.role;

do $$
begin
  if not exists (select 1 from app_private.warehouse_roles where role = 'admin') then
    raise exception 'Auth account admin@mmp.local must exist before applying this migration.';
  end if;
end;
$$;

create or replace function public.is_warehouse_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from app_private.warehouse_roles where user_id = auth.uid()
  )
$$;

create or replace function public.is_warehouse_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from app_private.warehouse_roles
    where user_id = auth.uid() and role = 'admin'
  )
$$;

revoke all on function public.is_warehouse_user() from public, anon;
grant execute on function public.is_warehouse_user() to authenticated;
revoke all on function public.is_warehouse_admin() from public, anon;
grant execute on function public.is_warehouse_admin() to authenticated;

-- Replace all prior policies on these app-owned tables with the intended ones.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('materials', 'transactions')
      and cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end;
$$;

-- Recreate the intended read-only policy after clearing old write policies.
create policy "Warehouse users can read materials"
  on public.materials for select to authenticated
  using (public.is_warehouse_user());
create policy "Warehouse users can read transactions"
  on public.transactions for select to authenticated
  using (public.is_warehouse_user());

-- Table writes are only available through the checked, atomic functions below.
revoke all on public.materials, public.transactions from public, anon, authenticated;
grant select on public.materials, public.transactions to authenticated;

create or replace function public.admin_create_material(
  p_part text,
  p_name text,
  p_qty integer,
  p_min integer,
  p_description text,
  p_image text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_email text := auth.jwt() ->> 'email';
begin
  if auth.uid() is null or not public.is_warehouse_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_part is null or length(btrim(p_part)) not between 1 and 100
     or p_name is null or length(btrim(p_name)) not between 1 and 200
     or p_qty is null or p_qty < 0
     or p_min is null or p_min < 0
     or length(coalesce(p_description, '')) > 2000 then
    raise exception 'Material fields are invalid.' using errcode = '22023';
  end if;
  if p_image is not null and (
    length(p_image) > 1400000
    or p_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
  ) then
    raise exception 'Image must be a JPEG, PNG, or WEBP under 1 MB.' using errcode = '22023';
  end if;

  insert into public.materials(part, name, qty, min, description, image)
  values (btrim(p_part), btrim(p_name), p_qty, p_min, coalesce(p_description, ''), p_image)
  returning id into v_id;

  insert into public.transactions(material_id, part, name, type, qty, before, after, user_email, note)
  values (v_id, btrim(p_part), btrim(p_name), 'adjustment', p_qty, 0, p_qty, v_email, 'Material ditambahkan');
  return v_id;
end;
$$;

create or replace function public.admin_update_material(
  p_material_id uuid,
  p_part text,
  p_name text,
  p_min integer,
  p_description text,
  p_image text,
  p_image_changed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_material public.materials%rowtype;
  v_email text := auth.jwt() ->> 'email';
begin
  if auth.uid() is null or not public.is_warehouse_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_part is null or length(btrim(p_part)) not between 1 and 100
     or p_name is null or length(btrim(p_name)) not between 1 and 200
     or p_min is null or p_min < 0
     or length(coalesce(p_description, '')) > 2000 then
    raise exception 'Material fields are invalid.' using errcode = '22023';
  end if;
  if coalesce(p_image_changed, false) and p_image is not null and (
    length(p_image) > 1400000
    or p_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
  ) then
    raise exception 'Image must be a JPEG, PNG, or WEBP under 1 MB.' using errcode = '22023';
  end if;

  select * into v_material from public.materials where id = p_material_id for update;
  if not found then
    raise exception 'Material not found.' using errcode = 'P0002';
  end if;

  update public.materials
  set part = btrim(p_part), name = btrim(p_name), min = p_min,
      description = coalesce(p_description, ''),
      image = case when coalesce(p_image_changed, false) then p_image else v_material.image end,
      updated_at = now()
  where id = p_material_id;

  insert into public.transactions(material_id, part, name, type, qty, before, after, user_email, note)
  values (p_material_id, btrim(p_part), btrim(p_name), 'adjustment', 0,
          v_material.qty, v_material.qty, v_email, 'Data material diperbarui');
end;
$$;

create or replace function public.admin_adjust_stock(
  p_material_id uuid,
  p_new_qty integer,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_material public.materials%rowtype;
  v_email text := auth.jwt() ->> 'email';
begin
  if auth.uid() is null or not public.is_warehouse_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_new_qty is null or p_new_qty < 0
     or p_note is null or length(btrim(p_note)) not between 10 and 500 then
    raise exception 'Quantity or adjustment note is invalid.' using errcode = '22023';
  end if;

  select * into v_material from public.materials where id = p_material_id for update;
  if not found then
    raise exception 'Material not found.' using errcode = 'P0002';
  end if;
  update public.materials set qty = p_new_qty, updated_at = now() where id = p_material_id;
  insert into public.transactions(material_id, part, name, type, qty, before, after, user_email, note)
  values (p_material_id, v_material.part, v_material.name, 'adjustment',
          abs(p_new_qty - v_material.qty), v_material.qty, p_new_qty, v_email, btrim(p_note));
end;
$$;

create or replace function public.record_stock_transaction(
  p_material_id uuid,
  p_type text,
  p_qty integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_material public.materials%rowtype;
  v_after integer;
  v_email text := auth.jwt() ->> 'email';
begin
  if not public.is_warehouse_user() then
    raise exception 'Warehouse account required.' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('in', 'out') or p_qty is null or p_qty not between 1 and 100000 then
    raise exception 'Transaction type or quantity is invalid.' using errcode = '22023';
  end if;

  select * into v_material from public.materials
  where id = p_material_id and active = true for update;
  if not found then
    raise exception 'Active material not found.' using errcode = 'P0002';
  end if;
  if p_type = 'out' and p_qty > v_material.qty then
    raise exception 'Insufficient stock.' using errcode = '22023';
  end if;
  if p_type = 'in' and v_material.qty > 2147483647 - p_qty then
    raise exception 'Stock exceeds the supported integer range.' using errcode = '22003';
  end if;
  v_after := case when p_type = 'in' then v_material.qty + p_qty else v_material.qty - p_qty end;

  update public.materials set qty = v_after, updated_at = now() where id = p_material_id;
  insert into public.transactions(material_id, part, name, type, qty, before, after, user_email)
  values (p_material_id, v_material.part, v_material.name, p_type, p_qty,
          v_material.qty, v_after, v_email);
end;
$$;

create or replace function public.admin_deactivate_material(p_material_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_material public.materials%rowtype;
  v_email text := auth.jwt() ->> 'email';
begin
  if auth.uid() is null or not public.is_warehouse_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  select * into v_material from public.materials where id = p_material_id for update;
  if not found then
    raise exception 'Material not found.' using errcode = 'P0002';
  end if;
  if not v_material.active then
    raise exception 'Material is already inactive.' using errcode = '22023';
  end if;
  update public.materials set active = false, updated_at = now() where id = p_material_id;
  insert into public.transactions(material_id, part, name, type, qty, before, after, user_email, note)
  values (p_material_id, v_material.part, v_material.name, 'adjustment', 0,
          v_material.qty, v_material.qty, v_email, 'Material dinonaktifkan');
end;
$$;

revoke all on function public.admin_create_material(text, text, integer, integer, text, text) from public, anon;
revoke all on function public.admin_update_material(uuid, text, text, integer, text, text, boolean) from public, anon;
revoke all on function public.admin_adjust_stock(uuid, integer, text) from public, anon;
revoke all on function public.record_stock_transaction(uuid, text, integer) from public, anon;
revoke all on function public.admin_deactivate_material(uuid) from public, anon;
grant execute on function public.admin_create_material(text, text, integer, integer, text, text) to authenticated;
grant execute on function public.admin_update_material(uuid, text, text, integer, text, text, boolean) to authenticated;
grant execute on function public.admin_adjust_stock(uuid, integer, text) to authenticated;
grant execute on function public.record_stock_transaction(uuid, text, integer) to authenticated;
grant execute on function public.admin_deactivate_material(uuid) to authenticated;

commit;
