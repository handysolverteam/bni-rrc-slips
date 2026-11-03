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
  keepParams = [],
}: {
  basePath: string;
  value: string;
  months: { key: string; label: string }[];
  /** Text of the default (nothing picked) entry, e.g. "Last 6 months (27 weeks)". */
  allLabel?: string;
  /** Other URL parameters to carry over when the months change (default: none — the URL is rebuilt from the months only). */
  keepParams?: string[];
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
            const params = new URLSearchParams();
            const current = new URLSearchParams(window.location.search);
            for (const k of keepParams) {
              const val = current.get(k);
              if (val) params.set(k, val);
            }
            if (v && v !== "all") params.set("month", v);
            const qs = params.toString();
            const url = qs ? `${basePath}?${qs}` : basePath;
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
