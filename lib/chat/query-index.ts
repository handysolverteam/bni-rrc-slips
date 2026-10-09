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
  pr: number; // PALMS: present
  ab: number; // PALMS: absent
  md: number; // PALMS: medical
  su: number; // PALMS: substitute
  lv: number; // PALMS: leave
};

/** Every member of the tenant (zero-activity members included), so "who did NOT ..." works. */
export type RosterMember = {
  key: string; // normalized name
  name: string;
  chapter: string | null;
  /** Belongs to the tenant's Home Chapter. */
  home: boolean;
  /** members.is_inactive = false. */
  active: boolean;
  category: string | null;
};

/** One slip with its names, for "which visitors / on which dates" questions. */
export type SlipEntry = {
  t: "referral" | "oneToOne" | "tyfcb" | "visitor";
  w: string; // week id
  a: string; // referral from / 121 initiator / TYFCB thanked member / visitor's inviter
  b: string; // referral to / 121 met with / TYFCB thanker / the visitor
  amt?: number; // TYFCB amount
  io?: string | null; // referral Inside/Outside
};

export type QueryIndex = {
  weeks: QueryWeek[];
  rows: QueryRow[];
  roster: RosterMember[];
  entries: SlipEntry[];
  /** Display name of the Home Chapter ("BNI Influencers"). */
  homeChapter: string;
};

export const METRIC_TO_FIELD = {
  referralsGiven: "rg",
  referralsInside: "ri",
  referralsOutside: "ro",
  referralsReceived: "rr",
  oneToOnes: "oto",
  visitorsInvited: "vis",
  tyfcbEntries: "te",
  tyfcbAmount: "ta",
  attendancePresent: "pr",
  attendanceAbsent: "ab",
  attendanceMedical: "md",
  attendanceSubstitute: "su",
  attendanceLeave: "lv",
} as const;

export type MetricKey = keyof typeof METRIC_TO_FIELD;
export const METRIC_KEYS = Object.keys(METRIC_TO_FIELD) as MetricKey[];

