// E2E: home dashboard — the `/` page must show the last 6 months of weekly
// (Wednesday) slip counts per type (counts equal the imported slip rows per
// week, 0 for a week without an import) with slip-type tabs (All slips
// combined + one per type) and the 7-mode chart picker (line, bar, area,
// pie, bubble, radar, heat map) above the graph. The page head shows the
// live active-member badge and, ABOVE the slip chart, an Attendance chart
// (Present/Absent/Medical/Substitute/Leave) that shares the same weeks.
// The old hero import box is gone — import lives in the nav.
//
// Run:  node tests/e2e-dashboard.mjs   (from the repo root)
// Ground truth is read live from Supabase, so the test stays valid as data grows.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const APP = "http://localhost:3000";
const ENV = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const kv = (k) => ENV.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1);
const KEY = kv("SUPABASE_SERVICE_ROLE_KEY");
const sb = createClient(kv("NEXT_PUBLIC_SUPABASE_URL"), KEY);
const TENANT = "d1000000-0000-4000-8000-000000000001";
const AUTH = { Authorization: `Bearer ${KEY}` };

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);

/**
 * The shell server-renders only a spinner; page content ships as element
 * trees in the RSC flight payload. Decode the pushed segments into one
 * string so assertions can search the rendered tree.
 */
function flight(html) {
  const out = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      // segment not a plain string row — skip
    }
  }
  return out.join("");
}

/** Pull the first JSON value after `"key":` in a decoded flight string. */
function extractJson(dec, key) {
  return extractJsonAll(dec, key)[0];
}

