"use client";

import Link from "next/link";
import type { SlipTrends } from "@/lib/trends";

/** Same section colours as the app's `data-stat` palette. */
const COLORS: Record<string, string> = {
  "one-to-one": "#d35400",
  referral: "#2e8b57",
  tyfcb: "#b8860b",
  visitor: "#2f6fb0",
  ceu: "#6a4fc7",
};

const W = 960;
const H = 340;
const PAD = { l: 44, r: 14, t: 16, b: 32 };

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

export default function TrendChart({ weeks, series }: SlipTrends) {
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

  const n = weeks.length;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (i: number) => (n === 1 ? PAD.l + innerW / 2 : PAD.l + (i * innerW) / (n - 1));
  const max = Math.max(0, ...series.flatMap((s) => s.counts));
  const top = niceMax(max);
  const y = (v: number) => PAD.t + innerH * (1 - v / top);
  const ticks = [0, 1, 2, 3, 4].map((i) => (top * i) / 4);
  const labelStep = Math.max(1, Math.ceil(n / 8));

  return (
    <div className="trend-wrap">
      <div className="trend-legend">
        {series.map((s) => {
          const total = s.counts.reduce((a, b) => a + b, 0);
          return (
            <span key={s.key} className="trend-legend-item">
              <span className="trend-dot" style={{ background: COLORS[s.key] ?? "#555" }} />
              {s.label}
              <span className="trend-total">{total.toLocaleString("en-IN")}</span>
            </span>
          );
        })}
      </div>
      <div className="trend-svg-scroll">
        <svg
          className="trend-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Slip trends for the last 6 months (weekly, Wednesdays)`}
        >
        {ticks.map((t) => (
          <g key={t}>
            <line className="trend-grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="trend-axis" x={PAD.l - 8} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {weeks.map((w, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text key={w.id} className="trend-axis" x={x(i)} y={H - 10} textAnchor="middle">
              {dayLabel(w.date)}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const color = COLORS[s.key] ?? "#555";
          return (
            <g key={s.key}>
              <polyline
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                points={s.counts.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              />
              {s.counts.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={color}>
                  <title>{`${s.label} — ${dayLabel(weeks[i].date)}: ${v}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        </svg>
      </div>
    </div>
  );
}
