-- WIPE (keeps bni_weeks): removes slips, members, chapters, import
-- batches and chat history. The weeks calendar stays untouched;
-- re-import re-links to it by meeting date. Keeps the schema, RLS
-- and policies.
-- Afterwards: re-import files (002 stays applied — never re-run it).
-- NOTE: requires 002_member_chapters.sql already applied (for chapters).
TRUNCATE public.chat_messages,
         public.chat_sessions,
         public.slip_referrals,
         public.slip_one_to_ones,
         public.slip_tyfcb,
         public.slip_visitors,
         public.slip_ceus,
         public.import_batches,
         public.members,
         public.chapters
RESTART IDENTITY CASCADE;

-- Re-seed the home chapter so the database is import-ready immediately
-- (must match NEXT_PUBLIC_CHAPTER_NAME; same id as 002/seed use).
INSERT INTO public.chapters (id, name)
VALUES ('c1000000-0000-4000-8000-000000000001', 'BNI Influencer')
ON CONFLICT (id) DO NOTHING;

-- Verify: every count below should be 0 (bni_weeks keeps its rows).
SELECT 'referrals' AS t, COUNT(*) FROM public.slip_referrals
UNION ALL SELECT 'one_to_ones', COUNT(*) FROM public.slip_one_to_ones
UNION ALL SELECT 'tyfcb', COUNT(*) FROM public.slip_tyfcb
UNION ALL SELECT 'visitors', COUNT(*) FROM public.slip_visitors
UNION ALL SELECT 'ceus', COUNT(*) FROM public.slip_ceus
UNION ALL SELECT 'import_batches', COUNT(*) FROM public.import_batches
UNION ALL SELECT 'members', COUNT(*) FROM public.members
UNION ALL SELECT 'chapters', COUNT(*) FROM public.chapters
UNION ALL SELECT 'chat_sessions', COUNT(*) FROM public.chat_sessions
UNION ALL SELECT 'chat_messages', COUNT(*) FROM public.chat_messages
UNION ALL SELECT 'bni_weeks (kept)', COUNT(*) FROM public.bni_weeks
UNION ALL SELECT 'home_chapter (reseeded, should be 1)', COUNT(*) FROM public.chapters
  WHERE id = 'c1000000-0000-4000-8000-000000000001';
