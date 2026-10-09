# ARCHITECTURE — BNI Week Slips

```
bni-rrc-slips/
  docs/PRD.md SYSTEM.md ARCHITECTURE.md
  supabase/migrations/001_schema.sql     # full schema (single file)
                  002_member_chapters.sql
                  003_allow_duplicate_slips.sql
                  004_tenants.sql        # multi-tenant: tenants, tenant_members, tenant_id columns + backfill
                  005_rbac.sql           # applied, role column now UNUSED (roles removed); still owns chat_sessions.owner_uid (per-user chats)
                  006_attendance.sql     # member_attendance — unique (tenant, week, lower(member_name)); one cell row per member per week (PALMS Report)
                  007_palms_stats.sql    # palms_stats — LEGACY (old comparison totals; nothing writes/reads it now)
  supabase/seed.sql                      # 74 members + Wednesdays Jan 2026-Dec 2027
  lib/
    supabase/server.ts   # getSupabaseServer (service_role on server, anon fallback)
    server-auth.ts       # getTenantContext() -> {uid, tenantId} | noAccess | null (no roles); service callers may pass x-user-uid
    tenant-grant.ts      # grantHomeChapter(sb, uid) -> Home tenant id | null; open sign-in (auto-grant, idempotent)
    report-import.ts     # parseReportFile(buffer) -> rows; mapInsideOutside(); pure, tested
    palms-import.ts      # parsePalmsWideFile(buffer) -> { from, to, columns[], members[{name,cells[]}], issues[], errors[] }; pure (wide 6-month PALMS .xls)
    data-health.ts       # missingWednesdays(importedDates, todayIso) (pure) + fetchMissingMeetingFiles(tenantId)
                         # + fetchUnimportedData(tenantId, weekIds) - weeks in scope missing their SLIPS file (PALMS never mentioned)
    report-view.ts       # fetchReportSections(tenantId, ...) — all report/export queries
    palms-view.ts        # fetchPalmsMatrix(tenantId, weekIds) - member x weeks attendance grid; fetchPalmsWeekOptions
                         # + fetchPalmsImportRecord shared by the /palms screen and the PALMS export
                         # + fetchPalmsAttendanceStats(tenantId, todayIso) - rolling 26-week A/M/S buckets for /palms
    palms-buckets.ts     # rollingWindow(todayIso) + bucketAttendance(rows, inactiveKeys) - pure 26-week bucket logic (unit-tested)
    trends.ts            # fetchSlipTrends(tenantId, months = 6) + fetchAttendanceTrends(tenantId, weeks) — weekly (Wednesday)
                         # slip counts per type + PALMS flag sums, home dashboard (two TrendChart cards)
    import-dedup.ts      # rowSignature(table, row) + dropDuplicates(table, rows, existingKeys) — pure re-import skip logic (unit-tested)
    list-filters.ts lists.ts distinct.ts server-weeks.ts  # every query takes/uses tenantId
    member-chapters.ts   # resolveHomeChapter(tenant) — home_chapter_name ?? env (default tenant only) ?? tenant.name
    chat/snapshot.ts     # getSlipsData(tenantId) — per-tenant snapshot, cache key includes tenant_id
    firebase/admin.ts    # verifyFirebaseIdToken (jose JWKS) — used by the session cookie route
    types.ts
  app/
    layout.tsx + globals.css (AuthProvider + AppShell guard; AppShell posts ID token -> session cookie)
    api/auth/session/route.ts   # POST {idToken} set HttpOnly bni_session | DELETE clear
    api/tenant/route.ts         # GET current+list | POST {tenantId} switch (membership-checked)
    api/import/report/route.ts         # POST file — slips import (week from the file title; re-import drops rows already present for the week via lib/import-dedup.ts)
    api/import/palms/route.ts          # POST file — wide PALMS import (skip already-imported cells, one batch per file, week id null); DELETE — remove ALL PALMS data for the tenant
    api/import/palms/preview/route.ts  # POST file — dry run: column/week resolution + new-vs-skipped cell counts + samples
    api/import/batches/[id]/route.ts   # DELETE — remove one import row + every row it created (slips or PALMS cells)
    api/palms/export/route.ts          # GET week,format=xlsx|csv|pdf|json — PALMS Report matrix export (screen parity)
    api/report/export/route.ts         # GET week,tab,format=xlsx|csv|pdf|json — week report export (xlsx = ExcelJS with bold From/To cells; json feeds the in-browser PDF)
    api/<resource>/route.ts     # every data API: getTenantContext() first (401 without session)
    api/members/[id]/route.ts   # PATCH {isInactive} — active/inactive toggle (tenant-scoped, any member)
    members|referrals|one-to-ones|visitors|tyfcb|ceus|report|palms|import|chat pages (server components
                                 call getTenantContext() -> redirect /login, noAccess -> no-access screen)
  components/ImportPage.tsx     # import screen: ImportPanel (slips) + PalmsImportPanel (attendance, two-step) + TWO history tables (slips / PALMS) with per-row Delete (ConfirmDialog)
  components/PalmsImportPanel.tsx # two-step upload (choose file -> preview card with new-vs-skipped cell counts -> explicit Import button) -> POST /api/import/palms/preview then /api/import/palms; mounted on /import AND /palms; collapsible head (− Minimize / + Import files, same .import-toggle as ImportPanel); on /palms also shows the last imported file + Remove-all PALMS data action
  components/DataWarnings.tsx   # server component, /report only: missing-Wednesday banner + slips-not-imported banner (warnings only, nothing on success)
  components/PalmsExportButtons.tsx # xlsx/csv/pdf switch on the /palms page head (PDF built in-browser from JSON)
  components/TenantSwitcher.tsx # chapter switcher in the top nav (GET/POST /api/tenant)
  components/SlipsTable.tsx     # shared read-only table + pagination (column filters: week/chapter single-select, names multi)
  components/ListShell.tsx      # shared list frame: title + count badge + optional sub line (active/inactive counts) + Active checkbox filter passed into the table's Active header cell (members list)
  components/MemberActiveToggle.tsx # checkbox in the Active column (members list only)
  components/TrendChart.tsx  # client multi-view trend chart, rendered TWICE on the home dashboard (attendance above slip trends): slip-type/label tabs (All = combined + the 5 types) + chart picker (line/bar/area/pie/bubble/radar/heat map, bar = default) above the graph, 7 hand-rolled SVG renderers + legend from one { weeks, series } prop; optional `allLabel` prop relabels the combined tab (attendance passes "All letters", default "All slips")
```

