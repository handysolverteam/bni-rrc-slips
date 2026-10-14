import { clearDistinctCache } from "@/lib/distinct";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";
import { getSupabaseServer } from "@/lib/supabase/server";
import { makeResolver } from "@/lib/traffic-light-calc";
import { parseBniTrafficLights } from "@/lib/traffic-light-import";
import { fetchTrafficData } from "@/lib/traffic-lights";

export const maxDuration = 60;

const MISSING_TABLE = "The bni_traffic_lights table does not exist yet — run supabase/migrations/010_traffic_lights.sql in the Supabase SQL editor first.";

const isMissingTable = (message: string): boolean => /bni_traffic_lights/.test(message) && /(does not exist|could not find|schema cache)/i.test(message);

/**
 * POST /api/traffic-lights/import  (multipart: file = BNI's "Member Traffic Lights" .xlsx)
 * Stores BNI's rows for the report month in the file's title ("… FOR SEPTEMBER '26") — they supply the
 * Visitors and Sponsors the slips cannot, and a reference total. Re-importing a month REPLACES it. Any
 * signed-in member of the chapter may import (roles were removed); nothing else is touched.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
    if (!/\.(xlsx|xls)$/i.test(file.name)) return Response.json({ error: "Only .xlsx / .xls files are supported." }, { status: 400 });

    let parsed;
    try {
      parsed = parseBniTrafficLights(Buffer.from(await file.arrayBuffer()));
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }

    const sb = getSupabaseServer();
    const del = await sb.from("bni_traffic_lights").delete().eq("tenant_id", ctx.tenantId).eq("report_month", parsed.reportMonth);
    if (del.error) {
      return Response.json({ error: isMissingTable(del.error.message) ? MISSING_TABLE : del.error.message }, { status: isMissingTable(del.error.message) ? 409 : 500 });
    }
    const records = parsed.rows.map((r) => ({
      tenant_id: ctx.tenantId,
      report_month: parsed.reportMonth,
      member_name: r.name,
      chapter: r.chapter || null,
      total_score: Math.round(r.total),
      attendance_rate: r.attendanceRate,
      attendance_score: Math.round(r.attendanceScore),
      ceu_rate: r.ceuRate,
      ceu_score: Math.round(r.ceuScore),
      one_to_one_rate: r.oneToOneRate,
      one_to_one_score: Math.round(r.oneToOneScore),
      referrals_rate: r.referralsRate,
      referrals_score: Math.round(r.referralsScore),
      tyfcb: r.tyfcb,
      tyfcb_score: Math.round(r.tyfcbScore),
      visitors: r.visitors,
      visitor_score: Math.round(r.visitorScore),
      sponsors: r.sponsors,
      sponsor_score: Math.round(r.sponsorScore),
      filename: file.name,
    }));
    // Names are unique per month in BNI's file; a duplicate (same name twice) keeps the first.
    const seen = new Set<string>();
    const unique = records.filter((r) => {
      const k = r.member_name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    for (let i = 0; i < unique.length; i += 200) {
      const { error } = await sb.from("bni_traffic_lights").insert(unique.slice(i, i + 200));
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }
    clearDistinctCache();

    // How many of BNI's names line up with our active home members (the rest are listed, never guessed).
    const data = await fetchTrafficData(ctx.tenantId);
    const resolve = makeResolver(data.members);
    const unmatched = unique.map((r) => r.member_name).filter((n) => !resolve(n));
    return Response.json({
      month: parsed.month,
      filename: file.name,
      rows: unique.length,
      matched: unique.length - unmatched.length,
      unmatched,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** DELETE /api/traffic-lights/import?month=YYYY-MM — drop the imported BNI reference for that month. */
export async function DELETE(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const month = new URL(request.url).searchParams.get("month") ?? "";
    if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: "month=YYYY-MM is required" }, { status: 400 });
    const { error } = await getSupabaseServer()
      .from("bni_traffic_lights")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("report_month", `${month}-01`);
    if (error) return Response.json({ error: isMissingTable(error.message) ? MISSING_TABLE : error.message }, { status: isMissingTable(error.message) ? 409 : 500 });
    clearDistinctCache();
    return Response.json({ ok: true, month });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
