import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const sections = [
  { href: "/members", label: "Bni Member", table: "members" },
  { href: "/referrals", label: "Slip Referrals", table: "slip_referrals" },
  { href: "/one-to-ones", label: "Slip 121", table: "slip_one_to_ones" },
  { href: "/visitors", label: "Slip Visitors", table: "slip_visitors" },
  { href: "/tyfcb", label: "Slip TYFCB", table: "slip_tyfcb" },
];

async function getCounts(): Promise<Record<string, number | null>> {
  try {
    const sb = getSupabaseServer();
    const entries = await Promise.all(
      sections.map(async (s) => {
        const { count } = await sb.from(s.table).select("*", { count: "exact", head: true });
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
            <Link key={s.href} href={s.href} className="section-card">
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
          as same-chapter members; Detail is stored as Other Chapter Member text.
        </p>
      </div>
    </div>
  );
}
