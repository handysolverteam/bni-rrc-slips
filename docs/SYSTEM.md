# SYSTEM — BNI Week Slips

## Entities
- `chapters(id uuid, name text unique-ci)`
- `members(id uuid, name text, chapter_id fk chapters, category/phone/email/company null, is_inactive bool default false, ...)` — unique per `(lower(name), chapter_id)`: the same name in different chapters is a different member.
- `bni_weeks(id uuid, label text unique e.g. "7 January 2026 (Week 2)", meeting_date date unique, week_no int, created_at)`
- `slip_referrals(id, bni_week_id fk, from_member_id fk null, to_member_id fk null, from_name text, to_name text, other_chapter_member text null, inside_outside text null check Inside/Outside, import_batch_id fk, created_at)`
  - Keep both fk + raw names so other-chapter / deleted members never break display.
- `slip_one_to_ones` — same shape, fields `initiated_by_*`, `met_with_*`, `photo_proof bool default false`, `gains_shared bool default false`.
- `slip_tyfcb(id, bni_week_id fk, member_id fk null, member_name text, amount numeric, other_chapter_member text null, import_batch_id fk)`
- `slip_visitors(id, bni_week_id fk, full_name text, company/email/phone null, invited_by_member_id fk null, invited_by_name text, attending bool default false, ...)`
- `slip_ceus(id, bni_week_id fk, member_id fk null, member_name text, credits numeric, import_batch_id fk, created_at)`
- `import_batches(id, filename, bni_week_id fk null, imported_count, skipped_count, status, error_message, created_at)`
  - `error_message` = JSON `{ errors: string[], skips: string[] }` — one `skips` entry per dropped row (typing mistakes only; duplicates are never dropped), shown in the Import history dropdown (older rows may be plain text or null).

Name matching: case-insensitive trim, one member row per (name, chapter) — the same name may belong to several chapters and rows are never merged or moved across chapters. Chapter rule: a BOLD name belongs to its Detail chapter; every other name belongs to HOME (`NEXT_PUBLIC_CHAPTER_NAME`, fallback `BNI Influencer`). The row for the wanted chapter is reused when it exists, created otherwise. Detail is also stored as text on the slip. Visitor full names never create members (only a non-bold inviter does). Exceptions: a TYFCB's thanked member and every CEU attendee always file HOME regardless of bold.

## Actions / APIs
- `POST /api/import/report` (multipart: `file` only — the week comes from the file's title row).
  1. Validate ext `.xls/.xlsx/.csv`, size < 10MB.
  2. Parse via `xlsx` (`lib/report-import.ts: parseReportFile`): header row must contain From/To/Slip Type (others optional).
  3. Upsert `bni_weeks` by label; create `import_batches` row.
  4. Classify all rows in memory, preload members (1 select) + bulk-insert the missing (1 insert), then bulk-insert slips per table with NO duplicate filtering — every entry is kept, even identical ones (~10 HTTP calls total).
  5. Update batch counts, return JSON.
- `GET /api/weeks` → `{ weeks: [{ id, label, meeting_date }] }` (newest first), drives the week filter + import week picker.
- `GET /api/<resource>?week=&q=&page=&pageSize=` for each of members/referrals/one-to-ones/visitors/tyfcb/ceus → `{ rows, total }` read-only.
- Report (`/report`, export via `GET /api/report/export?week=&tab=&format=`): sections/tabs One-to-One, Referral, TYFCB, Visitor, CEU. One-to-One stat cards/badge/grand total (home card + chat total too) use the owner count — a bold (other-chapter) side counts 1, both-home counts 2; lists/exports stay one row per slip. Every export (xlsx/csv/pdf, including the in-browser PDF) opens with a **Summary**: week + filters, one row per section (stat-card count + details) and the grand total.
- Weeks: chapter meets every **Wednesday** (`lib/weeks.ts`). Import date picker snaps to the Wednesday of the chosen week; label auto-builds as `D Month YYYY (Week ISO-week)` (e.g. `7 January 2026 (Week 2)`). Labels are date-derived so renumbering never invalidates them. Slip list screens filter the week through the **BNI Week header cell** (`?c_bni_week=<id>|all`, default = latest imported week; `?week=` still works for direct links); the BNI Members screen has no week scope.
- Pages are server components fetching via Supabase server client with pagination (default 100, max 150).

## Validation / errors
- Missing headers → 400. Unknown slip type / empty both From+To → skip + collect in `errors[]` (max 50 returned).
- Duplicate slip (same week + same from/to/amount/detail) → imported too; `supabase/migrations/003_allow_duplicate_slips.sql` drops the per-week unique indexes so no row is ever skipped for being a duplicate.
- Every skipped row (typing mistake) also stores a reason in the batch's `skips` log (cap 1000) — shown per batch in the Import history dropdown. Typing mistakes are the ONLY pause: the preview returns `rowIssues` and the UI asks for permission before importing.
