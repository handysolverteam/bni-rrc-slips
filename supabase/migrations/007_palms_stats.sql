-- ============================================================
-- 007: PALMS comparison stats (PALMS vs slips data check).
-- Run AFTER 006_attendance.sql.  Run ONCE in the Supabase SQL editor.
--
-- Stores the TOTALS ROW of BNI's Chapter Summary PALMS Report
-- (.xls) per meeting week: the counts PALMS itself reports for
-- RGI / RGO / RRI / RRO / V / 1-2-1 / TYFCB / CEU.
-- The app compares these against its own slip-derived counts
-- (same rules as the report cards) and warns on any mismatch.
--
-- One row per (tenant, meeting week); a re-import replaces it.
-- ============================================================

create table if not exists public.palms_stats (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bni_week_id uuid not null references public.bni_weeks(id) on delete cascade,
  rgi int not null default 0,
  rgo int not null default 0,
  rri int not null default 0,
  rro int not null default 0,
  visitors int not null default 0,
  one_to_ones int not null default 0,
  tyfcb bigint not null default 0,
  ceu int not null default 0,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, bni_week_id)
);

-- Server-only data: RLS on, NO public policies (the server client uses
-- the service role, which bypasses RLS — same as member_attendance).
alter table public.palms_stats enable row level security;
