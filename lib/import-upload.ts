import { parseReportFile, type ParsedReport } from "@/lib/report-import";
import { parseReportXlsxBold } from "@/lib/report-bold";
import { isSpreadsheetML, parseReportXmlSpreadsheetML } from "@/lib/report-xml";
import { buildWeekLabel, wednesdayOfWeek } from "@/lib/weeks";
import { getSupabaseServer } from "@/lib/supabase/server";

export type UploadPreview = {
  reportDate: string;
  meetingDate: string;
  weekLabel: string;
  boldUsed: boolean;
  rowCount: number;
  columns: string[];
  weekExists: boolean;
  weekId: string | null;
  slipCount: number;
  counts: Record<string, number>;
};

const SLIP_TABLES = [
  "slip_referrals",
  "slip_one_to_ones",
  "slip_tyfcb",
  "slip_visitors",
  "slip_ceus",
] as const;

/**
 * Parse an uploaded Report file and resolve its meeting week —
 * shared by the preview and import endpoints (no DB writes here).
 * Throws with a user-facing message when the file is unusable.
 */
export async function parseUpload(file: File): Promise<{
  rows: ParsedReport["rows"];
  errors: string[];
  headers: string[];
  columnMap: ParsedReport["columnMap"];
  boldUsed: boolean;
  reportDate: string;
  meetingDate: string;
  weekLabel: string;
}> {
  const buf = Buffer.from(await file.arrayBuffer());
  let parsed: ParsedReport;
  let boldUsed = false;
  // Content sniffing beats the extension: the client's files are named
  // .xls/.xlsx but are really SpreadsheetML XML — which carries bold info.
  if (isSpreadsheetML(buf)) {
    try {
      const xmlParsed = parseReportXmlSpreadsheetML(buf);
      parsed = xmlParsed;
      boldUsed = xmlParsed.boldFound;
    } catch {
      parsed = parseReportFile(buf);
    }
  } else if (/\.xlsx$/i.test(file.name)) {
    try {
      const boldParsed = await parseReportXlsxBold(buf);
      parsed = boldParsed;
      boldUsed = boldParsed.boldFound;
    } catch {
      parsed = parseReportFile(buf);
    }
  } else {
    parsed = parseReportFile(buf);
  }

  if (!parsed.reportDate) {
    throw new Error(
      "Could not determine the meeting week from the file. Expected a title like 'Slips Audit Report for 01/04/2026' in its first rows.",
    );
  }
  const meetingDate = wednesdayOfWeek(parsed.reportDate);
  return {
    rows: parsed.rows,
    errors: parsed.errors,
    headers: parsed.headers,
    columnMap: parsed.columnMap,
    boldUsed,
    reportDate: parsed.reportDate,
    meetingDate,
    weekLabel: buildWeekLabel(meetingDate),
  };
}

/** How much slip data a week already holds for this tenant (re-import question). */
export async function weekSlipCounts(tenantId: string, weekId: string): Promise<{ total: number; counts: Record<string, number> }> {
  const sb = getSupabaseServer();
  const counts: Record<string, number> = {};
  let total = 0;
  await Promise.all(
    SLIP_TABLES.map(async (table) => {
      // NOTE: head:true silently returns count=null in this client version —
      // always pair count:exact with limit(1) instead.
      const { count } = await sb
        .from(table)
        .select("id", { count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("bni_week_id", weekId)
        .limit(1);
      counts[table] = count ?? 0;
      total += count ?? 0;
    }),
  );
  return { total, counts };
}

export async function findWeekByDate(meetingDate: string) {
  const sb = getSupabaseServer();
  const { data } = await sb.from("bni_weeks").select().eq("meeting_date", meetingDate).maybeSingle();
  return data as { id: string; label?: string | null } | null;
}