## Data flow

**Session** — login (Google SSO) → AuthContext has a Firebase user → AppShell `POST /api/auth/session { idToken }` → server verifies via JWKS → HttpOnly cookie `bni_session` (re-posted on every app load, so a long-lived tab stays authenticated).

**Tenant** — every page render / API call → `getTenantContext()`:
1. verify `bni_session` cookie → `uid`
2. read `bni_tenant` cookie → membership lookup in `tenant_members` (falls back to first membership)
3. `{ uid, tenantId }` → all Supabase queries add `.eq("tenant_id", tenantId)`; chat queries add `.eq("owner_uid", uid)`; `null` → 401 / redirect `/login`; **zero memberships on the browser path → the Home Chapter is granted automatically** (`lib/tenant-grant.ts` idempotent upsert) so sign-in is open to everyone — only if that grant fails does the UI fall back to the no-access screen (uid + provisioning SQL).

**Switch** — TenantSwitcher → `POST /api/tenant { tenantId }` (403 if not a member) → cookie set → full reload → every server render re-scopes (lists, weeks, report, import batches, chat snapshot/sessions).

**Import** — upload → tenant-scoped batch/members/chapters/slips inserts → snapshot cache invalidated → report/chat immediately reflect the new rows for that tenant only. **Deletion** — `DELETE /api/import/batches/{id}` (history table) removes that batch's slip rows or PALMS cells + the batch itself; `DELETE /api/import/palms` (the `/palms` panel's Remove-all action) clears every attendance row, the legacy `palms_stats` rows and the batches those attendance rows reference — slips are never touched. Both are tenant-scoped (404 for foreign ids) and clear the caches the import sets.

**PALMS Report (attendance)** — two-step panel on `/palms` and `/import` (choose file → `POST /api/import/palms/preview` → preview card with new-vs-skipped cell counts + samples → explicit Import → `POST /api/import/palms`) → `lib/palms-import.ts` parses the wide file (date columns `Apr 01 …` resolved against `From:`/`To:` year + the Wednesday calendar; letters `P A M S L` per cell; unknown date columns → warning, other cell values → row issues) → existing `(member, week)` cells are **skipped** (never replaced), only new cells insert → one `import_batches` row per file (`bni_week_id = NULL`) → `/palms` (`lib/palms-view.ts`) renders the member × week matrix. **No relation to slips anywhere** — no comparison, no cross banners, no Total row. **Export** — `components/PalmsExportButtons.tsx` → `GET /api/palms/export` → the same `fetchPalmsMatrix` → xlsx/csv on the server, PDF built in-browser from `format=json` (same byte-swallowing workaround as the report), cells identical to the screen. The page also renders the **26-week breakdown** card below the matrix: `fetchPalmsAttendanceStats` → meetings of the rolling window (`rollingWindow`) → summed `absent`/`m`/`s` flags per member → inactive names dropped → pure `bucketAttendance` → the fixed **3+/2/1** buckets per letter (count + names), rendered only when a bucket is non-empty.

