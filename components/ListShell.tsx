import Link from "next/link";
import SlipsTable from "@/components/SlipsTable";
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
}) {
  const pageQuery = (p: number) =>
    `${basePath}?q=${encodeURIComponent(q)}&week=${encodeURIComponent(weekId)}&page=${p}`;
  const activeWeek = weeks.find((w) => w.id === weekId);

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
        <form className="filter-form" action={basePath} method="get">
          <input name="q" placeholder={searchPlaceholder} defaultValue={q} aria-label="Search" />
          {weeks.length > 0 ? (
            <select name="week" defaultValue={weekId} aria-label="Filter by BNI week">
              <option value="">All weeks</option>
            {weeks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
            </select>
          ) : null}
          <button type="submit">Apply</button>
          {q || weekId ? (
            <Link href={basePath}>
              <button type="button">Clear</button>
            </Link>
          ) : null}
        </form>
      </div>

      <SlipsTable columns={columns} rows={rows} />

      <div className="pager">
        <Link href={pageQuery(Math.max(1, page - 1))}>
          <button type="button" disabled={page <= 1}>
            ← Prev
          </button>
        </Link>
        <span className="page-num">{page}</span>
        <Link href={pageQuery(page + 1)}>
          <button type="button" disabled={page * pageSize >= total}>
            Next →
          </button>
        </Link>
      </div>
    </div>
  );
}
