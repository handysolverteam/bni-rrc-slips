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
   The top bar groups these five list screens under one **Slips** dropdown (children: One to One, Referral, Visitors, TYFCB, CEU → the list screens above; the five flat pills are gone). The report entry is labelled **Slip Report** (`/report`), next to **PALMS Report** (`/palms`).
   - `/report` — Week Report: one section/tab per slip type (One-to-One, Referrals, TYFCB, Visitors, CEU) with filters (the week box is a **single-select** of one meeting — its **✕** clears it back to All weeks; chapter-like filters — Other Member's Chapter — are single-select too, name filters stay multi) and xlsx/csv/pdf export. The stacked cards (upload panel, stat cards, controls) always keep a visible gap between them — no card sits flush against the next. Stat cards: Referral shows the given count (RGI+RGO) with RGI/RGO/RRI/RRO chips; CEU shows distinct members + CEU credits. Every export opens with a **Summary block that mirrors those stat cards** — same counts, same chip/member lines — so the files show what the screen shows. The xlsx and pdf exports print **bold (other-chapter) names in bold exactly like the screen tables** (CSV stays plain text). The page also carries the **week-slips upload panel** (the same two-step `ImportPanel` as `/import`, see below), so a re-import updates the cards immediately.
   - `/palms` — **PALMS Report**: the imported PALMS attendance as one row per member × one column per meeting week (single-letter cells `P A M S L`, blank when no cell was imported), covering the last ~6 months of Wednesday meetings in one wide table. Week box = same single-select as `/report` (default **All weeks**), the two-step PALMS upload panel sits above it, and the page head carries the same Export switch (xlsx/csv/pdf) of the visible matrix. **PALMS has no relation to the slips report** — no comparison table, no mismatch banners, no cross "not imported yet" notices anywhere. The old Chapter Summary screen (`/summary`) is removed; the nav entry is **PALMS Report**.
   - **26-week attendance breakdown** (a card below the matrix, independent of the week box): titled **Last 6 Months rolling period (26 weeks): Active members**, it groups the chapter's active members by how many letters they collected in the rolling window (today back 26 weeks): **3+ Absents / 2 Absents / 1 Absent**, then **3+ Medicals / 2 Medicals / 1 Medical**, then **3+ Substitutes / 2 Substitutes / 1 Substitute** (dividers between the three groups). Every bucket shows its member count and the member names alphabetically. Buckets per letter are mutually exclusive (4 absents → only the 3+ bucket), the three letters count independently (one member can appear in several buckets), members marked inactive are excluded (a name with no member row counts as active), and the card only renders when at least one A/M/S letter exists in the window.

## Home dashboard (graphs)
- `/` is a **dashboard**: a page head (`h1` **BNI Week Slips** + a `count-badge` **N active members**, live) replaces the old import hero card — there is no Import box on the home screen; the top nav is the entry point to Import and every list screen. Two charts stack below it, both for the **last 6 months**, **one point per meeting week — the Wednesday of each week** (the shared `bni_weeks` calendar):
- **Rupee sign + multi-week filter (2026-10-08)**: every TYFCB amount (report column + total row + stat card, `/tyfcb` list + its amount filter, Excel/CSV exports) is prefixed with **₹**; the PDF export prints `Rs.` (the built-in PDF font has no ₹ glyph); CSV carries a UTF-8 BOM. There are **two week boxes** on `/report`, `/palms` and the slip list screens: the original **single-select** box for quick filtering and a second **Select multiple weeks** box (click toggles weeks, list stays open, ✕/All clears) for multi-week views and exports — the selection is a comma list in `?week=`, so Export covers every picked week.
- **Report URL + CEU card**: opening `/report` without `?week=` redirects to `/report?week=<latest imported week>` so the address always matches the selected week; the CEU stat card shows **both figures bold** — `4 Members` and `17 CEU credits`.
- **Members default URL**: the **Bni Member** nav item opens `/members?active=1&c_chapter=<home chapter>` (active Home Chapter members); plain `/members` and **Clear all** still show everyone.
- **Top 3 screen (`/top3`, nav item next to Slip Report)**: month-wise **top 3 members** for **TYFCB** (₹ received), **Referrals** (referrals given; other-chapter givers skipped) and **Visitors** (visitors brought), newest month first. A **Months** multi-select filter (`?month=2026-04,2026-06`) shows exactly the picked months; **cleared = the last 6 months**. each month has a green **Send on WhatsApp** button (plus **Share all on WhatsApp**) that opens `wa.me` with the medal-formatted text prefilled — the member picks the recipient and presses send. The card no longer appears on `/report`.
- **Other Chapters screen (`/chapters`, nav item)**: every chapter other than the Home Chapter that has imported members, **largest member count first**; each row is expandable (click) to list all its members A–Z (inactive ones greyed + tagged). **Bni Member** header always shows `N active · M inactive`, even while the Active checkbox filters the rows.
- **Slip import duplicates**: a re-import never inserts a row already stored for that week (unchanged). The import **preview now shows it up front** — "N row(s) already imported and will be skipped; M new row(s) will be imported" — and when a file has nothing new the button reads **Nothing new to import** (no empty import batch is created). Identical rows repeated inside ONE file are still all kept (owner rule).
- **Slip trends — TYFCB axis**: on the **All slips** view (line / area / bar / bubble) TYFCB is plotted as **₹ amounts on a right-hand axis** (₹K / ₹L / ₹Cr labels) while the other slips stay counts on the left; the TYFCB tab is ₹ only. Pie / radar / heat map on All keep counts.
- **PALMS page order + import button**: the *Last 6 Months rolling period (26 weeks): Active members* card sits **above** the week filters; the upload button reads **Reading file…** / **Importing…** while working (no longer "Choose a file to preview").
- **PALMS Report extras**: the attendance matrix card has a **− Collapse / + Expand** toggle (open by default), and the **Last 6 Months rolling period (26 weeks): Active members** card has a green **Send on WhatsApp** button that opens `wa.me` with the non-empty buckets (e.g. `❌ 3+ Absents (2): Neha Goel, Rajiv Gupta`) prefilled.
  - **Home Chapter only (2026-10-08)**: the **N active members** badge counts only active members of the Home Chapter (not members filed under other chapters), and the Attendance chart sums only those members' PALMS rows. Slip trends drop the **Combined** series; the **TYFCB** tab plots the weekly **₹ amount** (compact ₹ K / L / Cr y-axis), every other view stays slip counts.
  - **Attendance** (top): weekly sums of the imported PALMS letters as five series **Present / Absent / Medical / Substitute / Leave** — a week with no imported attendance shows 0. Its combined tab is labelled **All letters**.
  - **Slip Trends** (below): a point is the number of slips imported for that week; a week with no imported file shows 0. The legend lists each series with its 6-month total.
  - **Slip-type tabs sit above the graph**: **All slips** (combined — all 5 slip types shown together plus a **Combined** total series) or one single type (Slip 121, Referrals, TYFCB, Visitors, CEU).
     - **Chart-type picker next to the tabs** re-draws the selected view as **line**, **bar** (default), **area**, **pie**, **bubble**, **radar** or **heat map** — hand-rolled SVG, no chart library, themed through the same `--*-ink` colours as the rest of the app. Pie shows composition **by slip type** on All slips and **by month** on a single type (donut + slice legend); radar spokes are the **months** (one polygon per series); the heat map is a **weeks × series** intensity grid. Every view keeps the legend, the 6-month totals and horizontal scrolling inside the card on phones.

No CRUD in MVP. CRUD later.

## PALMS Report (attendance — its own screen, no relation to slips)
- **Attendance cannot be derived from slips** (a member may be Present with zero slips and file slips while absent) — it comes from BNI's own **`Chapter PALMS Attendance Report`** (.xls/.xlsx), a **wide matrix for the last ~6 months**: header row `First Name | Last Name | Apr 01 | Apr 08 | …` (one column per Wednesday meeting; the year comes from the file's `From:`/`To:` parameter rows), then one row per member with a **single letter per week** — `P` Present, `A` Absent, `M` Medical, `S` Substitute, `L`, blank = no record. The old single-meeting format (`P A L M S T` count columns, `From = To`) is **no longer accepted**.
- **Slips and PALMS are fully independent**: no shared numbers, no comparison of any kind, no "the other file is missing" notices on either screen. Each screen only ever talks about its own file type.
- **Upload panels**: the same two-step `PalmsImportPanel` sits on `/palms` (the data screen) and on `/import` (the import hub) — **picking a file never imports it by itself**: the panel first shows a preview card and only an explicit **Import** button starts the upload.
- **Preview before importing (skip-duplicate info)**: choosing a file runs `POST /api/import/palms/preview`, which resolves every date column to the Wednesday calendar and reports — member count, matched week columns, unknown date columns (skipped with a warning), **new cells vs cells already imported**, a sample of the already-imported `(member, week)` entries that will be **skipped**, and any ignored cells. Import then inserts **only the new cells**: an existing `(member, week)` row is never overwritten or duplicated (the unique index enforces it; re-importing the same file imports nothing and says so).
- **The imported table** (`/palms`): one row per member (sorted by name) × one column per meeting week that has attendance (ascending, header `dd MMM`), cells the colour-coded letters, blank for cells never imported. Week scope defaults to **All weeks**; the week box picks one meeting (single-select).
- **Remove**: with data present the panel shows the last imported file (filename + date) and a **Remove all PALMS data** action (confirm dialog) that drops the chapter's attendance rows, their import batches and the legacy `palms_stats` rows — **slips are never touched**. The Import screen's PALMS history table keeps a per-file **Delete** that removes exactly that file's cells.
- **Import from every relevant screen**: `/palms` and `/import` carry the PALMS upload panel; `/report` carries only the week-slips panel (no PALMS panel, no separate `+ Import files` toolbar button next to Export). Every panel keeps the `− Minimize` / `+ Import files` toggle.
- **History**: the Import screen keeps **two history tables** — Slips Audit Reports and **PALMS Reports** — one batch per uploaded file (a multi-week file stores a batch with no week id), imported/skipped counts with the skipped-entry reasons expandable.
- **Export**: the `/palms` page head keeps the `xlsx` / `csv` / `pdf` switch, exporting the visible matrix (`PALMS Report — <scope>`: Member + week columns + the same letters the screen shows).
- **Explicit assumptions**: a date column not on the chapter's Wednesday calendar is skipped and listed as a warning (never a hard error); letters are matched case-insensitively and any other cell value is ignored + listed as a row issue; members are matched by name only (duplicate names share rows — the app-wide rule); legacy rows written by the old single-meeting import still render — their stored flags are shown as the corresponding letters.

