/**
 * Default file names for exports (pure, no imports — compiled standalone in
 * tests/unit-export-name.mjs). The name mirrors what is on screen: the report
 * kind, the week scope, the section tab and every active text filter, so a
 * downloaded file says what it contains.
 */

const MAX_PART = 36;
const MAX_NAME = 110;

/** One name part: letters/digits/dots kept, everything else becomes a single hyphen. */
function part(raw: string, max = MAX_PART): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** A name the user typed, made safe for every OS: no path / reserved characters, no extension duplicate. */
export function cleanFileName(raw: string, ext: string): string {
  let n = raw.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  const dot = `.${ext.toLowerCase()}`;
  if (n.toLowerCase().endsWith(dot)) n = n.slice(0, -dot.length).trim();
  n = n.replace(/^\.+/, "").replace(/[. ]+$/, "");
  return n.slice(0, 150);
}

function join(parts: (string | null | undefined | false)[]): string {
  const out = parts.filter((p): p is string => !!p && p.length > 0).join("_");
  return out.slice(0, MAX_NAME).replace(/[-_]+$/g, "") || "export";
}

const TAB_LABEL: Record<string, string> = {
  "one-to-one": "121",
  referral: "referrals",
  tyfcb: "tyfcb",
  visitor: "visitors",
  ceu: "ceu",
};

const COL_LABEL: Record<string, string> = { from: "from", to: "to", detail: "chapter" };

/**
 * Slip Report: `slip-report_<weeks>[_<tab>][_search-<q>][_<column>-<value>…]`.
 * `scopeLabel` is the week text shown on screen ("7 October 2026 (Week 41)", "All weeks", "5 meetings").
 */
export function reportDefaultName(opts: { scopeLabel: string; tab: string; query: URLSearchParams }): string {
  const { scopeLabel, tab, query } = opts;
  const filters: string[] = [];
  const q = (query.get("q") ?? "").trim();
  if (q) filters.push(`search-${part(q, 24)}`);
  for (const [k, v] of query.entries()) {
    const m = /^cf_[a-z0-9-]+_(from|to|detail)$/.exec(k);
    if (m && v.trim()) filters.push(`${COL_LABEL[m[1]]}-${part(v.split(",").slice(0, 2).join("-"), 28)}`);
  }
  return join([
    "slip-report",
    part(scopeLabel || "all-weeks", 44),
    tab && tab !== "all" ? TAB_LABEL[tab] ?? part(tab, 14) : "",
    ...filters.slice(0, 4),
  ]);
}

/** Traffic Lights: `traffic-lights_<range end date>[_<colour>][_member-<name>]` (the imported range + the filters on screen). */
export function trafficDefaultName(opts: { month: string; light?: string; nameFilter?: string }): string {
  const first = (opts.nameFilter ?? "").split(",")[0] ?? "";
  return join(["traffic-lights", part((opts.month || "latest").split("_").pop() || "latest", 10), opts.light ? part(opts.light, 8) : "", first.trim() ? `member-${part(first, 28)}` : ""]);
}

/** Attendance: `attendance_<weeks>`. */
export function attendanceDefaultName(opts: { scopeLabel: string }): string {
  return join(["attendance", part(opts.scopeLabel || "all-weeks", 60)]);
}
