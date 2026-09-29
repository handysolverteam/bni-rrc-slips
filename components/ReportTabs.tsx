"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Report tabs navigate in a transition: tables stay, a pill indicates loading. */
export default function ReportTabs({
  weekId,
  activeTab,
}: {
  weekId: string;
  activeTab: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tabs = [
    { key: "all", label: "All" },
    { key: "one-to-one", label: "One-to-One" },
    { key: "referral", label: "Referrals" },
    { key: "tyfcb", label: "TYFCB" },
    { key: "visitor", label: "Visitors" },
  ];

  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          className={activeTab === t.key ? "active" : undefined}
          disabled={isPending}
          onClick={() =>
            startTransition(() =>
              router.push(`/report?week=${encodeURIComponent(weekId)}&tab=${t.key}`),
            )
          }
        >
          {t.label}
        </button>
      ))}
      {isPending ? (
        <span className="toolbar-loading" role="status">
          <span className="spinner small" /> Loading…
        </span>
      ) : null}
    </div>
  );
}
