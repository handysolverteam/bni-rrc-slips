import { checkFileChapter } from "@/lib/chapter-target";
import { clearDistinctCache } from "@/lib/distinct";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";
import { fetchAllRows } from "@/lib/supabase/paged";
import { getSupabaseServer } from "@/lib/supabase/server";
import { detectTrafficReport, parsePalmsSummaryReport, parseSponsorReport } from "@/lib/traffic-report-import";

export const maxDuration = 60;

const MIGRATION_HINT = "Run supabase/migrations/010_traffic_reports.sql in the Supabase SQL editor first.";

/**
 * Imports one of BNI's two chapter reports that feed the Traffic Lights screen (the type is recognised from the
 * title row): the Chapter Summary PALMS Report (one row per member for a From..To range) or the Chapter Sponsor
 * Report. A re-import of the same range replaces that report's rows for the active chapter. The chapter named in
 * the file must be the active chapter. Requires tenant only (no roles).
 */
export async function POST(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
    if (!file.name.match(/\.(xls|xlsx)$/i)) return Response.json({ error: "Only .xls/.xlsx supported" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const kind = detectTrafficReport(buffer);
    if (!kind) {
      return Response.json(
        { error: "Not a Traffic Lights report — upload the Chapter Summary PALMS Report or the Chapter Sponsor Report." },
        { status: 400 },
      );
    }
    const parsed = kind === "palms" ? parsePalmsSummaryReport(buffer) : parseSponsorReport(buffer);
    if (parsed.errors.length > 0 || !parsed.from || !parsed.to) {
      return Response.json({ error: parsed.errors[0] ?? "Could not read the report.", errors: parsed.errors }, { status: 400 });
    }

    const check = await checkFileChapter({ uid: ctx.uid, tenantId: ctx.tenantId }, parsed.chapterName);
    if (check.status === "choose") {
      return Response.json(
        { error: `This report is for ${check.normalized}, but the active chapter is ${check.active.name || "another chapter"} — switch chapter first.` },
        { status: 400 },
      );
    }

    const tenantId = ctx.tenantId;
    const sb = getSupabaseServer();
    const table = kind === "palms" ? "traffic_palms_rows" : "traffic_sponsor_rows";
    // Replace the same range, never mix two imports of it.
    const del = await sb.from(table).delete().eq("tenant_id", tenantId).eq("period_from", parsed.from).eq("period_to", parsed.to);
    if (del.error) {
      const missing = /relation|does not exist|schema cache/i.test(del.error.message);
      return Response.json({ error: missing ? MIGRATION_HINT : del.error.message }, { status: missing ? 409 : 500 });
    }

    const base = { tenant_id: tenantId, period_from: parsed.from, period_to: parsed.to };
    const rows: Record<string, unknown>[] =
      parsed.kind === "palms"
        ? parsed.rows.map((r) => ({
            ...base,
            member_name: r.name,
            p: r.p,
            a: r.a,
            l: r.l,
            m: r.m,
            s: r.s,
            rgi: r.rgi,
            rgo: r.rgo,
            rri: r.rri,
            rro: r.rro,
            visitors: r.visitors,
            one_to_ones: r.oneToOnes,
            tyfcb: r.tyfcb,
            ceu: r.ceu,
            t: r.t,
          }))
        : parsed.rows.length > 0
          ? parsed.rows.map((r) => ({
              ...base,
              sponsor_name: r.sponsor,
              sponsored_name: r.sponsored,
              sponsored_chapter: r.sponsoredChapter,
              sponsored_region: r.sponsoredRegion,
              application_date: r.applicationDate,
            }))
          : // An empty Sponsor Report (nobody sponsored anyone) is still "imported": a marker row says so.
            [{ ...base, sponsor_name: "", sponsored_name: "" }];
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from(table).insert(rows.slice(i, i + 500));
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }
    clearDistinctCache(); // also drops the cached Traffic Lights data
    return Response.json({
      kind,
      from: parsed.from,
      to: parsed.to,
      count: parsed.rows.length,
      chapter: check.normalized || check.active.name,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

type Counts = Map<string, { from: string; to: string; members: number; sponsors: number }>;

/** The imported ranges with their row counts (for the Import screen). */
export async function GET(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const opts = { eq: [["tenant_id", ctx.tenantId]] as [string, string][], pageSize: 1000 };
    let palms: { period_from: string; period_to: string }[];
    let sponsors: { period_from: string; period_to: string; sponsor_name: string }[];
    try {
      [palms, sponsors] = await Promise.all([
        fetchAllRows<{ period_from: string; period_to: string }>("traffic_palms_rows", "period_from,period_to", opts),
        fetchAllRows<{ period_from: string; period_to: string; sponsor_name: string }>("traffic_sponsor_rows", "period_from,period_to,sponsor_name", opts),
      ]);
    } catch {
      return Response.json({ reports: [], needsMigration: true });
    }
    const map: Counts = new Map();
    const entry = (from: string, to: string) => {
      const k = `${from}_${to}`;
      const e = map.get(k) ?? { from, to, members: 0, sponsors: 0 };
      map.set(k, e);
      return e;
    };
    for (const r of palms) entry(r.period_from, r.period_to).members++;
    for (const r of sponsors) {
      const e = entry(r.period_from, r.period_to);
      if (r.sponsor_name) e.sponsors++;
    }
    const hasSponsorReport = new Set(sponsors.map((s) => `${s.period_from}_${s.period_to}`));
    const reports = [...map.values()]
      .sort((a, b) => (a.to < b.to ? 1 : -1))
      .map((e) => ({ ...e, hasPalms: e.members > 0, hasSponsorReport: hasSponsorReport.has(`${e.from}_${e.to}`) }));
    return Response.json({ reports, needsMigration: false });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Remove both reports of one range: `DELETE /api/import/traffic?from=YYYY-MM-DD&to=YYYY-MM-DD`. */
export async function DELETE(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return Response.json({ error: "from and to (YYYY-MM-DD) are required" }, { status: 400 });
    }
    const sb = getSupabaseServer();
    for (const table of ["traffic_palms_rows", "traffic_sponsor_rows"]) {
      const { error } = await sb.from(table).delete().eq("tenant_id", ctx.tenantId).eq("period_from", from).eq("period_to", to);
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }
    clearDistinctCache();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
