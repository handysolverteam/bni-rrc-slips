"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import SearchSelect from "@/components/SearchSelect";

/** Multi-select month filter for the Top 3 screen. The selection is a comma
    list of `YYYY-MM` keys in `?month=`; empty = the default last 6 months. */
export default function MonthFilter({
  basePath,
  value,
  months,
}: {
  basePath: string;
  value: string;
  months: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <div className="filter-form">
      <div className="filter-field">
        <span className="filter-label">Months</span>
        <SearchSelect
          value={value}
          options={months.map((m) => ({ value: m.key, label: m.label }))}
          placeholder="Last 6 months"
          allLabel="Last 6 months"
          multiple
          showClear={!!value}
          onChange={(v) => {
            const url = v && v !== "all" ? `${basePath}?month=${encodeURIComponent(v)}` : basePath;
            startTransition(() => router.push(url));
          }}
        />
      </div>
      {isPending ? (
        <span className="toolbar-loading" role="status">
          <span className="spinner small" /> Loading…
        </span>
      ) : null}
    </div>
  );
}
