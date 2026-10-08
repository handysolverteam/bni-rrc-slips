"use client";

import { useState } from "react";

/** Card body with a − Collapse / + Expand toggle (open by default). The
    children are server-rendered; collapsing only hides them. */
export default function CollapseCard({
  label,
  className = "card",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={className}>
      <div className="collapse-bar">
        <span className="muted">{label}</span>
        <button type="button" className="import-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "− Collapse" : "+ Expand"}
        </button>
      </div>
      {open ? children : null}
    </div>
  );
}
