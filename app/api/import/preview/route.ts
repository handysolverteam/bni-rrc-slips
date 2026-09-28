import { findWeekByDate, parseUpload, weekSlipCounts } from "@/lib/import-upload";

/**
 * Inspect an uploaded Report file WITHOUT importing it: resolves the week
 * from the file title and reports whether that week already holds data,
 * so the UI can ask for confirmation before a duplicate import.
 */
export async function POST(request: Request) {
  try {
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
      const result = await weekSlipCounts(week.id);
      slipCount = result.total;
      counts = result.counts;
    }

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
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Preview failed." },
      { status: 500 },
    );
  }
}
