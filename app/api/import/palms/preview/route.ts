import { parsePalmsWideFile } from "@/lib/palms-import";
import { planPalmsImport } from "@/lib/palms-view";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/** Bulk parsing can exceed the default serverless timeout on file uploads. */
export const maxDuration = 60;

/**
 * Dry run of the wide PALMS import: parses the file and reports how its
 * cells split into "new" vs "already imported (will be skipped)", plus any
 * header dates that are not on the chapter's Wednesday calendar and any
 * cells whose value is not a known attendance letter. Nothing is written.
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
    const plan = await planPalmsImport(ctx.tenantId, parsed);

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
      errors: [],
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
