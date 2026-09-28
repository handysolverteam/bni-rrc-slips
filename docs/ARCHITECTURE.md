# ARCHITECTURE — BNI Week Slips

```
bni-rrc-slips/
  docs/PRD.md SYSTEM.md ARCHITECTURE.md
  supabase/migrations/001_schema.sql  # full schema (single file)
  supabase/seed.sql                    # 74 members + Wednesdays Jan 2026-Dec 2027
  lib/
    supabase/server.ts   # createServerClient (service_role on server, anon fallback)
    report-import.ts     # parseReportFile(buffer) -> rows; mapInsideOutside(); pure, tested
    types.ts
  app/
    layout.tsx + globals.css (simple, no auth)
    page.tsx             # links to 5 screens + import
    import/page.tsx      # file input + POST (week comes from the file title row)
    members/page.tsx, referrals/page.tsx, one-to-ones/page.tsx, visitors/page.tsx, tyfcb/page.tsx
    api/import/report/route.ts
    api/members|referrals|one-to-ones|visitors|tyfcb/route.ts
  components/SlipsTable.tsx  # shared read-only table + pagination
```

## Data flow
Upload → `POST /api/import/report` → parse (`xlsx`) → upsert weeks/members → insert slips → redirect/browse via GET list APIs → server-rendered tables.

## Decisions (MVP)
- Next.js App Router + Supabase only (per request). No auth/RLS complexity: permissive `SELECT`, inserts via service-role server client.
- `xlsx` lib for parsing (matches existing bni-rrc dep); bold extraction deferred (schema already has flags).
- Denormalized `*_name` columns alongside fks so grids render exactly like screenshots even when member is other-chapter text.
- Pagination server-side with `range()`.
