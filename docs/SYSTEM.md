# SYSTEM — BNI Week Slips

## Entities
- `members(id uuid, name text unique-ci, category text null, phone text null, email text null, company text null, is_inactive bool default false, created_at)`
- `bni_weeks(id uuid, label text unique e.g. "7 January 2026 (Week 2)", meeting_date date unique, week_no int, created_at)`
- `slip_referrals(id, bni_week_id fk, from_member_id fk null, to_member_id fk null, from_name text, to_name text, other_chapter_member text null, inside_outside text null check Inside/Outside, import_batch_id fk, created_at)`
  - Keep both fk + raw names so other-chapter / deleted members never break display.
- `slip_one_to_ones` — same shape, fields `initiated_by_*`, `met_with_*`, `photo_proof bool default false`, `gains_shared bool default false`.
- `slip_tyfcb(id, bni_week_id fk, member_id fk null, member_name text, amount numeric, other_chapter_member text null, import_batch_id fk)`
- `slip_visitors(id, bni_week_id fk, full_name text, company/email/phone null, invited_by_member_id fk null, invited_by_name text, attending bool default false, ...)`
- `slip_ceus(id, bni_week_id fk, member_id fk null, member_name text, credits numeric)`
- `import_batches(id, filename, bni_week_id fk null, imported_count, skipped_count, status, error_message, created_at)`

Name matching: case-insensitive trim; auto-create member if missing. `from_is_other_chapter/to_is_other_chapter bool default false` reserved for future bold parsing (unused in MVP).

## Actions / APIs
- `POST /api/import/report` (multipart: `file` only — the week comes from the file's title row).
  1. Validate ext `.xls/.xlsx/.csv`, size < 10MB.
  2. Parse via `xlsx` (`lib/report-import.ts: parseReportFile`): header row must contain From/To/Slip Type (others optional).
  3. Upsert `bni_weeks` by label; create `import_batches` row.
  4. Classify all rows in memory, preload members (1 select) + bulk-insert the missing (1 insert), then bulk-insert slips per table after filtering out duplicates already stored for the week (~10 HTTP calls total).
  5. Update batch counts, return JSON.
- `GET /api/weeks` → `{ weeks: [{ id, label, meeting_date }] }` (newest first), drives the week filter + import week picker.
- `GET /api/<resource>?week=&q=&page=&pageSize=` for each of members/referrals/one-to-ones/visitors/tyfcb → `{ rows, total }` read-only.
- Weeks: chapter meets every **Wednesday** (`lib/weeks.ts`). Import date picker snaps to the Wednesday of the chosen week; label auto-builds as `D Month YYYY (Week ISO-week)` (e.g. `7 January 2026 (Week 2)`). Labels are date-derived so renumbering never invalidates them. List screens filter by `bni_weeks` via a dropdown (`?week=<id>`).
- Pages are server components fetching via Supabase server client with pagination (default 100, max 150).

## Validation / errors
- Missing headers → 400. Unknown slip type / empty both From+To → skip + collect in `errors[]` (max 50 returned).
- Duplicate slip (same week + same from/to/amount/detail) → skip via unique index, counted as skipped.