/** Tool schema advertised to Gemini (must stay in sync with the executor). */
export const CHAPTER_QUERY_TOOL = {
  name: "chapter_query",
  description:
    "Query member-level metrics (slips AND PALMS attendance) for any time scope — a single meeting week, a month, a date range, the latest week, the last N weeks/months, or all-time — with filters for chapter (home chapter or another), active/inactive status, a metric condition (e.g. visitorsInvited = 0), sorting and a row limit. Zero-activity members are included when you filter by chapter/status or set includeZero. Returns { scope, rowCount, distinct, totals, rows[] }. Call it for ANY member-level, scoped or filtered question; never answer a scoped 'who did X' question from memory.",
  parameters: {
    type: "object",
    properties: {
      scope: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["week", "month", "range", "all", "latest", "recent"],
            description: "week = one meeting (date or label text), month = YYYY-MM or 'September 2026', range = start..end dates, all = every week, latest = newest week with slips, recent = the last N meetings or months ending at the newest week with slips (set weeks or months, or value like '26 weeks' / '6 months')",
          },
          value: {
            type: "string",
            description: "week: '2026-09-30' or 'Week 40' or '30 September 2026'; month: '2026-09' or 'September 2026'; range: '2026-09-01..2026-10-15'",
          },
          start: { type: "string", description: "range start date (optional override)" },
          end: { type: "string", description: "range end date (optional override)" },
          weeks: { type: "integer", description: "recent: how many meetings back (e.g. 26)" },
          months: { type: "integer", description: "recent: how many months back (e.g. 6)" },
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
      chapter: {
        type: "string",
        description: "Restrict to members of one chapter: 'home' (the app's home chapter — use it for 'BNI Influencers' / 'BNI Influencer' / 'Influencers' / 'our chapter') or another chapter's name (partial, ignoring a leading 'BNI').",
      },
      status: {
        type: "string",
        enum: ["active", "inactive", "any"],
        description: "Member status filter (default any). 'active members' = active.",
      },
      includeZero: {
        type: "boolean",
        description: "Also return roster members with no activity in the scope (all zeros). Implied when chapter or status is set.",
      },
      where: {
        type: "object",
        description: "Keep only members whose metric satisfies the condition, e.g. { metric: 'visitorsInvited', op: 'eq', value: 0 } for 'brought 0 visitors'.",
        properties: {
          metric: { type: "string", enum: [...METRIC_KEYS] },
          op: { type: "string", enum: ["eq", "gt", "gte", "lt", "lte"] },
          value: { type: "number" },
        },
        required: ["metric", "op", "value"],
      },
      orderBy: {
        type: "string",
        description: "Metric to sort by, '-' or 'DESC' for descending (default '-referralsGiven'). Use '+metric' / 'ASC' for least-to-most.",
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
  const kind = (["week", "month", "range", "all", "latest", "recent"] as const).includes(kindRaw as never)
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

  if (kind === "recent") {
    // Anchor = the newest week that has any slip/attendance; the window runs back from there.
    const active = new Set(
      index.rows
        .filter((r) => r.rg || r.ri || r.ro || r.rr || r.oto || r.vis || r.te || r.ta || r.pr || r.ab || r.md || r.su || r.lv)
        .map((r) => r.w),
    );
    const withData = weeks.filter((w) => active.has(w.id)); // newest first
    if (withData.length === 0) return { ids: new Set(), kind, matched: [], hint: "No week has data yet." };
    const text = str(scope.value);
    const num = (v: unknown) => Math.floor(Number(v));
    let nWeeks = num(scope.weeks);
    let nMonths = num(scope.months);
    const m = text.match(/(\d+)\s*(week|month)/i);
    if (m) {
      if (/week/i.test(m[2])) nWeeks = nWeeks || Number(m[1]);
      else nMonths = nMonths || Number(m[1]);
    }
    let hits: typeof weeks;
    if (nWeeks > 0) {
      hits = withData.slice(0, nWeeks);
    } else {
      const months = nMonths > 0 ? nMonths : 6;
      const anchor = new Date(`${withData[0].date}T00:00:00Z`);
      anchor.setUTCMonth(anchor.getUTCMonth() - months);
      const from = anchor.toISOString().slice(0, 10);
      hits = withData.filter((w) => w.date > from);
    }
    return { ids: new Set(hits.map((w) => w.id)), kind, matched: hits.map((w) => w.label) };
  }

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

const chapterKeyOf = (raw: string): string =>
  raw
    .split(",")[0]
    .toLowerCase()
    .replace(/^bni\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

type Agg = Record<MetricField, number> & { name: string };
type MetricField = (typeof METRIC_TO_FIELD)[MetricKey];
const FIELDS = Object.values(METRIC_TO_FIELD) as MetricField[];
const zeroAgg = (name: string): Agg => {
  const e = { name } as Agg;
  for (const f of FIELDS) e[f] = 0;
  return e;
};

/**
 * Execute a chapter_query tool call against the index. Defensive by design:
 * every argument is coerced, unknown enum values fall back to a safe default,
 * and an unmatched scope returns an empty result WITH a hint listing the
 * nearest weeks so the model can answer gracefully instead of refusing.
 *
 * Roster filters (chapter / status / includeZero) start from the tenant's full
 * member list, so zero-activity members are returned — that is what makes
 * "active home-chapter members who brought 0 visitors in the last 26 weeks"
 * answerable. `where` then keeps only the members whose metric matches.
 */
export function executeChapterQuery(args: unknown, index: QueryIndex): Record<string, unknown> {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const scopeIn = (a.scope && typeof a.scope === "object" ? a.scope : {}) as Record<string, unknown>;
  const scope = resolveScope(scopeIn, index);
  const metrics = normalizeMetrics(a.metrics);

  const memberFilters = Array.isArray(a.members)
    ? a.members.filter((m): m is string => typeof m === "string" && m.trim() !== "").map((m) => m.trim().toLowerCase())
    : [];

  // Activity per member inside the scope.
  const byMember = new Map<string, Agg>();
  for (const r of index.rows) {
    if (!scope.ids.has(r.w)) continue;
    let e = byMember.get(r.m);
    if (!e) {
      e = zeroAgg(r.n);
      byMember.set(r.m, e);
    }
    for (const f of FIELDS) e[f] += r[f];
  }

  // Roster filters.
  const chapterRaw = typeof a.chapter === "string" ? a.chapter.trim() : "";
  const homeWords = /^(home|our|my|this)(\s+chapter)?$/i;
  const wantHome =
    homeWords.test(chapterRaw) || (chapterRaw !== "" && chapterKeyOf(chapterRaw) === chapterKeyOf(index.homeChapter));
  const status = a.status === "active" || a.status === "inactive" ? a.status : "any";
  const useRoster = chapterRaw !== "" || status !== "any" || a.includeZero === true;

  let entries: Agg[];
  let rosterMatched: number | null = null;
  if (useRoster) {
    const picked = index.roster.filter((m) => {
      if (chapterRaw) {
        if (wantHome) {
          if (!m.home) return false;
        } else if (!m.chapter || !chapterKeyOf(m.chapter).includes(chapterKeyOf(chapterRaw))) return false;
      }
      if (status === "active" && !m.active) return false;
      if (status === "inactive" && m.active) return false;
      return true;
    });
    rosterMatched = picked.length;
    entries = picked.map((m) => byMember.get(m.key) ?? zeroAgg(m.name));
    if (a.includeZero === true && !chapterRaw && status === "any") {
      // Whole roster plus anyone with activity but no roster row.
      const have = new Set(picked.map((m) => m.key));
      for (const [k, v] of byMember) if (!have.has(k)) entries.push(v);
    }
  } else {
    entries = [...byMember.values()];
  }
  if (memberFilters.length > 0) {
    entries = entries.filter((e) => memberFilters.some((f) => e.name.toLowerCase().includes(f)));
  }

  // Metric condition ("brought 0 visitors").
  const w = (a.where && typeof a.where === "object" ? a.where : null) as Record<string, unknown> | null;
  if (w) {
    const metric = METRIC_KEYS.find((k) => k === w.metric);
    const value = Number(w.value);
    const op = typeof w.op === "string" ? w.op : "eq";
    if (metric && Number.isFinite(value)) {
      const f = METRIC_TO_FIELD[metric];
      entries = entries.filter((e) => {
        const v = e[f];
        return op === "gt" ? v > value : op === "gte" ? v >= value : op === "lt" ? v < value : op === "lte" ? v <= value : v === value;
      });
    }
  }

  const totals: Record<string, number> = {};
  for (const m of metrics) {
    const f = METRIC_TO_FIELD[m];
    totals[m] = entries.reduce((n, e) => n + e[f], 0);
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
    const dx = x[field as MetricField] - y[field as MetricField];
    if (dx !== 0) return desc ? -dx : dx;
    return x.name.localeCompare(y.name);
  });
  const topN = Math.min(150, Math.max(1, Math.floor(Number(a.topN)) || 20));

  const rows = entries.slice(0, topN).map((e) => {
    const row: Record<string, unknown> = { name: e.name };
    for (const m of metrics) row[m] = e[METRIC_TO_FIELD[m]];
    return row;
  });

  const dates = scope.ids.size
    ? index.weeks.filter((wk) => scope.ids.has(wk.id)).map((wk) => wk.date).sort()
    : [];

  return {
    scope: {
      kind: scope.kind,
      matched: scope.matched.length > 12 ? [`${scope.matched.length} meetings`] : scope.matched,
      weeks: scope.ids.size,
      ...(scope.unmatched ? { unmatched: scope.unmatched } : {}),
      ...(scope.hint ? { hint: scope.hint } : {}),
      ...(dates.length ? { from: dates[0], to: dates[dates.length - 1] } : {}),
    },
    homeChapter: index.homeChapter,
    ...(rosterMatched !== null ? { rosterMembersMatched: rosterMatched } : {}),
    rowCount: entries.length, // members matching the scope/filters BEFORE topN
    distinct,
    totals,
    rows, // topN rows after orderBy
    metrics,
    ...(entries.length > topN ? { note: `Showing ${topN} of ${entries.length}; raise topN (max 150) to list more.` } : {}),
  };
}

/** Second tool: individual slips with their dates (which visitors, on which dates; who referred whom; each TYFCB). */
export const SLIP_ENTRIES_TOOL = {
  name: "slip_entries",
  description:
    "List individual slips with names and meeting dates: visitors (who invited which guest and when), referrals (from → to, inside/outside), one-to-ones (initiated by → met with) and TYFCB (member thanked, thanker, amount). Use it for 'which visitors did X bring and on which dates', 'who did X refer', 'list X's TYFCB'. Returns { scope, count, entries[] } newest first.",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["visitor", "referral", "oneToOne", "tyfcb", "all"], description: "Which slips (default all)." },
      scope: CHAPTER_QUERY_TOOL.parameters.properties.scope,
      member: {
        type: "string",
        description: "Member name (partial, case-insensitive). Matches either side unless 'role' narrows it.",
      },
      role: {
        type: "string",
        enum: ["either", "first", "second"],
        description: "first = visitor's inviter / referral giver / 121 initiator / TYFCB thanked member; second = the visitor / referral receiver / 121 partner / TYFCB thanker. Default either.",
      },
      limit: { type: "integer", description: "Max entries (default 50, max 200)." },
    },
    required: [],
  },
};

