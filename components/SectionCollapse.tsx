"use client";

import { useState } from "react";

/** Collapsible report section: big tables start collapsed to save scroll. */
export default function SectionCollapse({
  title,
  badge,
  rowCount,
  children,
}: {
  title: string;
  badge: React.ReactNode;
  rowCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(rowCount <= 100);
  return (
    <section className="report-section">
      <div className="section-head">
        <h2>
          {title} {badge}
        </h2>
        <button
          type="button"
          className="import-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "− Collapse" : `+ Expand (${rowCount})`}
        </button>
      </div>
      {open ? children : null}
    </section>
  );
}
