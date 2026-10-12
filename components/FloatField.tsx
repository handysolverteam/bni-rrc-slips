import type { ReactNode } from "react";

/** Outlined field whose label sits on the top border (Material "outlined" look) — for native selects. */
export default function FloatField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="float-field">
      <span className="float-label">{label}</span>
      {children}
    </span>
  );
}