**Data health** — on every `/report` render only (nothing on `/palms`): (1) `lib/data-health.ts` lists Wednesdays from the tenant's first imported meeting to today without an imported slips file → amber banner; (2) `lib/data-health.ts: fetchUnimportedData` lists each week in scope missing its slips file → red **"… not imported yet"** banner (`components/DataWarnings.tsx`, warnings only — nothing renders when everything is imported). The old PALMS comparison/notice is gone with the decoupling; `app/import/loading.tsx` and `app/palms/loading.tsx` show the matching `ImportSkeleton` / `PalmsSkeleton` during route navigation.

**Home dashboard** — `/` (server component) renders a page head — `h1` **BNI Week Slips** + `count-badge` **N active members** (head count of `members` where `is_inactive = false`); the old import hero card is gone — the top nav is the entry point to Import and every list screen. Below it, two `components/TrendChart.tsx` cards, **Attendance above Slip trends**: `lib/trends.ts: fetchSlipTrends` (last 6 months of Wednesdays from the global calendar + per-table slip counts) and `fetchAttendanceTrends(tenantId, weeks)` (same weeks, `member_attendance` flag sums → Present/Absent/Medical/Substitute/Leave) each passed to a chart with `{ weeks, series }` props; a chart keeps `type` (All = combined | one series) and `chart` (line, bar, area, pie, bubble, radar, heat map — **bar is the default**) as its own client state in a `.tabs-row` above the graph — every view derives from the same props, so switching tabs/chart types never re-fetches. `HomeSkeleton` mirrors the page head + the two chart cards while loading.

**Active/inactive member** — `members.is_inactive` (default false = active; import never sets it). Every user gets an `Active` checkbox column before Name → optimistic flip → `PATCH /api/members/{id}` (tenant-scoped) → `router.refresh()`. `/members` + `GET /api/members` return inactive rows to everyone (no role filter). The `/members` header also shows the **active/inactive counts** **following the current filters** (search/chapter/column filters narrow them; `?active=1` shows `N active` only) and an **Active** checkbox filter (`?active=1`) via optional `sub` / `activeToggle` props on `ListShell`. Flag flips never touch slips/exports/chat.

**Import history** — `GET /api/import/batches` returns each batch with a derived `kind` (`slips` | `palms`: linked to attendance/stats, else filename fallback); `components/ImportPage.tsx` renders **two tables**, one per kind, each with its own date/week filters and per-row Delete.

**Chat** — `getSlipsData(tenantId)` builds the snapshot + query index from tenant-scoped rows; cached per tenant (90s, `sharedState` key includes tenant id). Sessions are tenant- **and owner-scoped** (`owner_uid`): every list/read/write filters `owner_uid = uid` when the caller has a uid, so each user sees only their own chats.

**Chat suggestions** — the model ends each reply with a `SUGGESTIONS:` block of follow-up questions drawn from the turn just answered; `lib/chat/gemini.ts` strips it out of the answer text and returns it as `suggestions[]` → the generate route stores it as a hidden `[suggestions: …]` marker in `chat_messages.text` (same mechanism as `[tagged:]`/`[attached:]`) and returns it in the JSON. `ChatBox` splits the marker off on history load and renders the newest AI message's suggestions as the composer chips, falling back to the static starter list on a fresh chat.

**WhatsApp share** — pure client-side, no API route: `lib/whatsapp.ts` builds `https://wa.me/?text=<encoded>` from `whatsappShareUrl()` and formats the transcript with `buildChatShare()` → `{ text, total, included }` (greeting dropped, `You:`/`Slips AI:` per turn, `[file: …]` for attachments, and past the 20 000-char URL budget the oldest turns dropped so `included < total`). `ChatBox`'s toolbar button "Share chat" sends the whole transcript and, whenever `included < total`, states the `N of M` count in the toolbar; the per-message ⋮ menu's "Share to WhatsApp" sends that message only — both `window.open(url, "_blank")` in a user gesture, so WhatsApp opens prefilled and the app itself never transmits anything.