export function executeSlipEntries(args: unknown, index: QueryIndex): Record<string, unknown> {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const scopeIn = (a.scope && typeof a.scope === "object" ? a.scope : { kind: "all" }) as Record<string, unknown>;
  const scope = resolveScope(scopeIn, index);
  const type = ["visitor", "referral", "oneToOne", "tyfcb"].includes(String(a.type)) ? String(a.type) : "all";
  const member = typeof a.member === "string" ? a.member.trim().toLowerCase() : "";
  const role = a.role === "first" || a.role === "second" ? a.role : "either";
  const limit = Math.min(200, Math.max(1, Math.floor(Number(a.limit)) || 50));
  const weekOf = new Map(index.weeks.map((w) => [w.id, w]));

  const hits = index.entries.filter((e) => {
    if (!scope.ids.has(e.w)) return false;
    if (type !== "all" && e.t !== type) return false;
    if (member) {
      const first = e.a.toLowerCase().includes(member);
      const second = e.b.toLowerCase().includes(member);
      if (role === "first" ? !first : role === "second" ? !second : !(first || second)) return false;
    }
    return true;
  });
  hits.sort((x, y) => (weekOf.get(y.w)?.date ?? "").localeCompare(weekOf.get(x.w)?.date ?? ""));

  const entries = hits.slice(0, limit).map((e) => {
    const date = weekOf.get(e.w)?.date ?? "";
    switch (e.t) {
      case "visitor":
        return { type: "visitor", date, invitedBy: e.a || "(not recorded)", visitor: e.b };
      case "referral":
        return { type: "referral", date, from: e.a, to: e.b, tier: e.io ?? null };
      case "oneToOne":
        return { type: "oneToOne", date, initiatedBy: e.a, metWith: e.b };
      default:
        return { type: "tyfcb", date, memberThanked: e.a, thanker: e.b || null, amount: e.amt ?? 0 };
    }
  });
  return {
    scope: {
      kind: scope.kind,
      weeks: scope.ids.size,
      ...(scope.unmatched ? { unmatched: scope.unmatched } : {}),
      ...(scope.hint ? { hint: scope.hint } : {}),
    },
    count: hits.length,
    entries,
    ...(hits.length > limit ? { note: `Showing ${limit} of ${hits.length}; raise limit (max 200).` } : {}),
  };
}
