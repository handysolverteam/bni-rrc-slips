/**
 * Member × week query index and the `chapter_query` tool executor.
 *
 * The index is built server-side alongside the chat snapshot (same rows, one
 * pass over the database) and is NEVER serialized into the prompt — the model
 * asks for scoped member-level data by calling the chapter_query tool, and the
 * executor answers from this structure. This is what lets the chat answer
 * "who did X in week Y / month M / date range R / all-time" instead of
 * refusing with "member-level splits are not available".
 */

export type QueryWeek = { id: string; label: string; date: string };

/** One sparse member × week activity row (only members with activity appear). */
export type QueryRow = {
  w: string; // week id
  m: string; // member key (normalized name)
  n: string; // display name
  rg: number; // referrals given
  ri: number; // given, inside chapter
  ro: number; // given, outside chapter
  rr: number; // referrals received
  oto: number; // one-to-one participation count
  vis: number; // visitors invited
  te: number; // TYFCB entries
  ta: number; // TYFCB amount
};

export type QueryIndex = { weeks: QueryWeek[]; rows: QueryRow[] };

export const METRIC_TO_FIELD = {
  referralsGiven: "rg",
  referralsInside: "ri",
  referralsOutside: "ro",
  referralsReceived: "rr",
  oneToOnes: "oto",
  visitorsInvited: "vis",
  tyfcbEntries: "te",
  tyfcbAmount: "ta",
} as const;

export type MetricKey = keyof typeof METRIC_TO_FIELD;
export const METRIC_KEYS = Object.keys(METRIC_TO_FIELD) as MetricKey[];

/** Tool schema advertised to Gemini (must stay in sync with the executor). */
export const CHAPTER_QUERY_TOOL = {
  name: "chapter_query",
  description:
    "Query member-level slips metrics for any time scope — a single meeting week, a month, a date range, the latest week, or all-time — with optional member filters, sorting and a row limit. Returns { scope, rowCount, distinct, totals, rows[] }. Call it for ANY member-level, scoped or filtered question; never answer a scoped 'who did X' question from memory.",
  parameters: {
    type: "object",
    properties: {
      scope: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["week", "month", "range", "all", "latest"],
            description: "week = one meeting (date or label text), month = YYYY-MM or 'September 2026', range = start..end dates, all = every week, latest = newest week with slips",
          },
          value: {
            type: "string",
            description: "week: '2026-09-30' or 'Week 40' or '30 September 2026'; month: '2026-09' or 'September 2026'; range: '2026-09-01..2026-10-15'",
          },
          start: { type: "string", description: "range start date (optional override)" },
          end: { type: "string", description: "range end date (optional override)" },
        },
        required: ["kind"],
      },
      metrics: {
        type: "array",
        items: { type: "string", enum: [...METRIC_KEYS] },
        description: "Columns to return per member. Omit for all eight.",
      },
      members: {
        type: "array",
        items: { type: "string" },
        description: "Optional: restrict rows to these member names (case-insensitive, partial match allowed).",
      },
      orderBy: {
        type: "string",
        description: "Metric to sort by, '-' or 'DESC' for descending (default '-referralsGiven').",
      },
      topN: { type: "integer", description: "Max rows to return (default 20, max 100)." },
    },
    required: ["scope"],
  },
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Tolerant date → 'YYYY-MM-DD'. Accepts ISO, YYYY-MM, d/m/y, and any
 *  Date.parse-friendly text ("30 September 2026"). */
