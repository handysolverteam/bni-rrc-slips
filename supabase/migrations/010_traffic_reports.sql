-- ============================================================
-- 010: Traffic Lights from BNI's own chapter reports.
-- Run AFTER 009. Run ONCE in the Supabase SQL editor.
--
-- Two imported reports feed the Traffic Lights screen:
--   * Chapter Summary PALMS Report  -> traffic_palms_rows   (one row per member for a From..To range)
--   * Chapter Sponsor Report        -> traffic_sponsor_rows (who sponsored whom + application date)
-- A re-import of the same (period_from, period_to) replaces that range's rows.
-- ============================================================

create table if not exists public.traffic_palms_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  member_name text not null,
  p int not null default 0,
  a int not null default 0,
  l int not null default 0,
  m int not null default 0,
  s int not null default 0,
  rgi int not null default 0,
  rgo int not null default 0,
  rri int not null default 0,
  rro int not null default 0,
  visitors int not null default 0,
  one_to_ones int not null default 0,
  tyfcb bigint not null default 0,
  ceu int not null default 0,
  t int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists traffic_palms_rows_uq
  on public.traffic_palms_rows (tenant_id, period_from, period_to, lower(member_name));

create table if not exists public.traffic_sponsor_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  sponsor_name text not null,
  sponsored_name text not null,
  sponsored_chapter text,
  sponsored_region text,
  application_date date,
  created_at timestamptz not null default now()
);
create index if not exists traffic_sponsor_rows_period
  on public.traffic_sponsor_rows (tenant_id, period_from, period_to);

-- Server-only data: RLS on, NO public policies (the server client uses the service role).
alter table public.traffic_palms_rows enable row level security;
alter table public.traffic_sponsor_rows enable row level security;