## Data health warnings (`/report` — slips only)
- **Missing meeting files**: chapter meets every Wednesday. For every Wednesday between the first imported meeting and today, the app checks that the tenant has an imported slips file; any gap (a skipped week, or a Wednesday that has passed with no file imported yet) is shown as a warning banner listing the dates.
- **Not imported yet**: for the selected week scope, any meeting missing its **slips** file is listed in a red banner naming the meeting and the missing file. PALMS is never mentioned here — the two reports have no relation, and `/palms` shows no data-health banners at all.

## Active / inactive members
- Every member is **active by default** (`members.is_inactive` defaults to false); import never marks anyone inactive, and historical rows stay exactly as imported.
- The `/members` table gets an **Active toggle in the first column, before Name**.
- **Every app user** can mark a member active/inactive in place (no edit page) and **sees inactive members** in the list.
- Marking someone inactive never deletes anything: their slips, chat answers, exports and member row all stay.
- The `/members` header shows `N active · M inactive` under the title **following the current filters** (search, chapter and column filters narrow the counts too); with the **Active** checkbox filter (`?active=1`) on, the line shows `N active` only, and the list is narrowed to active members.

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

## Responsive layout (mobile + tablet)
Every screen stays usable on a phone (≤640px) and an iPad (≤1024px) with **no page-level horizontal scrolling**:
- Top bar: on tablets the BNI badge + scrolling link pills stay; on phones the pills are replaced by a **hamburger drawer** — tap the ☰ button to slide the menu in (close by tapping a link, tapping the overlay, pressing Escape, or on any navigation; the drawer also shuts itself if the viewport grows back to desktop width). The chapter switcher and Sign out stay visible in the bar. The **Slips** dropdown opens as a floating menu under the pill on desktop and as an accordion inside the drawer on phones.
- Toolbars, filter forms, export switches and dialogs **wrap to multiple lines**; the week/filter combos go full width instead of their desktop min-widths.
- Data tables scroll **horizontally inside their own card** (sticky headers), the home trend chart scrolls inside its card at full width so the axis labels stay legible instead of shrinking to unreadable, and the chart-type pills wrap to extra rows instead of widening the page (no page-level horizontal scroll anywhere).
- Skeletons mirror the real layout (same CSS classes **and the same spacing wrappers**, e.g. the home chart's `.trend-wrap` 14px column gap), so loading states are responsive too and no skeleton blocks ever sit flush against each other.
- Inputs render at 16px on phones so iOS Safari does not zoom on focus.

## Dark / light theme
Every screen supports a **light** and a **dark** theme (nav, tables, chat, dialogs, skeletons, trend chart):
- Resolution: a tiny inline script in the layout reads the stored choice (`localStorage["bni-theme"]`) and falls back to the OS preference (`prefers-color-scheme`) on a first visit — applied before first paint, so there is no flash of the wrong theme, and it survives reloads.
- Toggled with a **sun/moon button**: in the top bar on tablets/desktop, at the bottom of the hamburger drawer on phones. The choice is stored per browser.
- Light stays exactly the current look; dark is one palette swap through CSS custom properties (`[data-theme="dark"]`), not per-component overrides.

## Success criteria
- Upload Report XLS + week → rows appear in correct 6 screens with pagination (150/page default like screenshots).
- Upload the PALMS attendance file (last ~6 months, week-wise) → `/palms` shows the member × week matrix with the imported letters, and a **second upload of the same file skips every already-imported `(member, week)` cell** (preview shows the skip counts + samples before importing, and says so afterwards).
- PALMS and slips never reference each other: no comparison table, no mismatch banner, no cross "not imported yet" notice exists anywhere — `/report` warns only about missing slips, `/palms` about nothing.
- A Wednesday between the first imported meeting and today without an imported slips file is listed in a warning banner on `/report`.
- Every file entry is correct: **within one file**, duplicate entries (identical rows) are all imported as-is — nothing is skipped for being a duplicate (`supabase/migrations/003_allow_duplicate_slips.sql` drops the per-week dedupe indexes). **Re-importing a file skips rows already imported for the same chapter and week**: each row whose content matches an existing slip of that week is dropped and counted as skipped, one aggregated `N duplicate row(s) skipped` line is reported with the file's other errors, and the history table shows the skip reasons — nothing is ever deleted or overwritten. Only typing mistakes (unknown Slip Type, missing From/To, a number instead of a name) pause the import with a confirmation dialog; those rows are skipped only after the user agrees. The **PALMS import** behaves the same way per cell: an already-imported `(member, week)` cell is skipped by design and reported in the preview.
- Deleting an import removes its rows everywhere (6 screens, report, chat totals) while other imports of the same week stay intact; removing the PALMS import empties the `/palms` matrix and its history but never touches slips (both verified by tests).
- Picking a PALMS file never imports it on its own: `/palms` and `/import` use the two-step panel (choose file → preview with skip info → explicit Import button).
- `/members` shows active/inactive counts under the title with an Active-only checkbox filter; the import history lists Slips Audit Report and PALMS Report files in **separate tables**; report xlsx/pdf print bold names in bold like the screen; every "… credits" line reads "… CEU credits".
- `/` shows the last 6 months as weekly (Wednesday) trends; the slip-type tabs switch between **All slips (combined)** and each individual type, and the chart picker switches between **line, bar, area, pie, bubble, radar and heat map**; each point equals that week's imported slip count and a week without an import shows 0.
- At 320–1024px viewport widths nothing overflows the page: nav, tables and the trend chart scroll inside their own containers, and the responsive CSS checks (`tests/unit-responsive.mjs`) pass.
- The theme toggle flips every screen with no light surface left behind and no flash of the wrong theme on reload; the theme checks (`tests/unit-theme.mjs`) pass.
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
