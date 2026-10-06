import Link from "next/link";
import ColumnFilter from "@/components/ColumnFilter";
import ImportPanel from "@/components/ImportPanel";
import ReportExportButtons from "@/components/ReportExportButtons";
import ReportTabs from "@/components/ReportTabs";
import SectionCollapse from "@/components/SectionCollapse";
import { detailLabelFor, fromToLabelsFor, type ReportSectionKey } from "@/lib/report-view";

/**
 * Geometry-accurate loading skeletons: every block mirrors the height/width
 * of the real element it stands in for (title bar, week combo, table header,
 * body rows, pager) so the layout does not jump when data arrives.
 */

export function Bar({
  w = "100%",
  h,
  r = 5,
}: {
  w?: number | string;
  h: number;
  r?: number;
}) {
  return (
    <span
      className="skel"
      style={{ display: "block", width: w, height: h, borderRadius: r }}
    />
  );
}

type SkelCol = { key: string; label: string };

/** Same compact page-list rule as ListShell. */
function pageItems(page: number, totalPages: number): (number | "…")[] {
  const items: (number | "…")[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 2) items.push(p);
    else if (items[items.length - 1] !== "…") items.push("…");
  }
  return items;
}

const CELL_W = [92, 78, 86, 70, 82];

export function ListSkeleton({
  title,
  kind,
  columns,
  filterable,
  week,
  rows,
  totalPages,
  badgeW = 57,
}: {
  title: string;
  kind?: string;
  columns: SkelCol[];
  filterable: string[];
  week: boolean;
  rows: number;
  totalPages: number;
  badgeW?: number;
}) {
  const cellH = columns.some((c) => c.key === "inside_outside") ? 24 : 18;
  return (
    <div data-stat={kind}>
      <div className="page-head">
        <h1>
          {title}
          <span className="count-badge" style={{ height: 24 }}>
            <Bar w={badgeW} h={16} r={4} />
          </span>
        </h1>
        {week ? (
          <p className="sub muted">
            <Bar w={240} h={18} r={4} />
          </p>
        ) : null}
      </div>

      <div className="toolbar">
        <form className="filter-form">
          {week ? (
            <span className="combo">
              <span className="combo-field" style={{ height: 39 }}>
                <Bar w={210} h={16} r={4} />
              </span>
            </span>
          ) : null}
        </form>
        {week ? <button type="button">Clear all</button> : null}
      </div>

      <div className="table-overlay-wrap">
        <div className="table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  {columns.map((c) =>
                    filterable.includes(c.key) ? (
                      <th key={c.key}>
                        <ColumnFilter
                          paramKey={`sk_${c.key}`}
                          defaultValue=""
                          options={[]}
                          label={c.label}
                        />
                      </th>
                    ) : (
                      <th key={c.key}>
                        <span className="th-label">{c.label}</span>
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }, (_, i) => (
                  <tr key={i}>
                    {columns.map((c, j) => (
                      <td key={c.key}>
                        <Bar
                          h={cellH}
                          w={`${CELL_W[(i + j) % CELL_W.length]}%`}
                          r={4}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="pager">
        <button type="button" disabled>
          ← Prev
        </button>
        {pageItems(1, totalPages).map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="page-gap">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              disabled
              className={p === 1 ? "page-num active" : "page-num"}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" disabled>
          Next →
        </button>
      </div>
    </div>
  );
}

const HOME_SECTIONS = [
  { href: "/members", label: "Bni Member", kind: "members", numW: 48 },
  { href: "/referrals", label: "Slip Referrals", kind: "referral", numW: 58 },
  { href: "/one-to-ones", label: "Slip 121", kind: "one-to-one", numW: 58 },
  { href: "/visitors", label: "Slip Visitors", kind: "visitor", numW: 40 },
  { href: "/tyfcb", label: "Slip TYFCB", kind: "tyfcb", numW: 58 },
  { href: "/ceus", label: "Slip CEU", kind: "ceu", numW: 48 },
];

export function HomeSkeleton() {
  return (
    <div>
      <div className="card hero">
        <h1>BNI Week Slips</h1>
        <p className="muted">
          Import the weekly Report XLS (From, To, Slip Type, Inside/Outside, TYFCB,
          CEU Credits, Detail) — pick a BNI Week on import, then browse everything
          below.
        </p>
        <div className="hero-actions">
          <Link href="/import">
            <button type="button" className="primary">
              Import Report XLS
            </button>
          </Link>
        </div>
      </div>

      <div className="cards">
        {HOME_SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="section-card"
            data-stat={s.kind}
          >
            <div className="num">
              <Bar w={s.numW} h={35} />
            </div>
            <div className="label">{s.label}</div>
            <div className="go">Open →</div>
          </Link>
        ))}
      </div>

      <div className="card note-card">
        <p className="muted" style={{ margin: 0 }}>
          Note: bold formatting in Excel cannot be read by the current parser. All
          names are stored as same-chapter members; Detail is stored as Other
          Member&apos;s Chapter text.
        </p>
      </div>
    </div>
  );
}

const REPORT_SECTIONS = [
  {
    key: "one-to-one",
    title: "One-to-One",
    suffix: "121s",
    rows: 43,
    badgeW: 15,
    statW: 42,
    tyfcb: false,
    sum: false,
  },
  {
    key: "referral",
    title: "Referral",
    suffix: "Referrals",
    rows: 72,
    badgeW: 15,
    statW: 42,
    tyfcb: false,
    sum: false,
  },
  {
    key: "tyfcb",
    title: "TYFCB",
    suffix: "Slips",
    rows: 45,
    badgeW: 15,
    statW: 42,
    tyfcb: true,
    sum: true,
  },
  {
    key: "visitor",
    title: "Visitor",
    suffix: "Visitors",
    rows: 11,
    badgeW: 15,
    statW: 42,
    tyfcb: false,
    sum: false,
  },
  {
    key: "ceu",
    title: "CEU",
    suffix: "CEUs",
    rows: 12,
    badgeW: 15,
    statW: 42,
    tyfcb: false,
    sum: true,
  },
] as const;

function ReportSectionTable({
  sectionKey,
  rows,
  withTyfcb,
  withCeu,
  withSum,
}: {
  sectionKey: ReportSectionKey;
  rows: number;
  withTyfcb: boolean;
  withCeu: boolean;
  withSum: boolean;
}) {
  // CEU rows never carry a Detail value, so the real table drops that column.
  const withDetail = !withCeu;
  // Real "One-to-One" slips wrap onto two lines in the Slip Type column,
  // so those rows render taller (57px vs 39px) — mirror that height.
  const barH = sectionKey === "one-to-one" ? 36 : 18;
  const colCount =
    5 + (withTyfcb ? 1 : 0) + (withCeu ? 1 : 0) + (withDetail ? 1 : 0);
  const fromTo = fromToLabelsFor(sectionKey);
  return (
    <div className="table-card">
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>No.</th>
              <th>
                <ColumnFilter
                  paramKey={`sk_w_${sectionKey}`}
                  defaultValue=""
                  options={[]}
                  label="BNI Week"
                  allLabel="Universal"
                />
              </th>
              <th>
                <ColumnFilter
                  paramKey={`sk_f_${sectionKey}`}
                  defaultValue=""
                  options={[]}
                  label={fromTo.from}
                />
              </th>
              <th>
                <ColumnFilter
                  paramKey={`sk_t_${sectionKey}`}
                  defaultValue=""
                  options={[]}
                  label={fromTo.to}
                />
              </th>
              <th>Slip Type</th>
              {withTyfcb ? (
                <th>
                  <span className="th-label">TYFCB Amount</span>
                </th>
              ) : null}
              {withCeu ? (
                <th>
                  <span className="th-label">CEU Credits</span>
                </th>
              ) : null}
              {withDetail ? (
                <th>
                  <ColumnFilter
                    paramKey={`sk_d_${sectionKey}`}
                    defaultValue=""
                    options={[]}
                    label={detailLabelFor(sectionKey)}
                  />
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, i) => (
              <tr key={i}>
                {Array.from({ length: colCount }, (_, j) => (
                  <td key={j}>
                    <Bar
                      h={barH}
                      w={`${CELL_W[(i + j) % CELL_W.length]}%`}
                      r={4}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {withSum ? (
            <tfoot>
              <tr className="sum-row">
                <td colSpan={5}>
                  <strong>Total</strong>
                </td>
                <td className="num">
                  <strong>
                    <Bar w={74} h={16} r={4} />
                  </strong>
                </td>
                {withDetail ? <td /> : null}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

export function ReportSkeleton() {
  return (
    <div>
      <div className="report-top">
        <div className="page-head">
          <h1>
            Week Report
            <span className="count-badge" style={{ height: 24 }}>
              <Bar w={54} h={16} r={4} />
            </span>
          </h1>
          <p className="sub muted">
            <Bar w={170} h={16} r={4} />
          </p>
        </div>
        <div className="report-head-actions">
          <ImportPanel variant="toolbar" defaultCollapsed />
          <ReportExportButtons weekId="" tab="all" scopeLabel="week" />
        </div>
      </div>

      <div className="cards stat-cards">
        {REPORT_SECTIONS.map((s) => (
          <div key={s.key} className="section-card" data-stat={s.key}>
            <div className="num">
              <Bar w={s.statW} h={46} />
            </div>
            <div className="label">{s.title}</div>
            <div className="go">
              {s.key === "tyfcb" ? (
                <Bar w={104} h={13} r={4} />
              ) : s.key === "ceu" ? (
                <Bar w={74} h={13} r={4} />
              ) : (
                s.suffix
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="card report-controls">
        <div className="report-controls-row">
          <form className="filter-form">
            <span className="combo">
              <span className="combo-field" style={{ height: 39 }}>
                <Bar w={210} h={16} r={4} />
              </span>
            </span>
          </form>
          <span className="clear-right">
            <button type="button">Clear all</button>
          </span>
        </div>
      </div>

      <ReportTabs weekId="" activeTab="all" />

      {REPORT_SECTIONS.map((s) => (
        <SectionCollapse
          key={s.key}
          kind={s.key}
          title={s.title}
          rowCount={s.rows}
          badge={
            <span className="count-badge" style={{ height: 24 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  height: 16,
                }}
              >
                <span
                  className="skel"
                  style={{
                    display: "block",
                    width: s.badgeW,
                    height: 14,
                    borderRadius: 4,
                  }}
                />
                <span>{s.suffix}</span>
              </span>
            </span>
          }
        >
          {s.rows > 100 ? null : (
            <ReportSectionTable
              sectionKey={s.key}
              rows={s.rows}
              withTyfcb={s.tyfcb}
              withCeu={s.key === "ceu"}
              withSum={s.sum}
            />
          )}
        </SectionCollapse>
      ))}
    </div>
  );
}

/** Shared card head: title + (optional) toggle button, mirrored from the real panels. */
function PanelSkeleton({ title, toggle }: { title: string; toggle?: string }) {
  return (
    <>
      <div className="import-head">
        <h2>{title}</h2>
        {toggle ? (
          <button type="button" className="import-toggle" disabled>
            {toggle}
          </button>
        ) : null}
      </div>
      <label className="field">
        <Bar w={430} h={15} r={4} />
        <span className="skel" style={{ display: "block", width: "100%", height: 38, borderRadius: 5, marginTop: 6 }} />
      </label>
    </>
  );
}

const IMPORT_HEAD = ["File", "Imported", "Skipped"];

/** /import — both upload panels + the "Imported weeks" history table. */
export function ImportSkeleton() {
  return (
    <div>
      <div className="card">
        <PanelSkeleton title="Import Report XLS" toggle="+ Import files" />
      </div>

      <div className="card">
        <PanelSkeleton title="Chapter Summary PALMS (attendance)" />
      </div>

      <div className="card history-card">
        <h2>Imported weeks</h2>
        <div className="table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>
                    <span className="combo">
                      <span className="combo-field" style={{ height: 39 }}>
                        <Bar w={130} h={16} r={4} />
                      </span>
                    </span>
                  </th>
                  <th>
                    <span className="th-label">{IMPORT_HEAD[0]}</span>
                  </th>
                  <th>
                    <ColumnFilter paramKey="sk_iw_week" defaultValue="" options={[]} label="Week" allLabel="All weeks" />
                  </th>
                  <th>
                    <span className="th-label">{IMPORT_HEAD[1]}</span>
                  </th>
                  <th>
                    <span className="th-label">{IMPORT_HEAD[2]}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}>
                    <td><Bar h={18} w={`${CELL_W[i % CELL_W.length]}%`} r={4} /></td>
                    <td><Bar h={18} w={`${CELL_W[(i + 1) % CELL_W.length]}%`} r={4} /></td>
                    <td><Bar h={18} w={`${CELL_W[(i + 2) % CELL_W.length]}%`} r={4} /></td>
                    <td><Bar h={18} w={`${CELL_W[(i + 3) % CELL_W.length]}%`} r={4} /></td>
                    <td><Bar h={18} w={`${CELL_W[(i + 4) % CELL_W.length]}%`} r={4} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const SUMMARY_LABELS = ["Member", "P", "A", "L", "M", "S", "RGI", "RGO", "RRI", "RRO", "V", "1-2-1", "TYFCB", "CEU", "T"];

/** /summary — page head, PALMS upload panel, week filter, member-wise table. */
export function SummarySkeleton() {
  return (
    <div>
      <div className="page-head">
        <h1>
          Chapter Summary
          <span className="count-badge" style={{ height: 24 }}>
            <Bar w={96} h={16} r={4} />
          </span>
        </h1>
        <p className="sub muted">
          <Bar w={240} h={18} r={4} />
        </p>
      </div>

      <div className="card">
        <PanelSkeleton title="Chapter Summary PALMS (attendance)" />
      </div>

      <div className="card report-controls">
        <div className="report-controls-row">
          <form className="filter-form">
            <span className="combo">
              <span className="combo-field" style={{ height: 39 }}>
                <Bar w={210} h={16} r={4} />
              </span>
            </span>
          </form>
          <span className="clear-right">
            <button type="button" disabled>
              Clear all
            </button>
          </span>
        </div>
      </div>

      <div className="card">
        <div className="table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  {SUMMARY_LABELS.map((c) => (
                    <th key={c}>
                      <span className="th-label">{c}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 12 }, (_, i) => (
                  <tr key={i}>
                    {SUMMARY_LABELS.map((c, j) => (
                      <td key={c}>
                        <Bar h={18} w={`${CELL_W[(i + j) % CELL_W.length]}%`} r={4} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  {SUMMARY_LABELS.slice(1).map((c, j) => (
                    <td key={c}>
                      <strong>
                        <Bar h={16} w={`${CELL_W[(j + 2) % CELL_W.length]}%`} r={4} />
                      </strong>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
