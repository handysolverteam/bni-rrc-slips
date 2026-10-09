import { checkFileChapter, previewTarget } from "@/lib/chapter-target";
import { aliasPalmsMembers, findSimilar, parseMergePicks, type AliasMap, nameKey } from "@/lib/alias-map";
import { loadAliasMap } from "@/lib/member-aliases";
import { findNewHomeNames, listHomeMemberNames } from "@/lib/new-members";
import { parsePalmsWideFile } from "@/lib/palms-import";
import { planPalmsImport } from "@/lib/palms-view";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/** Bulk parsing can exceed the default serverless timeout on file uploads. */
export const maxDuration = 60;

/** Counts against a chapter that does not exist yet: everything is new. */
const NO_TENANT = "00000000-0000-0000-0000-000000000000";

/**
 * Dry run of the wide PALMS import: parses the file and reports how its
 * cells split into "new" vs "already imported (will be skipped)", plus any
 * header dates that are not on the chapter's Wednesday calendar and any
 * cells whose value is not a known attendance letter. Also reports the chapter
 * named in the file (`chapter`: match / undetected / choose) and the members
 * the import would ADD to the Home Chapter (`newMembers`, ticked by default in
 * the UI). The optional `chapter` form field re-runs the counts against a
 * chosen existing chapter or a typed new one. Nothing is written.
 * Requires tenant only — same write surface as the import itself.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
    if (!file.name.match(/\.(xls|xlsx)$/i)) {
      return Response.json({ error: "Only .xls/.xlsx supported" }, { status: 400 });
    }

    const parsed = parsePalmsWideFile(Buffer.from(await file.arrayBuffer()));
    if (parsed.errors.length > 0) {
      return Response.json({ error: parsed.errors[0], errors: parsed.errors }, { status: 400 });
    }
    const caller = { uid: ctx.uid, tenantId: ctx.tenantId };
    const chapter = await checkFileChapter(caller, parsed.chapterName);
    const target = await previewTarget(caller, form.get("chapter"));
    // Remembered merges first, so the counts and the new-member list match what the import will do.
    const aliasMap: AliasMap = target.tenantId ? await loadAliasMap(target.tenantId) : new Map();
    for (const [a, c] of Object.entries(parseMergePicks(form.get("mergeMembers")))) aliasMap.set(nameKey(a), c);
    const aliased = { ...parsed, members: aliasPalmsMembers(parsed.members, aliasMap) };
    const plan = await planPalmsImport(target.tenantId ?? NO_TENANT, aliased);
    const newMembers = target.tenantId
      ? await findNewHomeNames(target.tenantId, target.homeName, aliased.members.map((m) => m.name))
      : [...new Set(aliased.members.map((m) => m.name))].sort((a, b) => a.localeCompare(b));
    const existingNames = target.tenantId ? await listHomeMemberNames(target.tenantId, target.homeName) : [];
    const similar: Record<string, string[]> = {};
    for (const n of newMembers) {
      const s = findSimilar(n, existingNames);
      if (s.length > 0) similar[n] = s;
    }

    return Response.json({
      filename: file.name,
      from: parsed.from,
      to: parsed.to,
      memberCount: plan.memberCount,
      weeksMatched: new Set(plan.matchedColumns.map((c) => c.weekId)).size,
      weeksUnknown: plan.weeksUnknown,
      cellTotal: plan.cellTotal,
      cellNew: plan.cellNew,
      cellSkipped: plan.cellSkipped,
      skippedSamples: plan.skippedSamples,
      issues: plan.issues,
      chapter,
      homeChapter: target.homeName,
      newMembers,
      similar,
      errors: [],
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
