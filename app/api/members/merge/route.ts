import { nameKey } from "@/lib/alias-map";
import { mergeMembers } from "@/lib/member-aliases";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/**
 * Merge one spelling of a member into another ({ from, into }): the member
 * rows, every stored slip name and the attendance move to `into`, and the
 * merge is remembered so later imports map `from` to `into` automatically.
 * Requires tenant only (roles were removed).
 */
export async function POST(request: Request) {
  const ctx = await getTenantContext(request);
  if (!ctx) return unauthorized();
  if ("noAccess" in ctx) return forbidden();

  const body = (await request.json().catch(() => null)) as { from?: unknown; into?: unknown } | null;
  const from = typeof body?.from === "string" ? body.from.replace(/\s+/g, " ").trim() : "";
  const into = typeof body?.into === "string" ? body.into.replace(/\s+/g, " ").trim() : "";
  if (!from || !into) return Response.json({ error: "Choose both names." }, { status: 400 });
  if (nameKey(from) === nameKey(into)) return Response.json({ error: "Those are the same name." }, { status: 400 });

  try {
    const result = await mergeMembers(ctx.tenantId, from, into);
    return Response.json({ ok: true, from, into, ...result });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Merge failed." }, { status: 500 });
  }
}
