-- ============================================================
-- 002: chapters master + chapter-aware members.
-- Run AFTER 001_schema.sql and BEFORE seed.sql
-- (the seed relies on the home-chapter column default below).
--
-- IMPORTANT: the home-chapter literal below must match your
-- NEXT_PUBLIC_CHAPTER_NAME (the app falls back to 'BNI Influencers'
-- when that env var is empty). If your home chapter has a
-- different name, replace 'BNI Influencers' below before running.
-- ============================================================

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
create unique index chapters_name_unique on public.chapters (lower(name));

alter table public.chapters enable row level security;
create policy "public read chapters" on public.chapters for select using (true);

-- Home chapter row (idempotent; fixed id so it can be the column default).
insert into public.chapters (id, name)
values ('c1000000-0000-4000-8000-000000000001', 'BNI Influencers')
on conflict (id) do nothing;

-- Every member belongs to exactly one chapter.
alter table public.members
  add column chapter_id uuid references public.chapters(id) on delete restrict;

-- Backfill pre-chapter members into the home chapter, then default new
-- rows (e.g. seed.sql, which omits the column) to it as well.
update public.members
set chapter_id = 'c1000000-0000-4000-8000-000000000001'
where chapter_id is null;

alter table public.members
  alter column chapter_id set default 'c1000000-0000-4000-8000-000000000001';
alter table public.members alter column chapter_id set not null;

-- Same name may exist in different chapters, but only once per chapter.
drop index if exists public.members_name_unique;
create unique index members_name_chapter_unique
  on public.members (lower(name), chapter_id);
