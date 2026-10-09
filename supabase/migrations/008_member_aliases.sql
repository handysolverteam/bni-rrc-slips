-- ============================================================
-- 008: remembered member merges ("same person, spelled differently").
-- Run in the Supabase SQL editor (no DATABASE_URL on the dev machine).
--
-- When two spellings of one person are merged ("Amit K Bahl" -> "Amit Bahl"),
-- the app stores the spelling that was merged away here. Every later import
-- (slips + PALMS) maps that spelling to the canonical name BEFORE anything is
-- created, so the merge never has to be asked for again.
--
-- Safe to run more than once. Not touched by supabase/reset_slips_data.sql
-- (learned merges survive a data wipe).
-- ============================================================
create table if not exists public.member_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- lower-cased, whitespace-collapsed spelling that is merged away
  alias_key text not null,
  -- the spelling as it was typed (display / audit)
  alias_name text not null,
  -- the name every import now uses for this person
  canonical_name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists member_aliases_tenant_alias_uq
  on public.member_aliases (tenant_id, alias_key);

-- Server-only data (service role bypasses RLS), same as tenants.
alter table public.member_aliases enable row level security;
