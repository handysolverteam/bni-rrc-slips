"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import SlipsTable from "@/components/SlipsTable";
import FilterBar from "@/components/FilterBar";
import type { ComboOption } from "@/components/SearchSelect";
import type { WeekOption } from "@/lib/weeks";

type Col = { key: string; label: string };

type ActiveToggle = { param: string; label: string; checked: boolean };

export default function ListShell({
  title,
  total,
  page,
  pageSize,
  basePath,
  q,
  weekId,
  weeks,
  columns,
  rows,
  kind,
  filterable = [],
  columnFilters = {},
  filterOptions = {},
  hideWeekBar = false,
  sub,
  activeToggle,
}: {
  title: string;
  total: number;
  page: number;
  pageSize: number;
  basePath: string;
  q: string;
  weekId: string;
  weeks: WeekOption[];
  columns: Col[];
  rows: Record<string, unknown>[];
  /** Slip type for section coloring (one-to-one / referral / tyfcb / visitor). */
  kind?: string;
  filterable?: string[];
  columnFilters?: Record<string, string>;
  filterOptions?: Record<string, ComboOption[]>;
  /** Week lives in the header cell filter instead of the top bar. */
  hideWeekBar?: boolean;
  /** Extra line under the title (e.g. the active/inactive counts). */
  sub?: string;
  /** Optional boolean URL filter rendered as a checkbox in the toolbar. */
  activeToggle?: ActiveToggle;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const activeWeek = weeks.find((w) => w.id === weekId);
  const weekCount = weekId.split(",").map((s) => s.trim()).filter(Boolean).length;
  const go = (url: string) => startTransition(() => router.push(url));
  // Keep every active filter (q, week, c_* columns) across pagination.
  const pageQuery = (p: number) => {
    const params = new URLSearchParams(search.toString());
    params.set("page", String(p));
    return `${basePath}?${params.toString()}`;
  };
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Compact page list: 1 … c-1 c c+1 … N
  const pageItems: (number | "…")[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 2) {
      pageItems.push(p);
    } else if (pageItems[pageItems.length - 1] !== "…") {
      pageItems.push("…");
    }
  }

  return (
    <div data-stat={kind}>
      <div className="page-head">
        <h1>
          {title}
          <span className="count-badge">
            {rows.length} of {total.toLocaleString("en-IN")}
          </span>
        </h1>
        {sub ? <p className="sub muted">{sub}</p> : null}
        {activeWeek ? (
          <p className="sub muted">
            Filtered to {activeWeek.label}
          </p>
        ) : weekCount > 1 ? (
          <p className="sub muted">Filtered to {weekCount} weeks</p>
        ) : null}
      </div>

      <div className="toolbar">
        {activeToggle ? (
          <label className="check-inline">
            <input
              type="checkbox"
              checked={activeToggle.checked}
              onChange={(e) => {
                const params = new URLSearchParams(search.toString());
                if (e.target.checked) params.set(activeToggle.param, "1");
                else params.delete(activeToggle.param);
                params.delete("page");
                go(`${basePath}?${params.toString()}`);
              }}
            />
            {activeToggle.label}
          </label>
        ) : null}
        <FilterBar
          basePath={basePath}
          q={q}
          weekId={weekId}
          weeks={hideWeekBar ? [] : weeks}
          hideSearch
          onNavigate={go}
        />
        {q || weekId || activeToggle?.checked || Object.keys(columnFilters).length > 0 ? (
          <Link href={basePath}>
            <button type="button">Clear all</button>
          </Link>
        ) : null}
      </div>

      <div className="table-overlay-wrap">
        <SlipsTable
          columns={columns}
          rows={rows}
          filterable={filterable}
          initialFilters={columnFilters}
          filterOptions={filterOptions}
          loading={isPending}
        />
      </div>

      <div className="pager">
        <button type="button" disabled={page <= 1 || isPending} onClick={() => go(pageQuery(Math.max(1, page - 1)))}>
          ← Prev
        </button>
        {pageItems.map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="page-gap">…</span>
          ) : (
            <button
              key={p}
              type="button"
              className={p === page ? "page-num active" : "page-num"}
              disabled={p === page || isPending}
              onClick={() => go(pageQuery(p))}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" disabled={page >= totalPages || isPending} onClick={() => go(pageQuery(page + 1))}>
          Next →
        </button>
      </div>
    </div>
  );
}
