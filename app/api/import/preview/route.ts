import { dropDuplicates, rowSignature, SIG_FIELDS, type SlipTable } from "@/lib/import-dedup";
import { findWeekByDate, parseUpload, weekSlipCounts } from "@/lib/import-upload";
import { checkFileChapter, previewTarget } from "@/lib/chapter-target";
import { computeDesiredChapters } from "@/lib/member-chapters";
import { aliasReportRows, findSimilar, nameKey, parseMergePicks } from "@/lib/alias-map";
import { loadAliasMap } from "@/lib/member-aliases";
import { findNewHomeNames, listHomeMemberNames } from "@/lib/new-members";
import { signatureRows } from "@/lib/slip-signatures";
import { fetchAllRows } from "@/lib/supabase/paged";
import { validateReportRows } from "@/lib/report-import";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/**
 * Inspect an uploaded Report file WITHOUT importing it: resolves the week
 * from the file title and reports row problems so the UI can pause and ask
 * for permission when typing mistakes are found. Also counts how many valid
 * rows are NEW vs already imported for the week (same signatures as the
 * import route, lib/import-dedup.ts) so the UI can say what will be skipped.
 * In-file duplicates are still kept (owner rule): only rows already in the
 * database count as duplicates.
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

    const caller = { uid: ctx.uid, tenantId: ctx.tenantId };
    const chapter = await checkFileChapter(caller, upload.chapterName);
    // Counts + new members are computed against the chapter the import will
    // target (the active one, or the one picked / typed in the chooser).
    const target = await previewTarget(caller, form.get("chapter"));
    const tid = target.tenantId;
    // Remembered merges (and any picked in the UI) are applied first.
    const aliasMap = tid ? await loadAliasMap(tid) : new Map<string, string>();
    for (const [a, c] of Object.entries(parseMergePicks(form.get("mergeMembers")))) aliasMap.set(nameKey(a), c);
    const mappedRows = aliasReportRows(upload.rows, aliasMap);
    const desired = computeDesiredChapters(mappedRows, target.homeName);
    const homeNames = [...desired.values()]
      .filter((v) => v.chapter.toLowerCase() === target.homeName.toLowerCase())
      .map((v) => v.name);
    const newMembers = tid
      ? await findNewHomeNames(tid, target.homeName, homeNames)
      : [...new Set(homeNames)].sort((a, b) => a.localeCompare(b));
    const existingNames = tid ? await listHomeMemberNames(tid, target.homeName) : [];
    const similar: Record<string, string[]> = {};
    for (const n of newMembers) {
      const s = findSimilar(n, existingNames);
      if (s.length > 0) similar[n] = s;
    }

    const week = await findWeekByDate(upload.meetingDate);
    let slipCount = 0;
    let counts: Record<string, number> = {};
    const sigRows = signatureRows(mappedRows);
    const validRows = (Object.keys(sigRows) as SlipTable[]).reduce((n, t) => n + sigRows[t].length, 0);
    let duplicateCount = 0;
    if (week && tid) {
      const result = await weekSlipCounts(tid, week.id);
      slipCount = result.total;
      counts = result.counts;
      if (slipCount > 0) {
        for (const table of Object.keys(sigRows) as SlipTable[]) {
          if (sigRows[table].length === 0) continue;
          const existing = await fetchAllRows<Record<string, unknown>>(table, SIG_FIELDS[table].join(","), {
            eq: [
              ["tenant_id", tid],
              ["bni_week_id", week.id],
            ],
            pageSize: 1000,
          });
          const keys = new Set(existing.map((r) => rowSignature(table, r)));
          duplicateCount += dropDuplicates(table, sigRows[table], keys).duplicateCount;
        }
      }
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
      /** Valid rows not in the database yet / already there (skipped on import). */
      newCount: validRows - duplicateCount,
      duplicateCount,
      chapter,
      homeChapter: target.homeName,
      newMembers,
      similar,
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
