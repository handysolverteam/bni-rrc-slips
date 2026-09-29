"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import SlipsTable from "@/components/SlipsTable";
import FilterBar from "@/components/FilterBar";
import type { WeekOption } from "@/lib/weeks";

type Col = { key: string; label: string };

export default function ListShell({
  title,
  total,
  page,
  pageSize,
  basePath,
  q,
  weekId,
  weeks,
  searchPlaceholder,
  columns,
  rows,
  filterable = [],
  columnFilters = {},
  filterOptions = {},
}: {
  title: string;
  total: number;
  page: number;
  pageSize: number;
  basePath: string;
  q: string;
  weekId: string;
  weeks: WeekOption[];
  searchPlaceholder: string;
  columns: Col[];
  rows: Record<string, unknown>[];
  filterable?: string[];
  columnFilters?: Record<string, string>;
  filterOptions?: Record<string, string[]>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const pageQuery = (p: number) =>
    `${basePath}?q=${encodeURIComponent(q)}&week=${encodeURIComponent(weekId)}&page=${p}`;
  const activeWeek = weeks.find((w) => w.id === weekId);
  const go = (url: string) => startTransition(() => router.push(url));
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
    <div>
      <div className="page-head">
        <h1>
          {title}
          <span className="count-badge">
            {rows.length} of {total.toLocaleString("en-IN")}
          </span>
        </h1>
        {activeWeek ? (
          <p className="sub muted">
            Filtered to {activeWeek.label}
          </p>
        ) : null}
      </div>

      <div className="toolbar">
        <FilterBar
          basePath={basePath}
          q={q}
          weekId={weekId}
          weeks={weeks}
          searchPlaceholder={searchPlaceholder}
          onNavigate={go}
        />
        {q || weekId || Object.keys(columnFilters).length > 0 ? (
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
        />
        {isPending ? (
          <div className="table-loading-overlay" role="status" aria-label="Loading">
            <div className="table-loading-card">
              <div className="skel skel-row" />
              <div className="skel skel-row" />
              <div className="skel skel-row" />
              <div className="skel skel-row short" />
            </div>
          </div>
        ) : null}
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
