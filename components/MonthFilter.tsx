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
  allLabel = "Last 6 months",
}: {
  basePath: string;
  value: string;
  months: { key: string; label: string }[];
  /** Text of the default (nothing picked) entry, e.g. "Last 6 months (27 weeks)". */
  allLabel?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <div className="filter-form">
      <div className="filter-field">
        <SearchSelect
          value={value}
          options={months.map((m) => ({ value: m.key, label: m.label }))}
          placeholder={allLabel}
          label="Months"
          allLabel={allLabel}
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
