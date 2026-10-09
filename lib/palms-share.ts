import type { PalmsBucketGroup } from "@/lib/palms-buckets";
import { whatsappShareUrl } from "@/lib/whatsapp";

/** Heading symbol per group — basic-plane characters only (emoji arrive as "�" in WhatsApp on Windows). */
const GROUP: Record<PalmsBucketGroup["key"], { icon: string; title: string }> = {
  absent: { icon: "❌", title: "Absent" },
  medical: { icon: "✚", title: "Medical" },
  substitute: { icon: "⇄", title: "Substitute" },
};

/** "3+ Absents" -> "3+ times", "1 Absent" -> "1 time". */
const timesOf = (label: string): string => {
  const n = label.trim().split(/\s+/)[0] ?? "";
  return n === "1" ? "1 time" : `${n} times`;
};

/**
 * WhatsApp text for the rolling 26-week "Active members" card: a bold heading,
 * one bold block per letter (Absent / Medical / Substitute) and a "• 3+ times
 * (2): names" line per non-empty bucket. Bold is WhatsApp's *asterisks*.
 */
export function buildPalmsStatsShare(
  fromLabel: string,
  toLabel: string,
  meetingCount: number,
  groups: PalmsBucketGroup[],
): string {
  const head = [
    "★ *Attendance — last 6 months (26 weeks)*",
    "Active members",
    `${fromLabel} – ${toLabel} · ${meetingCount} meeting${meetingCount === 1 ? "" : "s"}`,
  ].join("\n");
  const blocks = groups
    .map((g) => {
      const lines = g.buckets
        .filter((b) => b.count > 0)
        .map((b) => `• *${timesOf(b.label)}* (${b.count}): ${b.names.join(", ")}`);
      if (lines.length === 0) return "";
      const { icon, title } = GROUP[g.key];
      return [`${icon} *${title}*`, ...lines].join("\n");
    })
    .filter(Boolean);
  return [head, ...blocks].join("\n\n");
}

export const palmsStatsShareUrl = (text: string): string => whatsappShareUrl(text);
