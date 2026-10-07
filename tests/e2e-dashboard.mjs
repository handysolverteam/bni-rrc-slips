// E2E: home dashboard — the `/` page must show the last 6 months of weekly
// (Wednesday) slip counts per type (counts equal the imported slip rows per
// week, 0 for a week without an import), with slip-type tabs (All slips
// combined + one per type) and the 7-mode chart picker (line, bar, area,
// pie, bubble, radar, heat map) above the graph.
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

/** Pull the JSON value after the first `"key":` in a decoded flight string. */
function extractJson(dec, key) {
  const k = `"${key}":`;
  const at = dec.indexOf(k);
  if (at < 0) return undefined;
  const start = at + k.length;
  let depth = 0;
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
        try {
          return JSON.parse(dec.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
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
    SERIES_TABLES.map(async ([key, table]) => [key, weekIds.length ? await all(table, "bni_week_id") : []]),
  ),
);
const expectedSeries = SERIES_TABLES.map(([key, table]) => {
  const tally = new Map();
  for (const r of rowsBy[key]) {
    if (r.bni_week_id) tally.set(r.bni_week_id, (tally.get(r.bni_week_id) ?? 0) + 1);
  }
  return { key, table, counts: weeks.map((w) => tally.get(w.id) ?? 0) };
});
console.log(
  `ground truth: ${weeks.length} Wednesdays ${isoFrom}..${isoTo}, totals`,
  expectedSeries.map((s) => `${s.key}=${s.counts.reduce((a, b) => a + b, 0)}`).join(" "),
);

// ---- the page --------------------------------------------------------------
const res = await fetch(`${APP}/`, { headers: AUTH });
const html = await res.text();
const dec = flight(html);
check("GET / renders 200 with the hero", res.ok && html.includes("BNI Week Slips"), `status=${res.status}`);
check(
  "hero states the 6-month weekly trend",
  dec.includes("track every slip type as a weekly trend for the last 6 months"),
);
check("old section-card grid is gone", !dec.includes("section-card"));
check("old note card is gone", !dec.includes("note-card"));
check("chart skeleton ships in the loading tree", dec.includes("trend-skel"));
check("trend chart card wired into the page tree", dec.includes('"className":"card trend-card"'));
check("legend geometry ships in the loading tree", dec.includes('"className":"trend-legend"'));

const weeksProp = extractJson(dec, "weeks");
const seriesProp = extractJson(dec, "series");
check("trend props present in the flight payload", Array.isArray(weeksProp) && Array.isArray(seriesProp), `weeks=${typeof weeksProp} series=${typeof seriesProp}`);

if (Array.isArray(weeksProp) && Array.isArray(seriesProp)) {
  check(
    "weeks = every Wednesday of the last 6 months (ids match)",
    weeksProp.length === weeks.length && weeksProp.every((w, i) => w.id === weeks[i].id),
    `got ${weeksProp.length} want ${weeks.length}`,
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
  check(
    "labels carry the legend text",
    seriesProp.every((s) => typeof s.label === "string" && s.label.length > 0),
    seriesProp.map((s) => s.label).join(", "),
  );
}

// ---- source-level wiring (client chart receives server data) ---------------
const pageSrc = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const chartSrc = readFileSync(new URL("../components/TrendChart.tsx", import.meta.url), "utf8");
check("page fetches trends server-side", pageSrc.includes("fetchSlipTrends") && pageSrc.includes("<TrendChart"));
check("chart is a client SVG multi-line chart", chartSrc.includes('"use client"') && chartSrc.includes("polyline") && chartSrc.includes("viewBox"));

// ---- slip-type tabs + chart picker (client state, derive from the same props)
check(
  "tab list = All slips + the series labels",
  chartSrc.includes('label: "All slips"') &&
    chartSrc.includes("...series.map((s) => ({ key: s.key, label: s.label }))"),
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
  "All slips adds a Combined sum series",
  chartSrc.includes('label: "Combined"') &&
    chartSrc.includes("series.reduce((a, s) => a + (s.counts[i] ?? 0), 0)"),
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
  chartSrc.includes("renderLine(geom, weeks, view, true)") &&
    chartSrc.includes("renderLine(geom, weeks, view, false)"),
);
check("area draws a filled band under the line", chartSrc.includes("fillOpacity: 0.16"));
check("bar draws grouped rects per week", chartSrc.includes("slot * 0.72") && chartSrc.includes("<rect"));
check("pie donut slices via arc paths", chartSrc.includes("function arcPath") && chartSrc.includes("renderPie(slices)"));
check(
  "pie: by slip type on All, by month on a single type",
  chartSrc.includes("value: s.counts.reduce((a, b) => a + b, 0)") &&
    chartSrc.includes("monthlyTotals(weeks, active.counts, months)"),
);
check("bubble radius scales with the count", chartSrc.includes("4 + 12 * Math.sqrt(v / max)"));
check(
  "radar buckets counts per month into spokes",
  chartSrc.includes("renderRadar(weeks, view, months)") && chartSrc.includes("monthLabel(m)"),
);
check(
  "heat map = weeks x series intensity grid",
  chartSrc.includes("renderHeatmap(weeks, view)") && chartSrc.includes("fillOpacity: v === 0 ? 0.05"),
);
check("pie view carries a slice legend with percentages", chartSrc.includes("pct}%"));

// ---- skeleton + styles ------------------------------------------------------
const skelSrc = readFileSync(new URL("../components/Skeletons.tsx", import.meta.url), "utf8");
check("skeleton mirrors the tab row", skelSrc.includes("trend-controls") && skelSrc.includes("trend-type-tabs"));
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
