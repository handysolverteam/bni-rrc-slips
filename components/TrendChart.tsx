"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { SlipTrends, TrendSeries, TrendWeek } from "@/lib/trends";

/** Same section colours as the app's `data-stat` palette — consumed as CSS
    variables, so every view flips with the dark/light theme live (no
    re-render). The `*-ink` vars are the hues tuned to read on app surfaces:
    identical to the raw hues in light, brightened in dark. */
const COLORS: Record<string, string> = {
  "one-to-one": "var(--orange-ink)",
  referral: "var(--green-ink)",
  tyfcb: "var(--gold-ink)",
  visitor: "var(--blue-ink)",
  ceu: "var(--purple-ink)",
  // Attendance chart (home): the PALMS letters reuse the same app hues.
  present: "var(--green-ink)",
  absent: "var(--orange-ink)",
  medical: "var(--blue-ink)",
  substitute: "var(--gold-ink)",
  leave: "var(--purple-ink)",
};

const CHARTS = [
  { key: "line", label: "Line" },
  { key: "bar", label: "Bar" },
  { key: "area", label: "Area" },
  { key: "pie", label: "Pie" },
  { key: "bubble", label: "Bubble" },
  { key: "radar", label: "Radar" },
  { key: "heatmap", label: "Heat map" },
] as const;

type ChartKey = (typeof CHARTS)[number]["key"];

const W = 960;
const H = 340;
const PAD = { l: 44, r: 14, t: 16, b: 32 };

/** A series as drawn: `secondary` ones (TYFCB ₹ on the All view) use the right axis. */
type ViewSeries = TrendSeries & { secondary?: boolean };

type Geom = {
  n: number;
  innerW: number;
  innerH: number;
  top: number;
  x: (i: number) => number;
  y: (v: number) => number;
  ticks: number[];
  labelStep: number;
  /** Right padding (wider when the ₹ axis is shown). */
  r: number;
  /** Right ₹ axis (All view with TYFCB amounts); undefined otherwise. */
  y2?: (v: number) => number;
  ticks2?: number[];
  max2: number;
};

/** Round the y-axis maximum up to a 4-step "nice" number (ticks stay integers). */
function niceMax(max: number): number {
  for (const c of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]) {
    if (c * 4 >= max) return c * 4;
  }
  // Rupee totals: keep growing 1-2-5 steps so ticks stay round.
  for (let p = 1000; ; p *= 10) {
    for (const m of [1, 2, 5]) if (p * m * 4 >= max) return p * m * 4;
  }
}

type Fmt = (v: number) => string;
const plain: Fmt = (v) => String(v);
/** Compact Indian rupee formatting for the TYFCB amount view (axis + tooltips). */
const rupees: Fmt = (v) => {
  const a = Math.abs(v);
  const f = (n: number) => String(Math.round(n * 100) / 100);
  if (a >= 1e7) return `₹${f(v / 1e7)} Cr`;
  if (a >= 1e5) return `₹${f(v / 1e5)} L`;
  if (a >= 1e3) return `₹${f(v / 1e3)}K`;
  return `₹${f(v)}`;
};

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const monthKey = (date: string) => date.slice(0, 7);

const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" });

/** Weekly counts bucketed per calendar month (ascending, follows `months`). */
function monthlyTotals(weeks: TrendWeek[], counts: number[], months: string[]): number[] {
  const out = months.map(() => 0);
  weeks.forEach((w, i) => {
    const at = months.indexOf(monthKey(w.date));
    if (at >= 0) out[at] += counts[i] ?? 0;
  });
  return out;
}

type Slice = { label: string; value: number; color: string; opacity: number };

/** Right-hand ₹ axis labels (TYFCB on the All view). */
function rightAxis(g: Geom): ReactNode {
  if (!g.ticks2) return null;
  return g.ticks2.map((t, i) => (
    <text key={`r${t}`} className="trend-axis" x={W - g.r + 8} y={g.y(g.ticks[i]) + 4} textAnchor="start" style={{ fill: COLORS.tyfcb }}>
      {rupees(t)}
    </text>
  ));
}

