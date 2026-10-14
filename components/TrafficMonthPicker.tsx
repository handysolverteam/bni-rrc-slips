"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import SearchSelect from "@/components/SearchSelect";

/** Single-select "Report month" picker for the Traffic Lights screen (window = the 6 months ending there). */
export default function TrafficMonthPicker({
  value,
  months,
  light,
}: {
  value: string;
  months: { key: string; label: string }[];
  light: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <div className="filter-form">
      <div className="filter-field">
        <SearchSelect
          value={value}
          options={months.map((m) => ({ value: m.key, label: m.label }))}
          placeholder="Report month"
          label="Report month"
          allLabel="Latest month"
          showClear={false}
          onChange={(v) => {
            const q = new URLSearchParams();
            if (v) q.set("month", v);
            if (light) q.set("light", light);
            startTransition(() => router.push(q.toString() ? `/traffic-lights?${q.toString()}` : "/traffic-lights"));
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
