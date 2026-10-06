import { findWeekByDate, parseUpload, weekSlipCounts } from "@/lib/import-upload";
import { validateReportRows } from "@/lib/report-import";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/**
 * Inspect an uploaded Report file WITHOUT importing it: resolves the week
 * from the file title and reports row problems so the UI can pause and ask
 * for permission when typing mistakes are found. Duplicates are NOT
 * flagged — every entry is kept on import (owner rule).
 * Requires a signed-in member of the active chapter (roles were removed).
 */
export async function POST(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "file is required" }, { status: 400 });
    }
    if (!file.name.match(/\.(xls|xlsx|csv)$/i)) {
      return Response.json({ error: "Only .xls/.xlsx/.csv supported" }, { status: 400 });
    }

    let upload;
    try {
      upload = await parseUpload(file);
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "Could not read the file." },
        { status: 400 },
      );
    }

    const week = await findWeekByDate(upload.meetingDate);
    let slipCount = 0;
    let counts: Record<string, number> = {};
    if (week) {
      const result = await weekSlipCounts(ctx.tenantId, week.id);
      slipCount = result.total;
      counts = result.counts;
    }

    // Every structural row problem (mirrors the import route's rules):
    // skipped rows never import, warnings import with a defaulted value.
    const { skipped, warnings } = validateReportRows(upload.rows);
    const rowIssues = {
      skippedCount: skipped.length,
      skippedSamples: skipped.slice(0, 5),
      warningCount: warnings.length,
      warningSamples: warnings.slice(0, 5),
    };

    return Response.json({
      filename: file.name,
      reportDate: upload.reportDate,
      meetingDate: upload.meetingDate,
      weekLabel: upload.weekLabel,
      weekExists: !!week,
      weekId: week?.id ?? null,
      slipCount,
      counts,
      rowCount: upload.rows.length,
      columns: upload.headers.filter(Boolean),
      boldUsed: upload.boldUsed,
      errors: upload.errors,
      rowIssues,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Preview failed." },
      { status: 500 },
    );
  }
}
