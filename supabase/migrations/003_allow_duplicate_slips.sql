-- ============================================================
-- 003: allow duplicate slip entries.
-- Owner rule: every row in an imported file is correct. Identical
-- entries and re-imports are all kept — nothing is skipped. Only
-- typing mistakes pause the import (handled in the app). Same-name
-- members may exist in several chapters (see 002), so these per-week
-- slip dedupe indexes would reject legitimate duplicates: drop them.
-- Run in the Supabase Dashboard -> SQL Editor (after 002).
-- ============================================================
drop index if exists public.slip_referrals_dedupe;
drop index if exists public.slip_121_dedupe;
drop index if exists public.slip_tyfcb_dedupe;
drop index if exists public.slip_visitors_dedupe;
