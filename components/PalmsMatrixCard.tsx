"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/** The attendance matrix card, collapsed by default. Expanding sets `?matrix=1`, which is what makes the server read the
    matrix at all; collapsing removes it (and the Member filter) again. */
export default function PalmsMatrixCard({
  label,
  open,
  children,
}: {
  label: string;
  open: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const toggle = () => {
    const next = new URLSearchParams(params.toString());
    if (open) {
      next.delete("matrix");
      next.delete("c_member");
    } else next.set("matrix", "1");
    const qs = next.toString();
    start(() => router.replace(qs ? `/palms?${qs}` : "/palms", { scroll: false }));
  };
  return (
    <div className="card">
      <div className="collapse-bar">
        <span className="muted">{label}</span>
        <button type="button" className="import-toggle" aria-expanded={open} disabled={pending} onClick={toggle}>
          {pending ? "Loading…" : open ? "− Collapse" : "+ Expand"}
        </button>
      </div>
      {open ? children : null}
    </div>
  );
}
