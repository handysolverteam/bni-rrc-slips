import { whatsappShareUrl } from "@/lib/whatsapp";

/** One ranked member in a month's top list. */
export type TopEntry = { name: string; value: number };

export type MonthTop = {
  /** `YYYY-MM` */
  key: string;
  /** e.g. "April 2026" */
  label: string;
  tyfcb: TopEntry[];
  referral: TopEntry[];
  visitor: TopEntry[];
};

/** Top `n` names by summed value (desc, then name). Blank names are ignored;
 *  names merge case-insensitively and keep their first spelling. */
export function rankTop(rows: { name: string | null | undefined; value: number }[], n = 3): TopEntry[] {
  const sums = new Map<string, TopEntry>();
  for (const r of rows) {
    const name = (r.name ?? "").replace(/\s+/g, " ").trim();
    if (!name || !Number.isFinite(r.value)) continue;
    const k = name.toLowerCase();
    const prev = sums.get(k);
    if (prev) prev.value += r.value;
    else sums.set(k, { name, value: r.value });
  }
  return [...sums.values()]
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, n);
}

const rupees = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

/**
 * WhatsApp text rules (shared with lib/palms-share.ts): WhatsApp bold (*text*)
 * for headings, plain numbering, and ONLY symbols from the basic multilingual
 * plane. Emoji (medals, trophies…) are outside it and WhatsApp on Windows
 * shows them as "�" when they arrive through a wa.me link, while ₹ — • ★ ➜ ➕
 * arrive intact.
 */
function block(icon: string, title: string, list: TopEntry[], fmt: (v: number) => string): string {
  const lines = list.length > 0 ? list.map((e, i) => `${i + 1}. ${e.name} — ${fmt(e.value)}`) : ["No data"];
  return [`${icon} *${title}*`, ...lines].join("\n");
}

/** WhatsApp-ready text for one month. */
export function buildMonthShare(m: MonthTop): string {
  return [
    `★ *Top 3 · ${m.label}*`,
    block("₹", "TYFCB — amount received", m.tyfcb, rupees),
    block("➜", "Referrals given", m.referral, (v) => String(v)),
    block("◆", "Visitors brought", m.visitor, (v) => String(v)),
  ].join("\n\n");
}

/** All months in one message (newest first, as shown on screen). */
export function buildAllShare(months: MonthTop[]): string {
  return months.map(buildMonthShare).join("\n\n――――――――――\n\n");
}

export const monthShareUrl = (m: MonthTop): string => whatsappShareUrl(buildMonthShare(m));
export const allShareUrl = (months: MonthTop[]): string => whatsappShareUrl(buildAllShare(months));
