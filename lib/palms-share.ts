import type { PalmsBucketGroup } from "@/lib/palms-buckets";
import { whatsappShareUrl } from "@/lib/whatsapp";

const ICON: Record<PalmsBucketGroup["key"], string> = { absent: "❌", medical: "🩺", substitute: "🔁" };

/** WhatsApp text for the rolling 26-week "Active members" card; empty buckets
 *  are left out so the message stays short. */
export function buildPalmsStatsShare(
  fromLabel: string,
  toLabel: string,
  meetingCount: number,
  groups: PalmsBucketGroup[],
): string {
  const head = [
    "📋 Last 6 Months rolling period (26 weeks): Active members",
    `${fromLabel} – ${toLabel} · ${meetingCount} meeting(s)`,
  ].join("\n");
  const blocks = groups
    .map((g) =>
      g.buckets
        .filter((b) => b.count > 0)
        .map((b) => `${ICON[g.key]} ${b.label} (${b.count}): ${b.names.join(", ")}`)
        .join("\n"),
    )
    .filter(Boolean);
  return [head, ...blocks].join("\n\n");
}

export const palmsStatsShareUrl = (text: string): string => whatsappShareUrl(text);
