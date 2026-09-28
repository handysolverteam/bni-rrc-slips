-- Reset imported slips data so XLS files can be re-imported from scratch.
-- Keeps members, weeks and chat history (re-import re-links to them by
-- name/date instead of duplicating them).
DELETE FROM public.slip_referrals;
DELETE FROM public.slip_one_to_ones;
DELETE FROM public.slip_tyfcb;
DELETE FROM public.slip_visitors;
DELETE FROM public.slip_ceus;
DELETE FROM public.import_batches;

-- Verify: every count below should be 0.
SELECT 'referrals' AS t, COUNT(*) FROM public.slip_referrals
UNION ALL SELECT 'one_to_ones', COUNT(*) FROM public.slip_one_to_ones
UNION ALL SELECT 'tyfcb', COUNT(*) FROM public.slip_tyfcb
UNION ALL SELECT 'visitors', COUNT(*) FROM public.slip_visitors
UNION ALL SELECT 'ceus', COUNT(*) FROM public.slip_ceus
UNION ALL SELECT 'import_batches', COUNT(*) FROM public.import_batches;
