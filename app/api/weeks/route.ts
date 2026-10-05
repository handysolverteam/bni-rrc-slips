import { getCachedWeekOptions } from "@/lib/server-weeks";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

export async function GET(req: Request) {
  try {
    const ctx = await getTenantContext(req);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    return Response.json({ weeks: await getCachedWeekOptions(ctx.tenantId) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