## Decisions (multi-tenant MVP)
- **Responsive via CSS + one drawer component**: one stylesheet (`app/globals.css`) with two media queries — `≤1024px` (tablet/iPad) and `≤640px` (phone) — instead of a viewport library or per-page layouts. Flexbox wrapping already covers toolbars/filters/export switches; tables scroll inside the existing `.table-scroll` (sticky `nowrap` headers make them overflow naturally); the only structural additions are a `.trend-svg-scroll` wrapper around the home chart SVG (and its skeleton twin) that pins the chart to its fixed 960px viewBox width on phones, and the **nav**: `components/Nav.tsx` (client) renders the top-level pills (Home, Import, Bni Member, **Slips ▾**, Slip Report, PALMS Report, Chat) in both the desktop bar and a slide-in drawer — the **Slips** dropdown menu portals to `<body>` as a fixed-position panel on desktop (the pill row is `overflow-x: auto`, which would clip an absolute child) and expands as an accordion in the drawer — with the hamburger toggle, overlay/Escape/route-change/resize closing and body-scroll lock all in that one component; CSS only switches visibility per breakpoint. Skeletons share the real CSS classes, so every responsive rule applies to loading states automatically.
- **Theme = one attribute + one palette block**: `<html data-theme>` — set before first paint by a tiny inline script in `app/layout.tsx` (stored `localStorage["bni-theme"]`, else the OS preference) — selects between the `:root` light palette (unchanged values; it now also names the surfaces that used to be hardcoded hexes: `--panel`, `--surface`, `--field`, `--chip`, `--*-ink`, …) and a `[data-theme="dark"]` block. No theme CSS is scoped per component; the only JS is `components/ThemeToggle.tsx` (icon button in the top bar + inside the phone drawer, kept in sync through a `bni-theme-change` event). Trend-chart colours are CSS vars consumed via inline `style`, so the lines and legend dots flip live without a re-render.
- **Tenant = chapter**, many-to-many memberships + switcher. **Open sign-in**: the Home Chapter is auto-granted on first sign-in (`lib/tenant-grant.ts`, open to every Google account, no admin UI); other chapters are provisioned by SQL insert per tenant.
- **No roles** (removed 2026-10-05, re-appliable later): every member of a tenant can import, browse, export, toggle members and chat — the only server-side gates are *authenticated* (`bni_session` cookie) and *member of this tenant*, both resolved by `getTenantContext()`. Migration 005 stays applied and `tenant_members.role` is unused, so re-adding roles later is pure code (no new DDL).
- **Per-user chats via `chat_sessions.owner_uid`**: ownership is checked in the API layer next to the tenant filter (list/create/rename/delete/messages/persist), not in RLS. Chats stay tenant-scoped too (owner scoping never replaces tenant scoping). Plain service-key callers (tests/scripts) have no uid → root view of the tenant's sessions; a service caller can pass `x-user-uid` to act as a specific member (also how the chat e2e test exercises owner scoping without a live Firebase session).
- **Auth via verified-ID-token cookie**, not middleware: `verifyFirebaseIdToken` (jose + Google JWKS) already exists and works without service-account keys; cookie is readable by server components and route handlers alike. Middleware was rejected — it cannot set cookies and JWKS verification per-request at the edge is heavier than needed here.
- **App-level scoping, not RLS**: every access already goes through server components/route handlers using the service-role client (bypasses RLS anyway), so `.eq("tenant_id", …)` on every query is the single enforcement point; membership is re-checked per request, so a forged `bni_tenant` cookie for a foreign tenant yields 403. RLS policies remain as-is (hardening later, not required for correctness here).
- **`bni_weeks` stays global** (shared ISO-Wednesday calendar, no tenant content); tenant week lists are derived from the tenant's own `import_batches`. `chapters` and `members` become tenant-scoped.
- **Home chapter is per tenant and never read from `.env`** (2026-10-09): blank-Detail names file into `tenants.home_chapter_name` when set (Settings), else the tenant's own name (auto-created on first import). Chapters named in a file's Detail column are created if missing and assigned to that other-chapter member (bold rule unchanged).
- **Backfill**: migration 004 creates one default tenant and assigns every existing row to it (single-tenant data preserved, no loss); memberships for existing users are added by the operator with one SQL insert per user (uid shown by the no-access screen).
- Denormalized `*_name` columns alongside fks stay, so grids render exactly like screenshots even when the member is other-chapter text.
- Pagination server-side with `range()`; queries keep their existing shape — tenant filter is one extra `.eq` per query (no query-builder rewrite).
