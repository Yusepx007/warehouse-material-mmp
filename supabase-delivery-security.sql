-- Secure delivery workflow. Run after supabase-schema.sql,
-- supabase-security-hardening.sql, and supabase-delivery-schema.sql.
begin;

alter table public.clients enable row level security;
alter table public.armada enable row level security;
alter table public.delivery_orders enable row level security;
alter table public.do_items enable row level security;
alter table public.gps_locations enable row level security;

do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
    where schemaname='public' and tablename in ('clients','armada','delivery_orders','do_items','gps_locations')
  loop execute format('drop policy %I on %I.%I',p.policyname,p.schemaname,p.tablename); end loop;
end $$;

revoke all on public.clients, public.armada, public.delivery_orders, public.do_items, public.gps_locations from public, anon, authenticated;
grant select on public.clients, public.armada, public.delivery_orders, public.do_items, public.gps_locations to authenticated;
grant insert, update, delete on public.clients, public.armada, public.delivery_orders, public.do_items to authenticated;

create policy "clients_read_own_or_warehouse" on public.clients for select to authenticated
  using (public.is_warehouse_user() or (user_id=auth.uid() and active=true));
create policy "clients_admin_manage" on public.clients for all to authenticated
  using (public.is_warehouse_admin()) with check (public.is_warehouse_admin());
create policy "armada_warehouse_read" on public.armada for select to authenticated
  using (public.is_warehouse_user() or exists(select 1 from public.delivery_orders d join public.clients c on c.id=d.client_id where d.armada_id=armada.id and c.user_id=auth.uid() and c.active=true));
create policy "armada_admin_manage" on public.armada for all to authenticated
  using (public.is_warehouse_admin()) with check (public.is_warehouse_admin());
create policy "do_read_own_client_or_warehouse" on public.delivery_orders for select to authenticated
  using (public.is_warehouse_user() or exists(select 1 from public.clients c where c.id=client_id and c.user_id=auth.uid() and c.active=true));
create policy "do_warehouse_insert" on public.delivery_orders for insert to authenticated
  with check (public.is_warehouse_user() and status='draft');
create policy "do_warehouse_update" on public.delivery_orders for update to authenticated
  using (public.is_warehouse_user() and status<>'delivered')
  with check (public.is_warehouse_user() and status<>'delivered' and (
    status<>'on_the_way' or (
      exists(select 1 from public.do_items i where i.do_id=delivery_orders.id)
      and not exists(select 1 from public.do_items i where i.do_id=delivery_orders.id and (i.status<>'loaded' or i.qty_loaded<>i.qty_ordered))
    )
  ));
create policy "do_warehouse_delete" on public.delivery_orders for delete to authenticated
  using (public.is_warehouse_admin() and status='draft');
create policy "items_read_own_client_or_warehouse" on public.do_items for select to authenticated
  using (public.is_warehouse_user() or exists(select 1 from public.delivery_orders d join public.clients c on c.id=d.client_id where d.id=do_id and c.user_id=auth.uid() and c.active=true));
create policy "items_warehouse_insert_draft" on public.do_items for insert to authenticated
  with check (public.is_warehouse_user() and exists(select 1 from public.delivery_orders d where d.id=do_id and d.status='draft'));
create policy "items_warehouse_update_loading" on public.do_items for update to authenticated
  using (public.is_warehouse_user() and exists(select 1 from public.delivery_orders d where d.id=do_id and d.status='loading'))
  with check (public.is_warehouse_user() and qty_loaded between 0 and qty_ordered and exists(select 1 from public.delivery_orders d where d.id=do_id and d.status='loading'));
create policy "items_admin_delete_draft" on public.do_items for delete to authenticated
  using (public.is_warehouse_admin() and exists(select 1 from public.delivery_orders d where d.id=do_id and d.status='draft'));
create policy "gps_read_own_client_or_warehouse" on public.gps_locations for select to authenticated
  using (public.is_warehouse_user() or exists(select 1 from public.delivery_orders d join public.clients c on c.id=d.client_id where d.id=do_id and c.user_id=auth.uid() and c.active=true));

create or replace function public.driver_get_do(p_token text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'id',d.id,'do_number',d.do_number,'status',d.status,'notes',d.notes,
    'dispatched_at',d.dispatched_at,'arrived_at',d.arrived_at,'delivered_at',d.delivered_at,'returned_at',d.returned_at,
    'client',jsonb_build_object('name',c.name,'address',c.address),
    'armada',jsonb_build_object('name',a.name,'driver_name',a.driver_name,'plate',a.plate),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'part',i.part,'name',i.name,'qty_ordered',i.qty_ordered,'qty_loaded',i.qty_loaded,'status',i.status) order by i.created_at) from public.do_items i where i.do_id=d.id),'[]'::jsonb)
  ) into v from public.delivery_orders d join public.clients c on c.id=d.client_id left join public.armada a on a.id=d.armada_id
  where d.driver_token=p_token;
  return v;
