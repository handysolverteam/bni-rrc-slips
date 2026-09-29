import { findWeekByDate, parseUpload, weekSlipCounts } from "@/lib/import-upload";
import { classifySlipType, validateReportRows } from "@/lib/report-import";
import { computeDesiredChapters, resolveHomeChapter } from "@/lib/member-chapters";
import { getSupabaseServer } from "@/lib/supabase/server";

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

    // Every structural row problem (mirrors the import route's rules):
    // skipped rows never import, warnings import with a defaulted value.
    const { skipped, warnings } = validateReportRows(upload.rows);
    // CEU rows have no duplicate check: re-importing a week that already
    // holds CEUs doubles them. Flag it so the UI can ask first.
    const ceuRows = upload.rows.filter((r) => classifySlipType(r.slipType) === "ceu").length;
    const rowIssues = {
      skippedCount: skipped.length,
      skippedSamples: skipped.slice(0, 5),
      warningCount: warnings.length,
      warningSamples: warnings.slice(0, 5),
    };

    // Member chapter moves this file would cause: same shared logic as
    // import, compared against existing rows. Importing confirms these.
    const desired = computeDesiredChapters(upload.rows, resolveHomeChapter());
    let chapterMoves: { count: number; samples: string[] } = { count: 0, samples: [] };
    if (desired.size > 0) {
      const sb = getSupabaseServer();
      const { data: existingMembers } = await sb
        .from("members")
        .select("id,name,chapter_id,chapters(name)")
        .limit(20000);
      const moves: string[] = [];
      for (const m of ((existingMembers ?? []) as {
        name: string;
        chapter_id: string;
        chapters: { name: string } | { name: string }[] | null;
      }[])) {
        const w = desired.get(String(m.name).toLowerCase());
        if (!w) continue;
        const rel = Array.isArray(m.chapters) ? m.chapters[0] : m.chapters;
        const current = rel?.name ?? "";
        if (current && current.toLowerCase() !== w.chapter.toLowerCase()) {
          moves.push(`${m.name}: ${current} → ${w.chapter}`);
        }
      }
      // One entry per member even if matched twice (case variants collapse).
      const unique = [...new Set(moves)];
      chapterMoves = { count: unique.length, samples: unique.slice(0, 5) };
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
      rowIssues,
      chapterMoves,
      ceuRows,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Preview failed." },
      { status: 500 },
    );
  }
}
