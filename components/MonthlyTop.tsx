"use client";

import type { MonthTop, TopEntry } from "@/lib/monthly-top-share";
import { allShareUrl, monthShareUrl } from "@/lib/monthly-top-share";

const MEDALS = ["🥇", "🥈", "🥉"];

function List({ title, stat, list, fmt }: { title: string; stat: string; list: TopEntry[]; fmt: (v: number) => string }) {
  return (
    <div className="top3-col" data-stat={stat}>
      <h3>{title}</h3>
      {list.length === 0 ? (
        <p className="muted">No data</p>
      ) : (
        <ol>
          {list.map((e, i) => (
            <li key={e.name}>
              <span className="top3-medal" aria-hidden="true">
                {MEDALS[i]}
              </span>
              <span className="top3-name">{e.name}</span>
              <strong>{fmt(e.value)}</strong>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const rupees = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const openWa = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

/** Month-wise top 3 (TYFCB / Referrals / Visitors) with one-click WhatsApp
    share per month and for all months. Opens wa.me with the text prefilled —
    the member picks the recipient and presses send. */
export default function MonthlyTop({ months }: { months: MonthTop[] }) {
  if (months.length === 0) return null;
  return (
    <div className="card top3-card">
      <div className="import-head">
        <h2>
          Monthly top 3 <span className="muted">— TYFCB · Referrals · Visitors</span>
        </h2>
        <div className="top3-head-actions">
          {months.length > 1 ? (
            <button type="button" className="wa-btn" onClick={() => openWa(allShareUrl(months))}>
              Share all on WhatsApp
            </button>
          ) : null}
        </div>
      </div>
      {months.map((m) => (
        <section key={m.key} className="top3-month" aria-label={m.label}>
          <div className="top3-month-head">
            <h3>{m.label}</h3>
            <button type="button" className="wa-btn" onClick={() => openWa(monthShareUrl(m))}>
              Send on WhatsApp
            </button>
          </div>
          <div className="top3-grid">
            <List title="TYFCB (amount)" stat="tyfcb" list={m.tyfcb} fmt={rupees} />
            <List title="Referrals given" stat="referral" list={m.referral} fmt={String} />
            <List title="Visitors brought" stat="visitor" list={m.visitor} fmt={String} />
          </div>
        </section>
      ))}
    </div>
  );
}