function cartesianAxes(g: Geom, weeks: TrendWeek[], f: Fmt): ReactNode {
  return (
    <g>
      {g.ticks.map((t) => (
        <g key={t}>
          <line className="trend-grid" x1={PAD.l} x2={W - g.r} y1={g.y(t)} y2={g.y(t)} />
          <text className="trend-axis" x={PAD.l - 8} y={g.y(t) + 4} textAnchor="end">
            {f(t)}
          </text>
        </g>
      ))}
      {rightAxis(g)}
      {weeks.map((w, i) =>
        i % g.labelStep === 0 || i === g.n - 1 ? (
          <text key={w.id} className="trend-axis" x={g.x(i)} y={H - 10} textAnchor="middle">
            {dayLabel(w.date)}
          </text>
        ) : null,
      )}
    </g>
  );
}

function renderLine(g: Geom, weeks: TrendWeek[], view: ViewSeries[], fill: boolean, f: Fmt): ReactNode {
  return (
    <g>
      {view.map((s) => {
        const color = COLORS[s.key] ?? "var(--muted)";
        const sw = 2;
        const yf = s.secondary && g.y2 ? g.y2 : g.y;
        const sf = s.secondary ? rupees : f;
        return (
          <g key={s.key}>
            {fill && g.n > 1 ? (
              <polygon
                points={[
                  ...s.counts.map((v, i) => `${g.x(i)},${yf(v)}`),
                  `${g.x(g.n - 1)},${g.y(0)}`,
                  `${g.x(0)},${g.y(0)}`,
                ].join(" ")}
                style={{ fill: color, fillOpacity: 0.16 }}
              />
            ) : null}
            <polyline
              fill="none"
              style={{ stroke: color }}
              strokeWidth={sw}
              strokeLinejoin="round"
              points={s.counts.map((v, i) => `${g.x(i)},${yf(v)}`).join(" ")}
            />
            {s.counts.map((v, i) => (
              <circle key={i} cx={g.x(i)} cy={yf(v)} r={3} style={{ fill: color }}>
                <title>{`${s.label} — ${dayLabel(weeks[i].date)}: ${sf(v)}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </g>
  );
}

function renderBar(g: Geom, weeks: TrendWeek[], view: ViewSeries[], f: Fmt): ReactNode {
  const slot = g.innerW / g.n;
  const group = slot * 0.72;
  const bw = group / view.length;
  const base = g.y(0);
  return (
    <g>
      {g.ticks.map((t) => (
        <g key={t}>
          <line className="trend-grid" x1={PAD.l} x2={W - g.r} y1={g.y(t)} y2={g.y(t)} />
          <text className="trend-axis" x={PAD.l - 8} y={g.y(t) + 4} textAnchor="end">
            {f(t)}
          </text>
        </g>
      ))}
      {rightAxis(g)}
      {view.map((s, si) =>
        s.counts.map((v, i) =>
          v > 0 ? (
            <rect
              key={`${s.key}-${i}`}
              x={PAD.l + i * slot + (slot - group) / 2 + si * bw}
              y={(s.secondary && g.y2 ? g.y2 : g.y)(v)}
              width={Math.max(1, bw - 1)}
              height={Math.max(1, base - (s.secondary && g.y2 ? g.y2 : g.y)(v))}
              style={{ fill: COLORS[s.key] ?? "var(--muted)" }}
            >
              <title>{`${s.label} — ${dayLabel(weeks[i].date)}: ${(s.secondary ? rupees : f)(v)}`}</title>
            </rect>
          ) : null,
        ),
      )}
      {weeks.map((w, i) =>
        i % g.labelStep === 0 || i === g.n - 1 ? (
          <text
            key={w.id}
            className="trend-axis"
            x={PAD.l + i * slot + slot / 2}
            y={H - 10}
            textAnchor="middle"
          >
            {dayLabel(w.date)}
          </text>
        ) : null,
      )}
    </g>
  );
}

function arcPath(cx: number, cy: number, r: number, r0: number, a0: number, a1: number): string {
  const P = (a: number, rad: number) => `${cx + Math.cos(a) * rad},${cy + Math.sin(a) * rad}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${P(a0, r)} A${r},${r} 0 ${large} 1 ${P(a1, r)} L${P(a1, r0)} A${r0},${r0} 0 ${large} 0 ${P(a0, r0)} Z`;
}

function renderPie(slices: Slice[], f: Fmt): ReactNode {
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) {
    return (
      <text className="trend-axis" x={W / 2} y={H / 2} textAnchor="middle">
        No slips in this window.
      </text>
    );
  }
  const cx = W / 2;
  const cy = H / 2;
  const R = 134;
  const R0 = 68;
  let a = -Math.PI / 2;
  return (
    <g>
      {slices.map((s) => {
        const sweep = (s.value / total) * Math.PI * 2;
        const a0 = a;
        a += sweep;
        const key = s.label;
        if (sweep >= Math.PI * 2 - 1e-6) {
          return (
            <g key={key}>
              <circle cx={cx} cy={cy} r={R} style={{ fill: s.color, fillOpacity: s.opacity }} />
              <circle cx={cx} cy={cy} r={R0} style={{ fill: "var(--card)" }} />
              <title>{`${s.label}: ${f(s.value)}`}</title>
            </g>
          );
        }
        return (
          <path
            key={key}
            d={arcPath(cx, cy, R, R0, a0, a)}
            style={{ fill: s.color, fillOpacity: s.opacity }}
            stroke="var(--card)"
            strokeWidth={1.5}
          >
            <title>{`${s.label}: ${f(s.value)} (${Math.round((s.value / total) * 100)}%)`}</title>
          </path>
        );
      })}
    </g>
  );
}

function renderRadar(weeks: TrendWeek[], view: ViewSeries[], months: string[], f: Fmt): ReactNode {
  const cx = W / 2;
  const cy = PAD.t + (H - PAD.t - PAD.b) / 2;
  const R = Math.min(126, (H - PAD.t - PAD.b) / 2 - 20);
  const totals = view.map((s) => monthlyTotals(weeks, s.counts, months));
  const top = niceMax(Math.max(0, ...totals.flat()));
  const ang = (i: number) => -Math.PI / 2 + (i * Math.PI * 2) / Math.max(1, months.length);
  const pt = (i: number, v: number): [number, number] => [
    cx + Math.cos(ang(i)) * R * (v / top),
    cy + Math.sin(ang(i)) * R * (v / top),
  ];
  return (
    <g>
      {[1, 2, 3, 4].map((k) => (
        <g key={k}>
          <polygon
            className="trend-grid"
            fill="none"
            points={months.map((_, i) => pt(i, (top * k) / 4).join(",")).join(" ")}
          />
          <text className="trend-axis" x={cx + 6} y={cy - (R * k) / 4 + 12}>
            {f((top * k) / 4)}
          </text>
        </g>
      ))}
      {months.map((m, i) => {
        const [ex, ey] = pt(i, top);
        const [lx, ly] = [
          cx + Math.cos(ang(i)) * (R + 18),
          cy + Math.sin(ang(i)) * (R + 18),
        ];
        const anchor = Math.cos(ang(i)) > 0.1 ? "start" : Math.cos(ang(i)) < -0.1 ? "end" : "middle";
        return (
          <g key={m}>
            <line className="trend-grid" x1={cx} y1={cy} x2={ex} y2={ey} />
            <text className="trend-axis" x={lx} y={ly + 4} textAnchor={anchor}>
              {monthLabel(m)}
            </text>
          </g>
        );
      })}
      {view.map((s, si) => {
        const color = COLORS[s.key] ?? "var(--muted)";
        const vals = totals[si];
        return (
          <g key={s.key}>
            <polygon
              points={vals.map((v, i) => pt(i, v).join(",")).join(" ")}
              style={{ fill: color, fillOpacity: 0.14, stroke: color }}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {vals.map((v, i) => {
              const [px, py] = pt(i, v);
              return (
                <circle key={i} cx={px} cy={py} r={3} style={{ fill: color }}>
                  <title>{`${s.label} — ${monthLabel(months[i])}: ${f(v)}`}</title>
                </circle>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

function renderHeatmap(weeks: TrendWeek[], view: ViewSeries[], f: Fmt): ReactNode {
  const left = 92;
  const gridW = W - left - PAD.r;
  const cellW = gridW / weeks.length;
  const innerH = H - PAD.t - PAD.b;
  const rowH = Math.min(46, innerH / view.length);
  const oy = PAD.t + (innerH - rowH * view.length) / 2;
  const max = Math.max(1, ...view.flatMap((s) => s.counts));
  const labelStep = Math.max(1, Math.ceil(weeks.length / 8));
  return (
    <g>
      {view.map((s, r) => (
        <g key={s.key}>
          <text className="trend-axis" x={left - 8} y={oy + r * rowH + rowH / 2 + 4} textAnchor="end">
            {s.label}
          </text>
          {s.counts.map((v, i) => (
            <rect
              key={i}
              x={left + i * cellW + 1}
              y={oy + r * rowH + 1}
              width={Math.max(1, cellW - 2)}
              height={Math.max(1, rowH - 2)}
              style={{
                fill: COLORS[s.key] ?? "var(--muted)",
                fillOpacity: v === 0 ? 0.05 : 0.2 + 0.8 * (v / max),
              }}
            >
              <title>{`${s.label} — ${dayLabel(weeks[i].date)}: ${f(v)}`}</title>
            </rect>
          ))}
        </g>
      ))}
      {weeks.map((w, i) =>
        i % labelStep === 0 || i === weeks.length - 1 ? (
          <text
            key={w.id}
            className="trend-axis"
            x={left + i * cellW + cellW / 2}
            y={H - 10}
            textAnchor="middle"
          >
            {dayLabel(w.date)}
          </text>
        ) : null,
      )}
    </g>
  );
}

function renderBubble(g: Geom, weeks: TrendWeek[], view: ViewSeries[], max: number, f: Fmt): ReactNode {
  return (
    <g>
      {view.map((s) => {
        const color = COLORS[s.key] ?? "var(--muted)";
        const yf = s.secondary && g.y2 ? g.y2 : g.y;
        const sf = s.secondary ? rupees : f;
        const mx = s.secondary ? g.max2 : max;
        return (
          <g key={s.key}>
            {s.counts.map((v, i) =>
              v > 0 ? (
                <circle
                  key={i}
                  cx={g.x(i)}
                  cy={yf(v)}
                  r={4 + 12 * Math.sqrt(v / mx)}
                  style={{ fill: color, fillOpacity: 0.7 }}
                >
                  <title>{`${s.label} — ${dayLabel(weeks[i].date)}: ${sf(v)}`}</title>
                </circle>
              ) : null,
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Home dashboard trends: label tabs (All combined + one per series) and a
    chart-type picker (line/bar/area/pie/bubble/radar/heat map) above the
    graph. Every view derives from the same `{ weeks, series }` props —
    switching tabs or chart types never re-fetches. "All" plots the series'
    slip counts; a series with `amounts` (TYFCB) plots rupee totals on its
    own tab (₹ axis); pie splits by series on All and
    by month on a single series; radar buckets counts per month; the heat
    map is a weeks × series intensity grid. One chart instance serves the
    slip trends (default tab label "All slips") and the attendance chart
    (`allLabel = "All letters"`). */
export default function TrendChart({ weeks, series, allLabel = "All slips" }: SlipTrends & { allLabel?: string }) {
  const [type, setType] = useState("all");
  const [chart, setChart] = useState<ChartKey>("bar");

  if (weeks.length === 0) {
    return (
      <div className="empty-state">
        <p>No meetings in the last 6 months.</p>
        <div className="hero-actions" style={{ justifyContent: "center" }}>
          <Link href="/import">
            <button type="button" className="primary">
              Import Report XLS
            </button>
          </Link>
        </div>
      </div>
    );
  }

  const picked = type === "all" ? null : series.find((s) => s.key === type) ?? null;
  const money = !!picked?.amounts;
  // A single-series tab with rupee amounts plots those instead of the row count.
  const active = picked && picked.amounts ? { ...picked, counts: picked.amounts } : picked;
  const f: Fmt = money ? rupees : plain;
  // All view, cartesian charts: TYFCB is plotted as ₹ amounts on a right-hand axis
  // (counts and rupees never share one axis); pie / radar / heat map keep counts.
  const dual = !active && (chart === "line" || chart === "area" || chart === "bar" || chart === "bubble") && series.some((s) => s.amounts);
  const view: ViewSeries[] = active
    ? [active]
    : dual
      ? series.map((s) => (s.amounts ? { ...s, counts: s.amounts, secondary: true } : s))
      : series;
  const months = [...new Set(weeks.map((w) => monthKey(w.date)))];
  const slices: Slice[] = active
    ? monthlyTotals(weeks, active.counts, months).map((v, i) => ({
        label: monthLabel(months[i]),
        value: v,
        color: COLORS[active.key] ?? "var(--muted)",
        opacity: months.length > 1 ? 0.45 + (0.55 * i) / (months.length - 1) : 1,
      }))
    : series.map((s) => ({
        label: s.label,
        value: s.counts.reduce((a, b) => a + b, 0),
        color: COLORS[s.key] ?? "var(--muted)",
        opacity: 1,
      }));

  const n = weeks.length;
  const padR = dual ? 66 : PAD.r;
  const innerW = W - PAD.l - padR;
  const innerH = H - PAD.t - PAD.b;
  const x = (i: number) => (n === 1 ? PAD.l + innerW / 2 : PAD.l + (i * innerW) / (n - 1));
  const max = Math.max(1, ...view.filter((s) => !s.secondary).flatMap((s) => s.counts));
  const max2 = Math.max(1, ...view.filter((s) => s.secondary).flatMap((s) => s.counts));
  const top = niceMax(max);
  const top2 = niceMax(max2);
  const y = (v: number) => PAD.t + innerH * (1 - v / top);
  const ticks = [0, 1, 2, 3, 4].map((i) => (top * i) / 4);
  const labelStep = Math.max(1, Math.ceil(n / 8));
  const geom: Geom = {
    n, innerW, innerH, top, x, y, ticks, labelStep,
    r: padR,
    max2,
    ...(dual
      ? { y2: (v: number) => PAD.t + innerH * (1 - v / top2), ticks2: [0, 1, 2, 3, 4].map((i) => (top2 * i) / 4) }
      : {}),
  };

  const chartLabel = CHARTS.find((c) => c.key === chart)?.label ?? "Line";
  const viewLabel = active ? active.label : "all slips";

  let body: ReactNode;
  switch (chart) {
    case "bar":
      body = renderBar(geom, weeks, view, f);
      break;
    case "pie":
      body = renderPie(slices, f);
      break;
    case "radar":
      body = renderRadar(weeks, view, months, f);
      break;
    case "heatmap":
      body = renderHeatmap(weeks, view, f);
      break;
    case "bubble":
      body = (
        <g>
          {cartesianAxes(geom, weeks, f)}
          {renderBubble(geom, weeks, view, max, f)}
        </g>
      );
      break;
    case "area":
      body = (
        <g>
          {cartesianAxes(geom, weeks, f)}
          {renderLine(geom, weeks, view, true, f)}
        </g>
      );
      break;
    default:
      body = (
        <g>
          {cartesianAxes(geom, weeks, f)}
          {renderLine(geom, weeks, view, false, f)}
        </g>
      );
  }

  const tabs = [{ key: "all", label: allLabel }, ...series.map((s) => ({ key: s.key, label: s.label }))];

  return (
    <div className="trend-wrap">
      <div className="trend-controls">
        <div className="tabs trend-type-tabs" role="tablist" aria-label="Slip type">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={type === t.key}
              aria-controls="trend-graph"
              className={type === t.key ? "active" : ""}
              data-stat={t.key === "all" ? undefined : t.key}
              onClick={() => setType(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="tabs trend-chart-tabs" role="group" aria-label="Chart type">
          {CHARTS.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={chart === c.key}
              aria-controls="trend-graph"
              className={chart === c.key ? "active" : ""}
              onClick={() => setChart(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="trend-legend">
        {view.map((s) => {
          const total = s.counts.reduce((a, b) => a + b, 0);
          return (
            <span key={s.key} className="trend-legend-item">
              <span className="trend-dot" style={{ background: COLORS[s.key] ?? "var(--muted)" }} />
              {s.label}
              <span className="trend-total">{money || s.secondary ? rupees(total) : total.toLocaleString("en-IN")}</span>
            </span>
          );
        })}
      </div>
      {dual ? <p className="muted trend-axis-note">TYFCB is plotted in ₹ on the right axis; other slips are counts on the left.</p> : null}
      <div className="trend-svg-scroll" id="trend-graph">
        <svg
          className="trend-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Slip trends — ${chartLabel} chart, ${viewLabel}, last 6 months (weekly, Wednesdays)`}
        >
          {body}
        </svg>
      </div>
      {chart === "pie" ? (
        <div className="trend-legend">
          {slices.map((s) => {
            const total = slices.reduce((a, b) => a + b.value, 0);
            const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
            return (
              <span key={s.label} className="trend-legend-item">
                <span className="trend-dot" style={{ background: s.color, opacity: s.opacity }} />
                {s.label}
                <span className="trend-total">
                  {money ? rupees(s.value) : s.value.toLocaleString("en-IN")} · {pct}%
                </span>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