end $$;

create or replace function public.driver_set_status(p_token text,p_status text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_id uuid; v_status text; v_time timestamptz:=now();
begin
  select id,status into v_id,v_status from public.delivery_orders where driver_token=p_token for update;
  if not found then raise exception 'Link driver tidak valid.' using errcode='P0002'; end if;
  if p_status='on_the_way' and v_status='loading' then
    if not exists(select 1 from public.do_items where do_id=v_id)
       or exists(select 1 from public.do_items where do_id=v_id and (status<>'loaded' or qty_loaded<>qty_ordered)) then
      raise exception 'Semua item harus selesai dimuat sebelum armada berangkat.' using errcode='22023';
    end if;
    update public.delivery_orders set status=p_status,dispatched_at=v_time where id=v_id;
  elsif p_status='at_location' and v_status='on_the_way' then
    update public.delivery_orders set status=p_status,arrived_at=v_time where id=v_id;
  elsif p_status='returned' and v_status='at_location' then
    update public.delivery_orders set status=p_status,returned_at=v_time where id=v_id;
  else raise exception 'Perubahan status tidak diizinkan.' using errcode='22023'; end if;
  return public.driver_get_do(p_token);
end $$;

create or replace function public.driver_add_gps(p_token text,p_lat double precision,p_lng double precision,p_accuracy double precision default null)
returns void language plpgsql security definer set search_path=''
as $$
declare v_id uuid; v_armada uuid;
begin
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Koordinat tidak valid.' using errcode='22023'; end if;
  select id,armada_id into v_id,v_armada from public.delivery_orders where driver_token=p_token and status='on_the_way';
  if not found then raise exception 'Tracking hanya tersedia saat perjalanan.' using errcode='22023'; end if;
  insert into public.gps_locations(do_id,armada_id,lat,lng,accuracy) values(v_id,v_armada,p_lat,p_lng,p_accuracy);
end $$;

create or replace function public.confirm_delivery_received(p_do_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_client uuid; v_item record; v_material public.materials%rowtype; v_after integer; v_email text:=auth.jwt()->>'email';
begin
  select client_id into v_client from public.delivery_orders where id=p_do_id and status='at_location' for update;
  if not found then raise exception 'DO tidak tersedia untuk konfirmasi penerimaan.' using errcode='22023'; end if;
  if not public.is_warehouse_user() and not exists(select 1 from public.clients where id=v_client and user_id=auth.uid() and active=true) then
    raise exception 'Client atau petugas gudang tidak berhak mengonfirmasi DO ini.' using errcode='42501';
  end if;
  if not exists(select 1 from public.do_items where do_id=p_do_id)
     or exists(select 1 from public.do_items where do_id=p_do_id and (status<>'loaded' or qty_loaded<>qty_ordered)) then
    raise exception 'Semua item harus selesai dimuat sebelum penerimaan dikonfirmasi.' using errcode='22023';
  end if;
  for v_item in select material_id,qty_loaded from public.do_items where do_id=p_do_id and qty_loaded>0 order by material_id loop
    if v_item.material_id is not null then
      select * into v_material from public.materials where id=v_item.material_id and active=true for update;
      if not found or v_material.qty<v_item.qty_loaded then raise exception 'Stok tidak cukup untuk menyelesaikan DO.' using errcode='22023'; end if;
      v_after:=v_material.qty-v_item.qty_loaded;
      update public.materials set qty=v_after,updated_at=now() where id=v_item.material_id;
      insert into public.transactions(material_id,part,name,type,qty,before,after,user_email,note)
        values(v_item.material_id,v_material.part,v_material.name,'out',v_item.qty_loaded,v_material.qty,v_after,coalesce(v_email,'client'), 'DO diterima: '||p_do_id::text);
    end if;
  end loop;
  update public.delivery_orders set status='delivered',delivered_at=now() where id=p_do_id;
end $$;

revoke all on function public.driver_get_do(text) from public,authenticated;
revoke all on function public.driver_set_status(text,text) from public,authenticated;
revoke all on function public.driver_add_gps(text,double precision,double precision,double precision) from public,authenticated;
grant execute on function public.driver_get_do(text) to anon;
grant execute on function public.driver_set_status(text,text) to anon;
grant execute on function public.driver_add_gps(text,double precision,double precision,double precision) to anon;
revoke all on function public.confirm_delivery_received(uuid) from public,anon;
grant execute on function public.confirm_delivery_received(uuid) to authenticated;

commit;
