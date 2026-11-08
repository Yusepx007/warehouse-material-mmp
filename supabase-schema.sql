-- ============================================================
-- WAREHOUSE MATERIAL MMP - Supabase Schema
-- ============================================================

create extension if not exists "uuid-ossp";

create table if not exists public.materials (
  id          uuid primary key default uuid_generate_v4(),
  part        text not null unique,
  name        text not null,
  qty         integer not null default 0,
  min         integer not null default 0,
  description text not null default '',
  active      boolean not null default true,
  image       text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.transactions (
  id          uuid primary key default uuid_generate_v4(),
  material_id uuid references public.materials(id) on delete set null,
  part        text not null,
  name        text not null,
  type        text not null check (type in ('in','out','adjustment')),
  qty         integer not null default 0,
  before      integer not null default 0,
  after       integer not null default 0,
  user_email  text not null,
  note        text,
  created_at  timestamptz not null default now()
);

alter table public.materials enable row level security;
alter table public.transactions enable row level security;

create policy "Authenticated can read materials"
  on public.materials for select
  using (auth.role() = 'authenticated');

create policy "Authenticated can insert materials"
  on public.materials for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update materials"
  on public.materials for update
  using (auth.role() = 'authenticated');

create policy "Authenticated can read transactions"
  on public.transactions for select
  using (auth.role() = 'authenticated');

create policy "Authenticated can insert transactions"
  on public.transactions for insert
  with check (auth.role() = 'authenticated');

insert into public.materials (part, name, qty, min, description) values
  ('43155-KYZ-9000-M', 'Clamper A Brake Hose',    1000, 100, ''),
  ('45156-K0WL-NA01',  'Clamper A Fr Brake Hose',    10, 100, ''),
  ('43158-K3NA-N001',  'Clamper B Brake Hose',        15,  50, ''),
  ('43156-K2P-V600',   'Clamper Rr Brake Hose',     1600, 100, ''),
  ('43155-K84A-9002',  'Clamper RR Brake Hose',     5100, 300, ''),
  ('43157-K0WL-NA02',  'Clamper B Rr Brake Hose',   1000, 100, ''),
  ('43158-K0WL-NA02',  'Clamper C Rr Brake Hose',   8000, 300, ''),
  ('45156-K0JN-N600',  'Clamper A, Brk Hose',       1000, 100, '')
on conflict (part) do nothing;
