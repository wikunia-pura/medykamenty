-- Cutis Production Planner (medykamenty) — Supabase schema
-- Run this once in your Supabase project:
--   SQL Editor → New Query → paste → Run.
-- Safe to re-run: every statement is idempotent.
--
-- Design notes:
-- * One table per entity; the entire entity is stored as JSONB in `data` so
--   the existing TypeScript shape (with nested arrays like stock rows,
--   ingredients, packaging, emails) maps 1:1.
-- * `id` is uuid (string) to match the existing newId() format.
-- * Updated_at is a top-level column for sort/filter; everything else lives
--   inside `data`.

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.suppliers (
  id          uuid        primary key,
  data        jsonb       not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.raw_materials (
  id          uuid        primary key,
  data        jsonb       not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.components (
  id          uuid        primary key,
  data        jsonb       not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.products (
  id          uuid        primary key,
  data        jsonb       not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.stock_snapshots (
  id           uuid        primary key,
  kind         text        not null check (kind in ('raw', 'component')),
  imported_at  timestamptz not null,
  data         jsonb       not null
);

create table if not exists public.production_plans (
  id          uuid        primary key,
  data        jsonb       not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.shortage_reports (
  id           uuid        primary key,
  plan_id      uuid        not null,
  computed_at  timestamptz not null,
  data         jsonb       not null
);

create table if not exists public.email_batches (
  id            uuid        primary key,
  report_id     uuid,
  plan_id       uuid,
  generated_at  timestamptz not null,
  data          jsonb       not null
);

-- ============================================================
-- Indexes (just the ones the app actually orders/filters by)
-- ============================================================

create index if not exists idx_stock_snapshots_kind_time
  on public.stock_snapshots (kind, imported_at desc);

create index if not exists idx_shortage_reports_computed
  on public.shortage_reports (computed_at desc);

create index if not exists idx_email_batches_generated
  on public.email_batches (generated_at desc);

create index if not exists idx_production_plans_updated
  on public.production_plans (updated_at desc);

-- ============================================================
-- Row-Level Security
-- Model: any signed-in user can read/write everything (shared data).
-- Anonymous users have no access.
-- ============================================================

alter table public.suppliers         enable row level security;
alter table public.raw_materials     enable row level security;
alter table public.components        enable row level security;
alter table public.products          enable row level security;
alter table public.stock_snapshots   enable row level security;
alter table public.production_plans  enable row level security;
alter table public.shortage_reports  enable row level security;
alter table public.email_batches     enable row level security;

drop policy if exists "authenticated_all" on public.suppliers;
drop policy if exists "authenticated_all" on public.raw_materials;
drop policy if exists "authenticated_all" on public.components;
drop policy if exists "authenticated_all" on public.products;
drop policy if exists "authenticated_all" on public.stock_snapshots;
drop policy if exists "authenticated_all" on public.production_plans;
drop policy if exists "authenticated_all" on public.shortage_reports;
drop policy if exists "authenticated_all" on public.email_batches;

create policy "authenticated_all" on public.suppliers
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.raw_materials
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.components
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.products
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.stock_snapshots
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.production_plans
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.shortage_reports
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.email_batches
  for all to authenticated using (true) with check (true);
