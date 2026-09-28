import { getCachedWeekOptions } from "@/lib/server-weeks";

export async function GET() {
  try {
    return Response.json({ weeks: await getCachedWeekOptions() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
