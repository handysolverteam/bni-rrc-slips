"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { SlipTrends, TrendSeries, TrendWeek } from "@/lib/trends";

/** Same section colours as the app's `data-stat` palette — consumed as CSS
    variables, so every view flips with the dark/light theme live (no
    re-render). The `*-ink` vars are the hues tuned to read on app surfaces:
    identical to the raw hues in light, brightened in dark. The Combined
    series rides on the text colour so it stays readable on either theme. */
const COLORS: Record<string, string> = {
  "one-to-one": "var(--orange-ink)",
  referral: "var(--green-ink)",
  tyfcb: "var(--gold-ink)",
  visitor: "var(--blue-ink)",
  ceu: "var(--purple-ink)",
  combined: "var(--ink)",
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

type Geom = {
  n: number;
  innerW: number;
  innerH: number;
  top: number;
  x: (i: number) => number;
  y: (v: number) => number;
  ticks: number[];
  labelStep: number;
};

/** Round the y-axis maximum up to a 4-step "nice" number (ticks stay integers). */
function niceMax(max: number): number {
  for (const c of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]) {
    if (c * 4 >= max) return c * 4;
  }
  return Math.ceil(max / 4) * 4;
}

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

function cartesianAxes(g: Geom, weeks: TrendWeek[]): ReactNode {
  return (
    <g>
      {g.ticks.map((t) => (
        <g key={t}>
          <line className="trend-grid" x1={PAD.l} x2={W - PAD.r} y1={g.y(t)} y2={g.y(t)} />
          <text className="trend-axis" x={PAD.l - 8} y={g.y(t) + 4} textAnchor="end">
            {t}
          </text>
        </g>
      ))}
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

function renderLine(g: Geom, weeks: TrendWeek[], view: TrendSeries[], fill: boolean): ReactNode {
  return (
    <g>
      {view.map((s) => {
        const color = COLORS[s.key] ?? "var(--muted)";
        const sw = s.key === "combined" ? 3 : 2;
        return (
          <g key={s.key}>
            {fill && g.n > 1 ? (
              <polygon
                points={[
                  ...s.counts.map((v, i) => `${g.x(i)},${g.y(v)}`),
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
              points={s.counts.map((v, i) => `${g.x(i)},${g.y(v)}`).join(" ")}
            />
            {s.counts.map((v, i) => (
              <circle key={i} cx={g.x(i)} cy={g.y(v)} r={3} style={{ fill: color }}>
                <title>{`${s.label} — ${dayLabel(weeks[i].date)}: ${v}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </g>
  );
}

function renderBar(g: Geom, weeks: TrendWeek[], view: TrendSeries[]): ReactNode {
  const slot = g.innerW / g.n;
  const group = slot * 0.72;
  const bw = group / view.length;
  const base = g.y(0);
  return (
    <g>
      {g.ticks.map((t) => (
        <g key={t}>
          <line className="trend-grid" x1={PAD.l} x2={W - PAD.r} y1={g.y(t)} y2={g.y(t)} />
          <text className="trend-axis" x={PAD.l - 8} y={g.y(t) + 4} textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      {view.map((s, si) =>
        s.counts.map((v, i) =>
          v > 0 ? (
            <rect
              key={`${s.key}-${i}`}
              x={PAD.l + i * slot + (slot - group) / 2 + si * bw}
              y={g.y(v)}
              width={Math.max(1, bw - 1)}
              height={Math.max(1, base - g.y(v))}
              style={{ fill: COLORS[s.key] ?? "var(--muted)" }}
            >
              <title>{`${s.label} — ${dayLabel(weeks[i].date)}: ${v}`}</title>
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

function renderPie(slices: Slice[]): ReactNode {
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
              <title>{`${s.label}: ${s.value}`}</title>
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
            <title>{`${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`}</title>
          </path>
        );
      })}
    </g>
  );
}

function renderRadar(weeks: TrendWeek[], view: TrendSeries[], months: string[]): ReactNode {
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
            {(top * k) / 4}
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
                  <title>{`${s.label} — ${monthLabel(months[i])}: ${v}`}</title>
                </circle>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

function renderHeatmap(weeks: TrendWeek[], view: TrendSeries[]): ReactNode {
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
              <title>{`${s.label} — ${dayLabel(weeks[i].date)}: ${v}`}</title>
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

function renderBubble(g: Geom, weeks: TrendWeek[], view: TrendSeries[], max: number): ReactNode {
  return (
    <g>
      {view.map((s) => {
        const color = COLORS[s.key] ?? "var(--muted)";
        return (
          <g key={s.key}>
            {s.counts.map((v, i) =>
              v > 0 ? (
                <circle
                  key={i}
                  cx={g.x(i)}
                  cy={g.y(v)}
                  r={4 + 12 * Math.sqrt(v / max)}
                  style={{ fill: color, fillOpacity: 0.7 }}
                >
                  <title>{`${s.label} — ${dayLabel(weeks[i].date)}: ${v}`}</title>
                </circle>
              ) : null,
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Home dashboard trends: slip-type tabs (All slips combined + one per type)
    and a chart-type picker (line/bar/area/pie/bubble/radar/heat map) above
    the graph. Every view derives from the same `{ weeks, series }` props —
    switching tabs or chart types never re-fetches. "All slips" adds a
    Combined series (element-wise sum, drawn last); pie splits by slip type on
    All and by month on a single type; radar buckets counts per month; the
    heat map is a weeks × series intensity grid. */
export default function TrendChart({ weeks, series }: SlipTrends) {
  const [type, setType] = useState("all");
  const [chart, setChart] = useState<ChartKey>("line");

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

  const combined: TrendSeries = {
    key: "combined",
    label: "Combined",
    counts: weeks.map((_, i) => series.reduce((a, s) => a + (s.counts[i] ?? 0), 0)),
  };
  const active = type === "all" ? null : series.find((s) => s.key === type) ?? null;
  const view: TrendSeries[] = active ? [active] : [...series, combined];
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
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (i: number) => (n === 1 ? PAD.l + innerW / 2 : PAD.l + (i * innerW) / (n - 1));
  const max = Math.max(1, ...view.flatMap((s) => s.counts));
  const top = niceMax(max);
  const y = (v: number) => PAD.t + innerH * (1 - v / top);
  const ticks = [0, 1, 2, 3, 4].map((i) => (top * i) / 4);
  const labelStep = Math.max(1, Math.ceil(n / 8));
  const geom: Geom = { n, innerW, innerH, top, x, y, ticks, labelStep };

  const chartLabel = CHARTS.find((c) => c.key === chart)?.label ?? "Line";
  const viewLabel = active ? active.label : "all slips combined";

  let body: ReactNode;
  switch (chart) {
    case "bar":
      body = renderBar(geom, weeks, view);
      break;
    case "pie":
      body = renderPie(slices);
      break;
    case "radar":
      body = renderRadar(weeks, view, months);
      break;
    case "heatmap":
      body = renderHeatmap(weeks, view);
      break;
    case "bubble":
      body = (
        <g>
          {cartesianAxes(geom, weeks)}
          {renderBubble(geom, weeks, view, max)}
        </g>
      );
      break;
    case "area":
      body = (
        <g>
          {cartesianAxes(geom, weeks)}
          {renderLine(geom, weeks, view, true)}
        </g>
      );
      break;
    default:
      body = (
        <g>
          {cartesianAxes(geom, weeks)}
          {renderLine(geom, weeks, view, false)}
        </g>
      );
  }

  const tabs = [{ key: "all", label: "All slips" }, ...series.map((s) => ({ key: s.key, label: s.label }))];

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
              <span className="trend-total">{total.toLocaleString("en-IN")}</span>
            </span>
          );
        })}
      </div>
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
                  {s.value.toLocaleString("en-IN")} · {pct}%
                </span>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
