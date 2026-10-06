# PRD — BNI Week Slips (MVP)

## Purpose
Import a weekly BNI `Report` XLS (columns: From, To, Slip Type, Inside/Outside, TYFCB, CEU Credits, Detail) and browse it in 6 read-only screens matching the legacy app.

## Core workflow (MVP only)
1. User opens `/import` and selects the `.xls/.xlsx` Report file. The meeting week is read from the file's title row (e.g. `Slips Audit Report for 01/04/2026`).
2. App POSTs the file to `/api/import/report`.
3. Server parses, upserts members/weeks, inserts slips, returns `{ imported, skipped, errors }`.
4. User browses 6 read-only paginated screens:
   - `/members` — Bni Member (Active, Name, Chapter, Category, Company, Phone — Category/Company/Phone are empty placeholders until CRUD; the Active column is the active/inactive toggle). The header shows the **active/inactive counts** under the title plus an **Active checkbox filter** (`?active=1`) that lists only active members.
   - `/referrals` — Slip Referrals (BNI Week, Referral From, Referral To, Other Member's Chapter, Inside/Outside)
   - `/one-to-ones` — Slip 121 (BNI Week, Initiated By, Met With, Other Member's Chapter, Photo Proof, Gains Shared)
   - `/visitors` — Slip Visitors (Full Name, Company, Invited By, BNI Week, Email, Phone, Attending, etc.)
   - `/tyfcb` — Slip TYFCB (BNI Week, BNI Member, Amount, Thanking Member's Chapter)
   - `/ceus` — Slip CEU (BNI Week, BNI Member, CEU Credits)
   - `/report` — Week Report: one section/tab per slip type (One-to-One, Referrals, TYFCB, Visitors, CEU) with filters and xlsx/csv/pdf export. Stat cards: Referral shows the given count (RGI+RGO) with RGI/RGO/RRI/RRO chips; CEU shows distinct members + CEU credits. Every export opens with a **Summary block that mirrors those stat cards** — same counts, same chip/member lines — so the files show what the screen shows. The xlsx and pdf exports print **bold (other-chapter) names in bold exactly like the screen tables** (CSV stays plain text). The page head also carries the **Chapter Summary PALMS upload panel** (two-step, see below).
   - `/summary` — Chapter Summary: one row per member with P A L M S (attendance, from the PALMS import) + RGI RGO RRI RRO, V, 1-2-1, TYFCB, CEU, T (computed from slips) + Total row. Shows the PALMS upload panel, data-health warnings (only when something is wrong), the PALMS-vs-slips comparison table for the selected week(s) at the bottom, and the same Export switch as `/report` (xlsx/csv/pdf) in the page head.

No CRUD in MVP. CRUD later.

## Chapter Summary (PALMS attendance)
- **Attendance cannot be derived from slips** (a member may be Present with zero slips and file slips while absent) — `P/A/L/M/S/T` come from BNI's own `Chapter Summary PALMS Report` (.xls, columns First Name…T, `From:`/`To:` = the single meeting date).
- Second upload panel on `/import` → `POST /api/import/palms`; one row per member stored in `member_attendance` for that week. **Single-meeting files only** (`From = To`); the meeting date must be on the chapter's Wednesday calendar (`bni_weeks`). **Either file can be imported first** — slips and the PALMS summary are independent; when the *other* file for that meeting is not imported yet, the upload still succeeds and the screen shows a red **"… not imported yet"** notice naming the missing file (never a blocked import). Re-importing a week replaces its attendance rows; file rows `Visitors`, `BNI`, `Total` are not members and are skipped. **Two-step upload everywhere**: picking a file never imports it by itself — the panel shows the selected file and an explicit **Import** button that starts the import.
- `/summary` joins that attendance with slip-derived per-member counts (same home/bold and owner-count rules as the report), so the Total row always agrees with the report cards.
- **Import from every relevant screen**: `/import`, `/summary` **and** `/report` carry the same two-step PALMS upload panel, so a re-import updates the table, cards and comparison immediately.
- **Remove an import**: the Import screen's history table has a **Delete** action per uploaded file (confirm dialog) that removes the import record **and every row that import created** — its slips, or for a PALMS file its attendance + comparison stats. The Chapter Summary screen carries the same removal for the selected week: the PALMS panel shows which file was imported (filename + date) and a **Remove PALMS summary** action that drops that week's attendance and comparison — the slips import stays. The history itself is **split into two tables** — one for Slips Audit Report imports, one for Chapter Summary PALMS imports — each with its own date/week filters and Delete action.
- **PALMS vs slips comparison**: the PALMS file's own `Total` row (RGI, RGO, RRI, RRO, V, 1-2-1, TYFCB, CEU) is stored per week in `palms_stats` and compared with the counts computed from the imported slips for that same week. All match → nothing is shown (warnings only); any mismatch → a warning banner naming the week, metric, PALMS value and slips value. `/summary` also shows the side-by-side comparison table (metric | PALMS | Slips | status) at the bottom of the screen, below the member table.
- **Export**: the page head carries the same Export switch as `/report` — `xlsx`, `csv` or `pdf` of the member table with its Total row (cells match the screen: `–` for missing attendance, en-IN TYFCB). The PALMS-vs-slips comparison table and the mismatch warnings are **screen-only** — they stay on `/summary` but are not part of the exported files.

## Data health warnings (`/report` and `/summary`)
- **Missing meeting files**: chapter meets every Wednesday. For every Wednesday between the first imported meeting and today, the app checks that the tenant has an imported slips file; any gap (a skipped week, or a Wednesday that has passed with no file imported yet) is shown as a warning banner listing the dates.
- **PALMS mismatch**: the PALMS-vs-slips comparison above also runs on `/report` for the selected week scope — any week whose stored PALMS totals disagree with the slips raises the same warning banner there (and vice versa: both screens always show it). Weeks whose slips are not imported yet are simply not compared (there is nothing to compare against).
- **Not imported yet**: for the selected week scope, any meeting missing its slips file **or** its PALMS summary is listed in a red banner naming the meeting and the missing file ("… not imported yet"). The same notice appears on the Import screen under a freshly uploaded file when the week's *other* file is still missing. Nothing blocks either import order.

## Active / inactive members
- Every member is **active by default** (`members.is_inactive` defaults to false); import never marks anyone inactive, and historical rows stay exactly as imported.
- The `/members` table gets an **Active toggle in the first column, before Name**.
- **Every app user** can mark a member active/inactive in place (no edit page) and **sees inactive members** in the list.
- Marking someone inactive never deletes anything: their slips, chat answers, exports and member row all stay.
- The `/members` header shows `N active · M inactive` under the title (always the unfiltered totals) and an **Active** checkbox filter (`?active=1`) narrows the list to active members only.

## XLS mapping assumptions (explicit — bold not readable by `xlsx`)
Source columns: `From | To | Slip Type | Inside/Outside | TYFCB | CEU Credits | Detail`.

- `Slip Type` values handled: `One-to-One`, `Referral`, `TYFCB`, `Visitor`, `CEU` (case-insensitive, trimmed). Unknown/blank → skipped + reported.
- `Inside/Outside`: `Tier 1 (inside)` → `Inside`, `Tier 2 (outside)` → `Outside` (also accepts plain `inside/outside/1/2`). TYFCB rows leave this blank in source → stored NULL.
- `Detail`: the chapter of the BOLD name on that row — blank Detail → the tenant's home chapter (see Member master rule below). Displayed as Other Member's Chapter text on the slip for display.
- **Bold rule (confirmed)**: a BOLD name belongs to a DIFFERENT chapter; the Detail column describes that bold person's chapter. Non-bold names are same-chapter members and are the only ones added to the member master. Implemented for `.xlsx` via ExcelJS (`lib/report-bold.ts`): bold From/To set `from/to_is_other_chapter` and skip member creation (name text is still stored on the slip). Legacy `.xls`/`.csv` carry no formatting info — save as `.xlsx` to preserve bold.
- `Referral`: From → `referral_from`, To → `referral_to`.
- `One-to-One`: From → `initiated_by`, To → `met_with`. Counting rule: a meeting with a BOLD (other-chapter) side counts 1; a meeting between two home members counts 2 (home card, report stat/badge/grand total, chat total). Lists and exports still show one row per slip.
- `TYFCB`: From is normally blank — the anonymous thanker. To = member being thanked, always home (even if bold; the bold flag is kept for display). Detail names the anonymous thanker's other chapter. A named non-bold thanker files home; a bold one is skipped.
- `Visitor`: From = Invited By (sponsor), To = visitor full name. Company/Email/Phone not in Report XLS → NULL placeholders for now.
- `CEU`: From = member, CEU Credits = credits (meetings attended). Stored in `slip_ceus`; shown on `/ceus` and as the Report CEU section/tab. The attendee always files HOME — the bold rule does not apply to CEU rows.
- Member master: one row per (name, chapter) — the same name may belong to multiple chapters (as member, visitor, referral party, …) and is never merged across them. Bold names file into their Detail chapter (created in Supabase when it does not exist yet); all other names file into the tenant's **home chapter**: the tenant's `home_chapter_name` when configured, else `NEXT_PUBLIC_CHAPTER_NAME` **only for BNI Influencers** (any other chapter never inherits the env chapter), else the tenant's own name. Existing rows for that chapter are reused; existing rows are never moved. Visitor full names are never added (only non-bold inviters).

## Success criteria
- Upload Report XLS + week → rows appear in correct 6 screens with pagination (150/page default like screenshots).
- Upload the PALMS Chapter Summary for a meeting → `/summary` shows that week's P A L M S per member and the slip-derived columns/Total match the report cards.
- PALMS imported for a week → its Total row (V, 1-2-1, TYFCB, CEU, RGI/RGO/RRI/RRO) equals the app's own slip counts for that week; a deliberate difference is surfaced as a mismatch warning on `/summary` **and** `/report`, never hidden.
- A Wednesday between the first imported meeting and today without an imported slips file is listed in a warning banner on `/report` and `/summary`.
- Every file entry is correct: duplicate entries (identical rows, or re-importing the same week) are imported as-is — nothing is skipped for being a duplicate (`supabase/migrations/003_allow_duplicate_slips.sql` drops the per-week dedupe indexes). Only typing mistakes (unknown Slip Type, missing From/To, a number instead of a name) pause the import with a confirmation dialog; those rows are skipped only after the user agrees.
- Deleting an import removes its rows everywhere (6 screens, report, chat totals) while other imports of the same week stay intact; removing a week's PALMS summary empties its attendance/comparison but never touches its slips (both verified by tests).
- Either file can be imported first: PALMS without slips and slips without PALMS both succeed, and the screen that is missing its data shows a red **"… not imported yet"** notice naming the meeting and the missing file — an import is never blocked by the other file's absence.
- Picking a PALMS file never imports it on its own: `/import`, `/summary` and `/report` use a two-step panel (choose file → explicit Import button).
- `/members` shows active/inactive counts under the title with an Active-only checkbox filter; the import history lists Slips Audit Report and Chapter Summary PALMS files in **separate tables**; report xlsx/pdf print bold names in bold like the screen; every "… credits" line reads "… CEU credits".
- `npm run build` passes.

---

# Multi-tenant release (chapter = tenant)

## Purpose
One deployment now serves many BNI chapters. Each chapter is a **tenant** with fully isolated members, slips, imports, reports and chats. Users sign in through the existing Handychapter Google SSO and can belong to several chapters.

## Definitions
- **Tenant** = one BNI chapter (the isolation boundary for all data).
- **Membership** = a signed-in user (Firebase uid) belongs to a tenant. Many-to-many: one user → many tenants, one tenant → many users. Every member of a tenant has the **same** capabilities — there are no roles.
- **Active tenant** = the chapter the app is currently showing; chosen explicitly via the switcher, remembered across visits.
- **Roles: removed** (were `admin` / `member`, migration 005). Every user of a tenant can import, browse, export, toggle members and chat. The unused `tenant_members.role` column stays in the database so roles can be re-applied later; nothing reads it.

## Core workflow
1. User signs in as today (Google SSO on `/login`).
2. App looks up the user's memberships.
   - **No memberships** → the **Home Chapter is granted automatically on first sign-in** (sign-in stays open to everyone — no SQL, no admin UI). The "No chapter access" screen with uid + SQL appears only when that auto-grant fails, e.g. the Home Chapter `tenants` row is missing.
   - **One membership** → that tenant is active automatically.
   - **Several memberships** → last active tenant is restored; otherwise the first one. A **chapter switcher** in the top nav lists the user's tenants and switches on click.
3. Every screen (6 lists, `/report`, `/import`, `/chat`) and every API call operates ONLY on the active tenant's data: member list, week lists, slip rows, export files, import batches, chat sessions/answers.
4. Import writes members/slips/batches tagged with the active tenant; re-importing the same file into another tenant creates that tenant's own rows (shared nothing).
5. Chat answers only about the active tenant's slips; switching chapter switches the chat history to that chapter's sessions. The suggested-question chips under the composer follow the conversation: after each answer the AI proposes the next questions from what was just discussed (a fresh chat shows the generic starter questions).
6. Chats are **per user**: every user only ever sees their own chat sessions and messages; chapter data remains shared.
7. Unauthenticated API/page access is rejected (401 / redirect to `/login`). A signed-in user can only ever read or write tenants they are a member of.

## Success criteria (multi-tenant)
- **Isolation**: data from two tenants never mixes — member/week/slip/report/import/chat queries are scoped to the active tenant (verified by an isolation test).
- **Auth**: API routes without a valid session return 401; pages redirect to `/login`; a member of tenant A cannot read tenant B even with a hand-crafted request (active-tenant cookie is validated against memberships).
- **Switcher**: switching chapter updates every screen's data, the week filters, and the chat history; the choice survives a reload.
- **Backfill**: all pre-existing data remains visible (it becomes the default tenant), nothing lost, no duplicate rows.
- **Provisioning**: a brand-new Google account is granted the **Home Chapter automatically on first sign-in** — sign-in works for everyone with zero setup (verified by the autogrant test). Adding a user to a *different* chapter stays one SQL insert (no admin UI).
- **Per-user chats**: two users in the same tenant never see each other's chat sessions/messages (verified by the chat suite); chats still stay inside their tenant (isolation test).
- `npm run build` passes and the existing chat/import e2e tests still pass.

## Share a chat to WhatsApp
- From `/chat`, a member can hand a conversation over to WhatsApp — typically to forward an answer to a chapter member who does not use the app.
- Two ways, both opening WhatsApp with the text already written; the member picks the recipient themselves and nothing is sent until they press send in WhatsApp:
  - **Share chat** (chat toolbar) — the whole conversation as a transcript headed by the chat's title, each turn labelled `You:` / `Slips AI:`. The bot's auto-intro line is left out. Ordinary conversations are always shared in full; only a transcript too long for a WhatsApp link (over 20 000 characters, i.e. very long chats) drops its oldest turns, and the toolbar says so **before** sharing ("will send the newest N of M messages").
  - **Share to WhatsApp** (a message's ⋮ menu) — only that one message.
- Sharing is read-only and stays in the browser: nothing is posted, stored or re-sent by the app.

## Out of scope (this release)
- In-app tenant admin (create tenant / invite users in the UI), self-serve signup, RLS policy rework, billing, per-tenant branding/env (the `NEXT_PUBLIC_CHAPTER_NAME` home-chapter rule moves to the tenant record).
- **Roles are deliberately out of scope for now** — every tenant member has full access; roles may be re-applied later (the `role` column is still in the DB).