function parseDateAny(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || /^\d{1,2}$/.test(s)) return null;
  const iso = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (iso) return iso[3] ? `${iso[1]}-${iso[2]}-${iso[3]}` : `${iso[1]}-${iso[2]}-01`;
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`; // day-first (en-GB app)
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function resolveScope(
  scope: Record<string, unknown>,
  index: QueryIndex,
): { ids: Set<string>; kind: string; matched: string[]; unmatched?: string; hint?: string } {
  const weeks = index.weeks;
  const kindRaw = typeof scope.kind === "string" ? scope.kind : "all";
  const kind = (["week", "month", "range", "all", "latest"] as const).includes(kindRaw as never)
    ? kindRaw
    : "all";
  const all = () => ({
    ids: new Set(weeks.map((w) => w.id)),
    kind,
    matched: weeks.map((w) => w.label),
  });
  if (kind === "all") return all();
  if (weeks.length === 0) return { ids: new Set(), kind, matched: [] };

  if (kind === "latest") {
    const active = new Set(
      index.rows
        .filter((r) => r.rg || r.ri || r.ro || r.rr || r.oto || r.vis || r.te || r.ta)
        .map((r) => r.w),
    );
    const w = weeks.find((x) => active.has(x.id));
    return w
      ? { ids: new Set([w.id]), kind, matched: [w.label] }
      : { ids: new Set(), kind, matched: [], hint: "No week has slips yet." };
  }

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  if (kind === "week") {
    const value = str(scope.value);
    const iso = parseDateAny(value);
    const v = value.toLowerCase();
    let hits = weeks.filter((w) => (iso && w.date === iso) || (v && w.label.toLowerCase().includes(v)));
    if (!hits.length && iso) {
      // Same meeting week: nearest Wednesday within ±6 days.
      const target = Date.parse(iso);
      hits = weeks.filter((w) => Math.abs(Date.parse(w.date) - target) <= 6 * 86_400_000);
    }
    if (!hits.length) {
      const near = iso
        ? [...weeks]
            .sort(
              (a, b) =>
                Math.abs(Date.parse(a.date) - Date.parse(iso)) -
                Math.abs(Date.parse(b.date) - Date.parse(iso)),
            )
            .slice(0, 3)
        : weeks.slice(0, 4);
      return {
        ids: new Set(),
        kind,
        matched: [],
        unmatched: value || "(empty)",
        hint: `No meeting matched. Nearest weeks: ${near.map((w) => w.label).join(" | ")}`,
      };
    }
    return { ids: new Set(hits.map((w) => w.id)), kind, matched: hits.map((w) => w.label) };
  }

  if (kind === "month") {
    const raw = str(scope.value) || str(scope.start);
    let prefix: string | null = /^\d{4}-\d{2}$/.test(raw) ? raw : null;
    if (!prefix && raw) {
      const t = Date.parse(raw);
      if (Number.isFinite(t)) {
        const d = new Date(t);
        prefix = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      }
    }
    const hits = prefix ? weeks.filter((w) => w.date.startsWith(prefix!)) : [];
    if (!hits.length) {
      return {
        ids: new Set(),
        kind,
        matched: [],
        unmatched: raw || "(empty)",
        hint: `No month matched. Nearest weeks: ${weeks.slice(0, 4).map((w) => w.label).join(" | ")}`,
      };
    }
    return { ids: new Set(hits.map((w) => w.id)), kind, matched: hits.map((w) => w.label) };
  }

  // range: start/end fields, else split value on "..", " to ", " - ", " – "
  const value = str(scope.value);
  let startS = str(scope.start);
  let endS = str(scope.end);
  if ((!startS || !endS) && value) {
    const parts = value.split(/\s*(?:\.\.|\bto\b|\s-\s|\s[–—]\s)\s*/i);
    if (parts.length >= 2) {
      startS = startS || parts[0].trim();
      endS = endS || parts[1].trim();
    } else if (!startS && !endS) {
      startS = value; // single date: treat as one-day range
    }
  }
  const start = parseDateAny(startS) ?? "0000-01-01";
  const end = parseDateAny(endS) ?? "9999-12-31";
  const hits = weeks.filter((w) => w.date >= start && w.date <= end);
  if (!hits.length) {
    return {
      ids: new Set(),
      kind,
      matched: [],
      unmatched: value || `${startS}..${endS}`,
      hint: `No meetings in that range. Nearest weeks: ${weeks.slice(0, 4).map((w) => w.label).join(" | ")}`,
    };
  }
  return { ids: new Set(hits.map((w) => w.id)), kind, matched: hits.map((w) => w.label) };
}

function normalizeMetrics(raw: unknown): MetricKey[] {
  if (Array.isArray(raw)) {
    const picked = raw.filter((m): m is MetricKey =>
      typeof m === "string" && (METRIC_KEYS as string[]).includes(m),
    );
    if (picked.length > 0) return [...new Set(picked)];
  }
  return [...METRIC_KEYS];
}

function parseOrderBy(raw: unknown): { field: string; desc: boolean } {
  const fallback = { field: "rg", desc: true };
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  let s = raw.trim();
  let desc = true;
  if (s.startsWith("-")) {
    desc = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    desc = false;
    s = s.slice(1);
  }
  if (/\basc\b/i.test(s)) desc = false;
  if (/\bdesc\b/i.test(s)) desc = true;
  s = s.replace(/\b(asc|desc)\b/gi, "").trim().replace(/^[-+]/, "");
  const match = METRIC_KEYS.find((k) => k.toLowerCase() === s.toLowerCase());
  if (!match) return fallback;
  return { field: METRIC_TO_FIELD[match], desc };
}

/**
 * Execute a chapter_query tool call against the index. Defensive by design:
 * every argument is coerced, unknown enum values fall back to a safe default,
 * and an unmatched scope returns an empty result WITH a hint listing the
 * nearest weeks so the model can answer gracefully instead of refusing.
 */
export function executeChapterQuery(args: unknown, index: QueryIndex): Record<string, unknown> {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const scopeIn = (a.scope && typeof a.scope === "object" ? a.scope : {}) as Record<string, unknown>;
  const scope = resolveScope(scopeIn, index);
  const metrics = normalizeMetrics(a.metrics);

  const memberFilters = Array.isArray(a.members)
    ? a.members.filter((m): m is string => typeof m === "string" && m.trim() !== "").map((m) => m.trim().toLowerCase())
    : [];

  type Agg = { name: string; rg: number; ri: number; ro: number; rr: number; oto: number; vis: number; te: number; ta: number };
  const byMember = new Map<string, Agg>();
  for (const r of index.rows) {
    if (!scope.ids.has(r.w)) continue;
    if (memberFilters.length > 0 && !memberFilters.some((f) => r.n.toLowerCase().includes(f))) continue;
    let e = byMember.get(r.m);
    if (!e) {
      e = { name: r.n, rg: 0, ri: 0, ro: 0, rr: 0, oto: 0, vis: 0, te: 0, ta: 0 };
      byMember.set(r.m, e);
    }
    e.rg += r.rg;
    e.ri += r.ri;
    e.ro += r.ro;
    e.rr += r.rr;
    e.oto += r.oto;
    e.vis += r.vis;
    e.te += r.te;
    e.ta += r.ta;
  }
  const entries = [...byMember.values()];

  const totals: Record<string, number> = {};
  for (const m of metrics) {
    const f = METRIC_TO_FIELD[m];
    totals[m] = entries.reduce((n, e) => n + (e as unknown as Record<string, number>)[f], 0);
  }
  const distinct = {
    referralGivers: entries.filter((e) => e.rg > 0).length,
    referralReceivers: entries.filter((e) => e.rr > 0).length,
    oneToOneParticipants: entries.filter((e) => e.oto > 0).length,
    visitorInviters: entries.filter((e) => e.vis > 0).length,
    tyfcbReceivers: entries.filter((e) => e.te > 0).length,
  };

  const { field, desc } = parseOrderBy(a.orderBy);
  entries.sort((x, y) => {
    const dx = (x as unknown as Record<string, number>)[field] - (y as unknown as Record<string, number>)[field];
    if (dx !== 0) return desc ? -dx : dx;
    return x.name.localeCompare(y.name);
  });
  const topN = Math.min(100, Math.max(1, Math.floor(Number(a.topN)) || 20));

  const rows = entries.slice(0, topN).map((e) => {
    const row: Record<string, unknown> = { name: e.name };
    for (const m of metrics) row[m] = (e as unknown as Record<string, number>)[METRIC_TO_FIELD[m]];
    return row;
  });

  const dates = scope.ids.size
    ? index.weeks.filter((w) => scope.ids.has(w.id)).map((w) => w.date).sort()
    : [];

  return {
    scope: {
      kind: scope.kind,
      matched: scope.matched,
      weeks: scope.ids.size,
      ...(scope.unmatched ? { unmatched: scope.unmatched } : {}),
      ...(scope.hint ? { hint: scope.hint } : {}),
      ...(dates.length ? { from: dates[0], to: dates[dates.length - 1] } : {}),
    },
    rowCount: entries.length, // members matching the scope/filters BEFORE topN
    distinct,
    totals,
    rows, // topN rows after orderBy
    metrics,
  };
}
