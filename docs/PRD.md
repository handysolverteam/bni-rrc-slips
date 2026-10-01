# PRD — BNI Week Slips (MVP)

## Purpose
Import a weekly BNI `Report` XLS (columns: From, To, Slip Type, Inside/Outside, TYFCB, CEU Credits, Detail) and browse it in 6 read-only screens matching the legacy app.

## Core workflow (MVP only)
1. User opens `/import` and selects the `.xls/.xlsx` Report file. The meeting week is read from the file's title row (e.g. `Slips Audit Report for 01/04/2026`).
2. App POSTs the file to `/api/import/report`.
3. Server parses, upserts members/weeks, inserts slips, returns `{ imported, skipped, errors }`.
4. User browses 6 read-only paginated screens:
   - `/members` — Bni Member (Name, Chapter, Category, Company, Phone — Category/Company/Phone are empty placeholders until CRUD)
   - `/referrals` — Slip Referrals (BNI Week, Referral From, Referral To, Other Member's Chapter, Inside/Outside)
   - `/one-to-ones` — Slip 121 (BNI Week, Initiated By, Met With, Other Member's Chapter, Photo Proof, Gains Shared)
   - `/visitors` — Slip Visitors (Full Name, Company, Invited By, BNI Week, Email, Phone, Attending, etc.)
   - `/tyfcb` — Slip TYFCB (BNI Week, BNI Member, Amount, Thanking Member's Chapter)
   - `/ceus` — Slip CEU (BNI Week, BNI Member, CEU Credits)
   - `/report` — Week Report: one section/tab per slip type (One-to-One, Referrals, TYFCB, Visitors, CEU) with filters and xlsx/csv/pdf export.

No CRUD in MVP. CRUD later.

## XLS mapping assumptions (explicit — bold not readable by `xlsx`)
Source columns: `From | To | Slip Type | Inside/Outside | TYFCB | CEU Credits | Detail`.

- `Slip Type` values handled: `One-to-One`, `Referral`, `TYFCB`, `Visitor`, `CEU` (case-insensitive, trimmed). Unknown/blank → skipped + reported.
- `Inside/Outside`: `Tier 1 (inside)` → `Inside`, `Tier 2 (outside)` → `Outside` (also accepts plain `inside/outside/1/2`). TYFCB rows leave this blank in source → stored NULL.
- `Detail`: the chapter of the BOLD name on that row — blank Detail → home/influencer chapter. Displayed as Other Member's Chapter text on the slip for display.
- **Bold rule (confirmed)**: a BOLD name belongs to a DIFFERENT chapter; the Detail column describes that bold person's chapter. Non-bold names are same-chapter members and are the only ones added to the member master. Implemented for `.xlsx` via ExcelJS (`lib/report-bold.ts`): bold From/To set `from/to_is_other_chapter` and skip member creation (name text is still stored on the slip). Legacy `.xls`/`.csv` carry no formatting info — save as `.xlsx` to preserve bold.
- `Referral`: From → `referral_from`, To → `referral_to`.
- `One-to-One`: From → `initiated_by`, To → `met_with`. Counting rule: a meeting with a BOLD (other-chapter) side counts 1; a meeting between two home members counts 2 (home card, report stat/badge/grand total, chat total). Lists and exports still show one row per slip.
- `TYFCB`: From is normally blank — the anonymous thanker. To = member being thanked, always home (even if bold; the bold flag is kept for display). Detail names the anonymous thanker's other chapter. A named non-bold thanker files home; a bold one is skipped.
- `Visitor`: From = Invited By (sponsor), To = visitor full name. Company/Email/Phone not in Report XLS → NULL placeholders for now.
- `CEU`: From = member, CEU Credits = credits (meetings attended). Stored in `slip_ceus`; shown on `/ceus` and as the Report CEU section/tab. The attendee always files HOME — the bold rule does not apply to CEU rows.
- Member master: one row per (name, chapter) — the same name may belong to multiple chapters (as member, visitor, referral party, …) and is never merged across them. Bold names file into their Detail chapter; all other names file into home. The existing row for that chapter is reused; existing rows are never moved. Visitor full names are never added (only non-bold inviters).

## Success criteria
- Upload Report XLS + week → rows appear in correct 6 screens with pagination (150/page default like screenshots).
- Every file entry is correct: duplicate entries (identical rows, or re-importing the same week) are imported as-is — nothing is skipped for being a duplicate (`supabase/migrations/003_allow_duplicate_slips.sql` drops the per-week dedupe indexes). Only typing mistakes (unknown Slip Type, missing From/To, a number instead of a name) pause the import with a confirmation dialog; those rows are skipped only after the user agrees.
- `npm run build` passes.

## Out of scope (MVP)
- Inline Add/Edit/Delete, photo uploads, toggles, auth/roles, dashboards, CEU/Visitor enrichment.
