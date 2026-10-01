import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paged";

export const dynamic = "force-dynamic";

const sections = [
  { href: "/members", label: "Bni Member", table: "members", kind: "members" },
  { href: "/referrals", label: "Slip Referrals", table: "slip_referrals", kind: "referral" },
  { href: "/one-to-ones", label: "Slip 121", table: "slip_one_to_ones", kind: "one-to-one" },
  { href: "/visitors", label: "Slip Visitors", table: "slip_visitors", kind: "visitor" },
  { href: "/tyfcb", label: "Slip TYFCB", table: "slip_tyfcb", kind: "tyfcb" },
  { href: "/ceus", label: "Slip CEU", table: "slip_ceus", kind: "ceu" },
];

async function getCounts(): Promise<Record<string, number | null>> {
  try {
    const sb = getSupabaseServer();
    const entries = await Promise.all(
      sections.map(async (s) => {
        // One-to-One card shows the owner count: a bold (other-chapter)
        // side counts 1, a meeting between two home members counts 2.
        if (s.table === "slip_one_to_ones") {
          const rows = await fetchAllRows<{ initiated_by_is_other_chapter: boolean | null; met_with_is_other_chapter: boolean | null }>(
            "slip_one_to_ones",
            "initiated_by_is_other_chapter,met_with_is_other_chapter",
            { pageSize: 1000 },
          );
          const weighted = rows.reduce(
            (n, r) => n + (r.initiated_by_is_other_chapter === true || r.met_with_is_other_chapter === true ? 1 : 2),
            0,
          );
          return [s.table, weighted] as const;
        }
        const { count } = await sb.from(s.table).select("id", { count: "exact" }).limit(1); // NOTE: head:true silently returns count=null in this client version
        return [s.table, count] as const;
      })
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export default async function Home() {
  const counts = await getCounts();

  return (
    <div>
      <div className="card hero">
        <h1>BNI Week Slips</h1>
        <p className="muted">
          Import the weekly Report XLS (From, To, Slip Type, Inside/Outside, TYFCB, CEU Credits,
          Detail) — pick a BNI Week on import, then browse everything below.
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
        {sections.map((s) => {
          const count = counts[s.table];
          return (
            <Link key={s.href} href={s.href} className="section-card" data-stat={s.kind}>
              <div className="num">{count == null ? "–" : count.toLocaleString("en-IN")}</div>
              <div className="label">{s.label}</div>
              <div className="go">Open →</div>
            </Link>
          );
        })}
      </div>

      <div className="card note-card">
        <p className="muted" style={{ margin: 0 }}>
          Note: bold formatting in Excel cannot be read by the current parser. All names are stored
          as same-chapter members; Detail is stored as Other Member's Chapter text.
        </p>
      </div>
    </div>
  );
}
