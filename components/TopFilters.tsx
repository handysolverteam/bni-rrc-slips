"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import SearchSelect from "@/components/SearchSelect";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

/**
 * Member filters of the Top 3 screen: Status (Active / Inactive) and Chapter, both multi-select. The values are
 * the EFFECTIVE selection (default = active + Home Chapter, "all" = no restriction) and travel in `?status=` / `?chapter=`;
 * the other URL parameters (the months) are kept.
 */
export default function TopFilters({
  statusValue,
  chapterValue,
  chapters,
}: {
  statusValue: string;
  chapterValue: string;
  chapters: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function apply(param: "status" | "chapter", value: string) {
    const params = new URLSearchParams(window.location.search);
    // Nothing ticked any more = no restriction on that axis.
    params.set(param, value || "all");
    startTransition(() => router.push(`/top3?${params.toString()}`, { scroll: false }));
  }

  return (
    <div className="filter-form">
      <div className="filter-field">
        <SearchSelect
          value={statusValue}
          options={STATUS_OPTIONS}
          placeholder="Active"
          label="Status"
          allLabel="All members"
          multiple
          showClear={false}
          onChange={(v) => apply("status", v)}
        />
      </div>
      <div className="filter-field">
        <SearchSelect
          value={chapterValue}
          options={chapters.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Chapter"
          label="Chapter"
          allLabel="All chapters"
          multiple
          showClear={false}
          onChange={(v) => apply("chapter", v)}
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