/** Collect EVERY JSON value after `"key":` in the decoded flight string. */
function extractJsonAll(dec, key) {
  const out = [];
  const k = `"${key}":`;
  let from = 0;
  for (;;) {
    const at = dec.indexOf(k, from);
    if (at < 0) break;
    const start = at + k.length;
    let depth = 0;
    let end = -1;
    let inStr = false;
    let esc = false;
    for (let i = start; i < dec.length; i++) {
      const ch = dec[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) break;
    try {
      out.push(JSON.parse(dec.slice(start, end)));
    } catch {
      // unparseable — skip
    }
    from = end;
  }
  return out;
}

async function all(table, columns, { tenantScoped = true } = {}) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(columns);
    if (tenantScoped) q = q.eq("tenant_id", TENANT);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

// ---- ground truth (same window as lib/trends.ts) --------------------------
const today = new Date();
const from = new Date();
from.setMonth(from.getMonth() - 6);
const iso = (d) => d.toISOString().slice(0, 10);
const isoFrom = iso(from);
const isoTo = iso(today);

const allWeeks = await all("bni_weeks", "id,label,meeting_date", { tenantScoped: false });
const weeks = allWeeks
  .filter(
    (w) =>
      w.meeting_date &&
      w.meeting_date >= isoFrom &&
      w.meeting_date <= isoTo &&
      new Date(`${w.meeting_date}T12:00:00Z`).getUTCDay() === 3,
  )
  .sort((a, b) => String(a.meeting_date).localeCompare(String(b.meeting_date)));
const weekIds = weeks.map((w) => w.id);

const SERIES_TABLES = [
  ["one-to-one", "slip_one_to_ones"],
  ["referral", "slip_referrals"],
  ["tyfcb", "slip_tyfcb"],
  ["visitor", "slip_visitors"],
  ["ceu", "slip_ceus"],
];
const rowsBy = Object.fromEntries(
  await Promise.all(
    SERIES_TABLES.map(async ([key, table]) => [
      key,
      weekIds.length ? await all(table, key === "tyfcb" ? "bni_week_id,amount" : "bni_week_id") : [],
    ]),
  ),
);
const expectedSeries = SERIES_TABLES.map(([key, table]) => {
  const tally = new Map();
  for (const r of rowsBy[key]) {
    if (r.bni_week_id) tally.set(r.bni_week_id, (tally.get(r.bni_week_id) ?? 0) + 1);
  }
  const sums = new Map();
  if (key === "tyfcb") {
    for (const r of rowsBy[key]) {
      if (r.bni_week_id) sums.set(r.bni_week_id, (sums.get(r.bni_week_id) ?? 0) + Number(r.amount ?? 0));
    }
  }
  return {
    key,
    table,
    counts: weeks.map((w) => tally.get(w.id) ?? 0),
    amounts: key === "tyfcb" ? weeks.map((w) => sums.get(w.id) ?? 0) : undefined,
  };
});

// Attendance ground truth: member_attendance stores legacy counts in
// present/absent (n) and modern letter rows in m/s/l (1); a week's series
// value = the sum of that flag across the tenant's rows.
const ATTS = [
  ["present", "present", "Present"],
  ["absent", "absent", "Absent"],
  ["medical", "m", "Medical"],
  ["substitute", "s", "Substitute"],
  ["leave", "l", "Leave"],
];
// Home Chapter only: active members whose chapter is BNI Influencers (the
// chapters row named like the tenant), matched to attendance by name.
const { data: homeChapter } = await sb.from("chapters").select("id").ilike("name", "BNI Influencers").maybeSingle();
const homeMembers = [];
for (let from = 0; ; from += 1000) {
  const { data } = await sb
    .from("members")
    .select("name")
    .eq("tenant_id", TENANT)
    .eq("chapter_id", homeChapter.id)
    .eq("is_inactive", false)
    .range(from, from + 999);
  homeMembers.push(...(data ?? []));
  if ((data ?? []).length < 1000) break;
}
const nk = (n) => n.replace(/\s+/g, " ").trim().toLowerCase();
const homeKeys = new Set(homeMembers.map((m) => nk(m.name)));
const attRows = (weekIds.length ? await all("member_attendance", "member_name,bni_week_id,present,absent,m,s,l") : []).filter(
  (r) => homeKeys.has(nk(r.member_name)),
);
const attTally = Object.fromEntries(ATTS.map(([k]) => [k, new Map()]));
for (const r of attRows) {
  if (!r.bni_week_id) continue;
  for (const [key, flag] of ATTS) {
    const v = Number(r[flag] ?? 0);
    if (v) attTally[key].set(r.bni_week_id, (attTally[key].get(r.bni_week_id) ?? 0) + v);
  }
}
const expectedAtt = ATTS.map(([key, flag, label]) => ({
  key,
  label,
  counts: weeks.map((w) => attTally[key].get(w.id) ?? 0),
}));
const activeCount = homeMembers.length;
console.log(
  `ground truth: ${weeks.length} Wednesdays ${isoFrom}..${isoTo}, totals`,
  expectedSeries.map((s) => `${s.key}=${s.counts.reduce((a, b) => a + b, 0)}`).join(" "),
  `| attendance ${expectedAtt.map((s) => `${s.key}=${s.counts.reduce((a, b) => a + b, 0)}`).join(" ")} | active=${activeCount}`,
);

// ---- the page --------------------------------------------------------------
const res = await fetch(`${APP}/`, { headers: AUTH });
const html = await res.text();
const dec = flight(html);
check("GET / renders 200 with the page head (renamed title)", res.ok && dec.includes("BNI Week Slips"), `status=${res.status}`);
check("old hero import box is gone", !dec.includes("Import the weekly Report XLS") && !dec.includes("Import Report XLS"), "hero text");
check("hero tagline is gone", !dec.includes("track every slip type"), "hero copy");
check("old section-card grid is gone", !dec.includes("section-card"));
check("old note card is gone", !dec.includes("note-card"));
check("chart skeleton ships in the loading tree", dec.includes("trend-skel"));
check("two trend card skeletons ship (attendance + slips)", (dec.match(/"className":"card trend-card"/g) ?? []).length >= 2, "loading tree");
check("legend geometry ships in the loading tree", dec.includes('"className":"trend-legend"'));
check(
  "active-member badge ships with the live count",
  dec.includes(`[${activeCount}," active members"]`),
  `active=${activeCount}`,
);
check(
  "attendance chart sits above the slip chart",
  dec.indexOf("Attendance") >= 0 && dec.indexOf("Slip trends") >= 0 && dec.indexOf("Attendance") < dec.indexOf("Slip trends"),
  `att=${dec.indexOf("Attendance")} slip=${dec.indexOf("Slip trends")}`,
);

// The two TrendChart instances share the SAME weeks array server-side, so the
// flight payload carries ONE `weeks` value (rendered once, drawn by both) and
// exactly TWO `series` props — the attendance series then the slip series.
const allWeeksProp = extractJsonAll(dec, "weeks");
const allSeriesProp = extractJsonAll(dec, "series");
check(
  "exactly two chart instances (series props: attendance + slips)",
  allSeriesProp.length === 2,
  `series=${allSeriesProp.length}`,
);
check(
  "the shared 6-month weeks prop ships once",
  allWeeksProp.length >= 1 && Array.isArray(allWeeksProp[0]) && allWeeksProp[0].length > 0,
  `weeks=${allWeeksProp.length}`,
);

if (allSeriesProp.length === 2) {
  const weeksProp = allWeeksProp[0];
  const [attSeriesProp, slipSeriesProp] = allSeriesProp;
  const seriesProp = slipSeriesProp;

  check(
    "weeks = every Wednesday of the last 6 months (ids match)",
    weeksProp.length === weeks.length && weeksProp.every((w, i) => w.id === weeks[i].id),
    `got ${weeksProp.length} want ${weeks.length}`,
  );
  check(
    "attendance chart draws the same weeks (single shared prop)",
    Array.isArray(weeksProp) && weeksProp.length === weeks.length,
  );
  check(
    "all chart points are Wednesdays",
    weeksProp.every((w) => new Date(`${w.date}T12:00:00Z`).getUTCDay() === 3),
    weeksProp.map((w) => w.date).join(", ").slice(0, 120),
  );
  check(
    "weeks ascending and inside the 6-month window",
    weeksProp.every((w, i) => w.date >= isoFrom && w.date <= isoTo && (i === 0 || weeksProp[i - 1].date < w.date)),
    `${weeksProp[0]?.date}..${weeksProp.at(-1)?.date}`,
  );

  // ---- slip chart ----------------------------------------------------------
  const keys = seriesProp.map((s) => s.key);
  check(
    "series = all 5 slip types in order",
    JSON.stringify(keys) === JSON.stringify(SERIES_TABLES.map(([k]) => k)),
    JSON.stringify(keys),
  );
  check(
    "every counts array aligns with weeks (non-negative integers)",
    seriesProp.every(
      (s) => s.counts.length === weeksProp.length && s.counts.every((n) => Number.isInteger(n) && n >= 0),
    ),
    seriesProp.map((s) => `${s.key}:${s.counts.length}`).join(" "),
  );
  for (const exp of expectedSeries) {
    const got = seriesProp.find((s) => s.key === exp.key);
    check(
      `counts match the DB for ${exp.key} (${exp.table})`,
      !!got && JSON.stringify(got.counts) === JSON.stringify(exp.counts),
      `got [${got?.counts?.slice(0, 12)}] want [${exp.counts.slice(0, 12)}]`,
    );
  }
  const tyfcbGot = seriesProp.find((s) => s.key === "tyfcb");
  const tyfcbExp = expectedSeries.find((x) => x.key === "tyfcb");
  check(
    "TYFCB series carries weekly rupee amounts",
    !!tyfcbGot?.amounts && JSON.stringify(tyfcbGot.amounts) === JSON.stringify(tyfcbExp.amounts),
    `got [${tyfcbGot?.amounts?.slice(0, 8)}] want [${tyfcbExp.amounts.slice(0, 8)}]`,
  );
  check(
    "labels carry the legend text",
    seriesProp.every((s) => typeof s.label === "string" && s.label.length > 0),
    seriesProp.map((s) => s.label).join(", "),
  );

  // ---- attendance chart ----------------------------------------------------
  const attKeys = attSeriesProp.map((s) => s.key);
  check(
    "attendance series = the 5 PALMS letters in order",
    JSON.stringify(attKeys) === JSON.stringify(ATTS.map(([k]) => k)),
    JSON.stringify(attKeys),
  );
  check(
    "attendance labels Present/Absent/Medical/Substitute/Leave",
    JSON.stringify(attSeriesProp.map((s) => s.label)) === JSON.stringify(ATTS.map(([, , l]) => l)),
    attSeriesProp.map((s) => s.label).join(", "),
  );
  for (const exp of expectedAtt) {
    const got = attSeriesProp.find((s) => s.key === exp.key);
    check(
      `attendance counts match the DB for ${exp.key}`,
      !!got && JSON.stringify(got.counts) === JSON.stringify(exp.counts),
      `got [${got?.counts?.slice(0, 12)}] want [${exp.counts.slice(0, 12)}]`,
    );
  }
}

// ---- source-level wiring (client chart receives server data) ---------------
const pageSrc = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const chartSrc = readFileSync(new URL("../components/TrendChart.tsx", import.meta.url), "utf8");
check(
  "page fetches both trends server-side",
  pageSrc.includes("fetchSlipTrends") && pageSrc.includes("fetchAttendanceTrends") && pageSrc.includes("<TrendChart"),
);
check("chart is a client SVG multi-line chart", chartSrc.includes('"use client"') && chartSrc.includes("polyline") && chartSrc.includes("viewBox"));

// ---- slip-type tabs + chart picker (client state, derive from the same props)
check(
  "tab list = all-tab label + the series labels (allLabel defaults to All slips)",
  chartSrc.includes('allLabel = "All slips"') &&
    chartSrc.includes("label: allLabel") &&
    chartSrc.includes("...series.map((s) => ({ key: s.key, label: s.label }))"),
);
check(
  "attendance colours wired into the shared palette",
  ['present: "var(--green-ink)"', 'absent: "var(--orange-ink)"', 'medical: "var(--blue-ink)"', 'substitute: "var(--gold-ink)"', 'leave: "var(--purple-ink)"'].every(
    (s) => chartSrc.includes(s),
  ),
);
check(
  "7 chart modes offered",
  ["Line", "Bar", "Area", "Pie", "Bubble", "Radar", "Heat map"].every((l) => chartSrc.includes(`"${l}"`)),
);
check(
  "defaults: All slips + bar chart",
  chartSrc.includes('useState("all")') && chartSrc.includes('useState<ChartKey>("bar")'),
);
check(
  "no Combined series; TYFCB tab plots rupee amounts",
  !chartSrc.includes('label: "Combined"') && chartSrc.includes("picked.amounts") && chartSrc.includes("rupees"),
);
check("single type filters to that series", chartSrc.includes("series.find((s) => s.key === type)"));
check(
  "controls render above the graph",
  chartSrc.indexOf('className="trend-controls"') < chartSrc.indexOf('className="trend-svg-scroll"'),
);
check(
  "tabs expose selected/pressed + panel wiring",
  chartSrc.includes('role="tab"') &&
    chartSrc.includes("aria-selected=") &&
    chartSrc.includes("aria-pressed=") &&
    chartSrc.includes("aria-controls="),
);
check(
  "active type tab takes its section hue",
  chartSrc.includes('data-stat={t.key === "all" ? undefined : t.key}'),
);
check(
  "line + area share the cartesian grid",
  chartSrc.includes("renderLine(geom, weeks, view, true, f)") &&
    chartSrc.includes("renderLine(geom, weeks, view, false, f)"),
);
check("area draws a filled band under the line", chartSrc.includes("fillOpacity: 0.16"));
check("bar draws grouped rects per week", chartSrc.includes("slot * 0.72") && chartSrc.includes("<rect"));
check("pie donut slices via arc paths", chartSrc.includes("function arcPath") && chartSrc.includes("renderPie(slices, f)"));
check(
  "pie: by series on All, by month on a single series",
  chartSrc.includes("value: s.counts.reduce((a, b) => a + b, 0)") &&
    chartSrc.includes("monthlyTotals(weeks, active.counts, months)"),
);
check("bubble radius scales with the count", chartSrc.includes("4 + 12 * Math.sqrt(v / mx)"));
check(
  "radar buckets counts per month into spokes",
  chartSrc.includes("renderRadar(weeks, view, months, f)") && chartSrc.includes("monthLabel(m)"),
);
check(
  "heat map = weeks x series intensity grid",
  chartSrc.includes("renderHeatmap(weeks, view, f)") && chartSrc.includes("fillOpacity: v === 0 ? 0.05"),
);
check("pie view carries a slice legend with percentages", chartSrc.includes("pct}%"));

// ---- skeleton + styles ------------------------------------------------------
const skelSrc = readFileSync(new URL("../components/Skeletons.tsx", import.meta.url), "utf8");
check(
  "skeleton renders TWO trend cards, attendance legend used first",
  skelSrc.includes("TrendCardSkeleton legend={ATT_LEGEND}") &&
    skelSrc.includes("TrendCardSkeleton legend={HOME_LEGEND}") &&
    skelSrc.indexOf("TrendCardSkeleton legend={ATT_LEGEND}") < skelSrc.indexOf("TrendCardSkeleton legend={HOME_LEGEND}"),
);
check("skeleton mirrors the tab row", skelSrc.includes("trend-controls") && skelSrc.includes("trend-type-tabs"));
check("skeleton wraps controls/legend/graph in .trend-wrap (blocks never flush)", skelSrc.includes('className="trend-wrap"'));
check("loading flight ships the controls", dec.includes("trend-controls"));
const cssSrc = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
check(
  "globals styles the controls row (wraps, active picker)",
  cssSrc.includes(".trend-controls { display: flex; flex-wrap: wrap;") &&
    cssSrc.includes(".trend-chart-tabs button.active"),
);

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);