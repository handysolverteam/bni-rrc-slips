import { cachedSwr } from "@/lib/cache";
import { fetchAllRows } from "@/lib/supabase/paged";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { ParsedPalmsWide } from "@/lib/palms-import";
import { bucketAttendance, rollingWindow, type AttendanceFlagRow, type PalmsBucketGroup } from "@/lib/palms-buckets";
import { todayIso } from "@/lib/missing-weeks";
import type { WeekOption } from "@/lib/weeks";

/** Flags of one attendance row joined as PALMS letters ("P", "PM", …). */
export function lettersOf(row: {
  present?: number | null;
  absent?: number | null;
  l?: number | null;
  m?: number | null;
  s?: number | null;
}): string {
  const out: string[] = [];
  if (row.present) out.push("P");
  if (row.absent) out.push("A");
  if (row.l) out.push("L");
  if (row.m) out.push("M");
  if (row.s) out.push("S");
  return out.join("");
}

/** Compact column header for the matrix + exports ("01 Apr"). */
export function palmsWeekHeader(iso: string | null): string {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(parts[1]) - 1] ?? ""}`;
}

type AttendanceRow = {
  member_name: string;
  bni_week_id: string;
  present: number | null;
  absent: number | null;
  l: number | null;
  m: number | null;
  s: number | null;
  t: number | null;
};

export type PalmsRowView = {
  name: string;
  /** cells[i] = letters for weeks[i] ("" when the cell was never imported). */
  cells: string[];
};

export type PalmsMatrix = {
  /** Weeks with attendance, ascending by meeting date. */
  weeks: (WeekOption & { header: string })[];
  rows: PalmsRowView[];
  hasAttendance: boolean;
};

const nameKey = (n: string): string => n.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Weeks this tenant has PALMS attendance for — the `/palms` week filter's
 * options. Deliberately NOT `getCachedWeekOptions` (slips batches), because a
 * multi-week PALMS batch stores no week id, so slips-derived options would
 * miss every attendance-only week.
 */
export function fetchPalmsWeekOptions(tenantId: string): Promise<WeekOption[]> {
  return cachedSwr(`palms:weeks:${tenantId}`, 60_000, () => computePalmsWeekOptions(tenantId));
}

async function computePalmsWeekOptions(tenantId: string): Promise<WeekOption[]> {
  const sb = getSupabaseServer();
  const rows = await fetchAllRows<{ bni_week_id: string }>("member_attendance", "bni_week_id", {
    eq: [["tenant_id", tenantId]],
    pageSize: 1000,
  });
  const ids = [...new Set(rows.map((r) => r.bni_week_id).filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await sb
    .from("bni_weeks")
    .select("id,label,meeting_date,week_no")
    .in("id", ids)
    .order("meeting_date", { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  return ((data ?? []) as WeekOption[]).map((w, i) => ({ ...w, week_no: w.week_no ?? i + 1 }));
}

/**
 * Member × week attendance matrix for the given scope — the `/palms` screen
 * and the PALMS export share this exact function (screen/file parity).
 * `weekIds` empty = every week with attendance.
 */
export function fetchPalmsMatrix(tenantId: string, weekIds: string[]): Promise<PalmsMatrix> {
  return cachedSwr(`palms:matrix:${tenantId}:${weekIds.join(",")}`, 60_000, () => computePalmsMatrix(tenantId, weekIds));
}

async function computePalmsMatrix(tenantId: string, weekIds: string[]): Promise<PalmsMatrix> {
  const allWeeks = await fetchPalmsWeekOptions(tenantId);
  const weeks = (weekIds.length > 0
    ? allWeeks.filter((w) => weekIds.includes(w.id))
    : allWeeks
  ).map((w) => ({ ...w, header: palmsWeekHeader(w.meeting_date) }));

  const opts = {
    eq: [["tenant_id", tenantId]] as [string, unknown][],
    in: weekIds.length > 0 ? ([["bni_week_id", weekIds]] as [string, string[]][]) : [],
    pageSize: 1000,
  };
  const attendance = await fetchAllRows<AttendanceRow>(
    "member_attendance",
    "member_name,bni_week_id,present,absent,l,m,s,t",
    opts,
  );
  const weekIndex = new Map(weeks.map((w, i) => [w.id, i]));
  const map = new Map<string, PalmsRowView>();
  for (const a of attendance) {
    const ci = weekIndex.get(a.bni_week_id);
    if (ci === undefined) continue;
    const name = a.member_name.replace(/\s+/g, " ").trim();
    if (!name) continue;
    let row = map.get(nameKey(name));
    if (!row) {
      row = { name, cells: weeks.map(() => "") };
      map.set(nameKey(name), row);
    }
    row.cells[ci] = lettersOf(a);
  }
  const rows = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { weeks, rows, hasAttendance: attendance.length > 0 };
}

/** A matrix scope (one id, comma-list, "all", or unset = all) from a search param. */
export function palmsWeekScope(param: string | undefined): string[] {
  if (!param || param === "all") return [];
  return param.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Short display for the page head ("3 meetings" / one label / "All weeks"). */
export function palmsScopeLabel(weeks: WeekOption[], weekIds: string[], allLabel: string): string {
  if (weekIds.length === 0) return allLabel;
  const active = weekIds
    .map((id) => weeks.find((w) => w.id === id))
    .filter((w): w is WeekOption => w !== undefined);
  if (active.length === 0) return "No week selected";
  return active.length > 3
    ? `${active.length} meetings`
    : active.map((w) => w.label).join(" + ");
}

/**
 * The latest PALMS import for the panel's "Imported …" line: the most recent
 * batch that is either referenced by an attendance row or named like a PALMS
 * file (covers a zero-new-cell import that created no rows).
 */
export function fetchPalmsImportRecord(
  tenantId: string,
): Promise<{ filename: string; importedAt: string } | null> {
  return cachedSwr(`palms:record:${tenantId}`, 60_000, () => computePalmsImportRecord(tenantId));
}

async function computePalmsImportRecord(
  tenantId: string,
): Promise<{ filename: string; importedAt: string } | null> {
  const sb = getSupabaseServer();
  const [batchesRes, attendance] = await Promise.all([
    sb
      .from("import_batches")
      .select("id,filename,created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100),
    fetchAllRows<{ import_batch_id: string | null }>("member_attendance", "import_batch_id", {
      eq: [["tenant_id", tenantId]],
      pageSize: 1000,
    }),
  ]);
  if (batchesRes.error) throw new Error(batchesRes.error.message);
  const referenced = new Set(attendance.map((r) => r.import_batch_id).filter(Boolean));
  const isPalmsFile = /palms|chapter[_ -]?summary/i;
  const hit = (batchesRes.data ?? []).find(
    (b) => referenced.has(b.id) || isPalmsFile.test(b.filename ?? ""),
  );
  if (!hit) return null;
  return { filename: hit.filename ?? "", importedAt: hit.created_at ?? "" };
}

export type PalmsNewCell = {
  bni_week_id: string;
  member_name: string;
  present: number;
  absent: number;
  l: number;
  m: number;
  s: number;
  t: number;
};

export type PalmsImportPlan = {
  /** Date columns that landed on the chapter's Wednesday calendar. */
  matchedColumns: { header: string; iso: string; weekId: string }[];
  /** Header labels not on the calendar — their cells are skipped (warning). */
  weeksUnknown: string[];
  memberCount: number;
  /** Letters in matched columns (new + already imported). */
  cellTotal: number;
  cellNew: number;
  cellSkipped: number;
  /** Up to 10 `"Name — dd MMM"` entries that already exist. */
  skippedSamples: string[];
  /** Parser issues (cells with unknown values) — stored on the batch. */
  issues: string[];
  /** Only the NEW cells (letter -> 0/1 flags); `import_batch_id` is set by the caller. */
  rows: PalmsNewCell[];
};

const SKIPPED_SAMPLE_CAP = 10;

function flagsFor(letter: string): Omit<PalmsNewCell, "bni_week_id" | "member_name"> {
  return {
    present: letter === "P" ? 1 : 0,
    absent: letter === "A" ? 1 : 0,
    l: letter === "L" ? 1 : 0,
    m: letter === "M" ? 1 : 0,
    s: letter === "S" ? 1 : 0,
    t: 1,
  };
}

/**
 * Shared by `POST /api/import/palms/preview` and `POST /api/import/palms`:
 * resolve the parsed file's date columns to real weeks, then split its cells
 * into "new" vs "already imported" (skip, never replace — the unique index
 * `(tenant, week, lower(member_name))` enforces it at the DB too).
 */
export async function planPalmsImport(
  tenantId: string,
  parsed: ParsedPalmsWide,
  /** Lower-cased names the user un-ticked ("do not add"): their cells are left out. */
  skipKeys: Set<string> = new Set(),
): Promise<PalmsImportPlan> {
  const sb = getSupabaseServer();
  const isos = [...new Set(parsed.columns.map((c) => c.iso))];
  const { data: weekRows, error } =
    isos.length > 0
      ? await sb.from("bni_weeks").select("id,meeting_date").in("meeting_date", isos)
      : { data: [] as { id: string; meeting_date: string | null }[], error: null };
  if (error) throw new Error(error.message);
  const weekByIso = new Map((weekRows ?? []).map((w) => [w.meeting_date as string, w.id]));

  const matchedColumns: { header: string; iso: string; weekId: string }[] = [];
  const weeksUnknown: string[] = [];
  const colWeek = new Map<number, number>(); // parsed column index -> matched index
  parsed.columns.forEach((c, ci) => {
    const weekId = weekByIso.get(c.iso);
    if (!weekId) {
      weeksUnknown.push(c.header);
      return;
    }
    colWeek.set(ci, matchedColumns.length);
    matchedColumns.push({ header: c.header, iso: c.iso, weekId });
  });
  const matchedWeekIds = [...new Set(matchedColumns.map((c) => c.weekId))];

  const existing = matchedWeekIds.length
    ? await fetchAllRows<{ bni_week_id: string; member_name: string }>(
        "member_attendance",
        "bni_week_id,member_name",
        {
          eq: [["tenant_id", tenantId]],
          in: [["bni_week_id", matchedWeekIds]],
          pageSize: 1000,
        },
      )
    : [];
  const seen = new Set(existing.map((r) => `${r.bni_week_id}|${r.member_name.toLowerCase()}`));

  const rows: PalmsNewCell[] = [];
  const skippedSamples: string[] = [];
  let cellTotal = 0;
  let cellSkipped = 0;
  let cellNew = 0;
  const kept = parsed.members.filter((m) => !skipKeys.has(m.name.replace(/\s+/g, " ").trim().toLowerCase()));
  for (const m of kept) {
    for (let ci = 0; ci < parsed.columns.length; ci++) {
      const letter = m.cells[ci];
      if (!letter) continue;
      const mi = colWeek.get(ci);
      if (mi === undefined) continue; // date not on the calendar — already warned
      cellTotal++;
      const key = `${matchedColumns[mi].weekId}|${m.name.toLowerCase()}`;
      if (seen.has(key)) {
        cellSkipped++;
        if (skippedSamples.length < SKIPPED_SAMPLE_CAP) {
          skippedSamples.push(`${m.name} — ${matchedColumns[mi].header}`);
        }
        continue;
      }
      seen.add(key); // duplicate name inside the same file skips too
      cellNew++;
      rows.push({ bni_week_id: matchedColumns[mi].weekId, member_name: m.name, ...flagsFor(letter) });
    }
  }

  return {
    matchedColumns,
    weeksUnknown,
    memberCount: kept.length,
    cellTotal,
    cellNew,
    cellSkipped,
    skippedSamples,
    issues: parsed.issues,
    rows,
  };
}

export type PalmsAttendanceStats = {
  from: string;
  to: string;
  /** Wednesday meetings inside the rolling window (≤ 26). */
  meetingCount: number;
  groups: PalmsBucketGroup[];
  /** Distinct active members sitting in at least one bucket. */
  total: number;
};

/**
 * The `/palms` "Last 6 Months rolling period (26 weeks): Active members"
 * card: sum each active member's `absent` / `m` / `s` flags over the
 * Wednesday meetings of the rolling window (`rollingWindow(today)`) and
 * bucket them 3+ / 2 / 1 per letter (`bucketAttendance`). Inactive members
 * (case-insensitive name match against `members.is_inactive`) are dropped;
 * names without a member row count as active. `null` when the window has no
 * meetings at all.
 */
export function fetchPalmsAttendanceStats(
  tenantId: string,
  today: string = todayIso(),
): Promise<PalmsAttendanceStats | null> {
  return cachedSwr(`palms:stats:${tenantId}:${today}`, 60_000, () => computePalmsAttendanceStats(tenantId, today));
}

async function computePalmsAttendanceStats(
  tenantId: string,
  today: string,
): Promise<PalmsAttendanceStats | null> {
  const { from, to } = rollingWindow(today);
  const sb = getSupabaseServer();
  const { data: weekRows, error } = await sb
    .from("bni_weeks")
    .select("id")
    .gte("meeting_date", from)
    .lte("meeting_date", to)
    .order("meeting_date", { ascending: true });
  if (error) throw new Error(error.message);
  const weekIds = (weekRows ?? []).map((w) => w.id);
  if (weekIds.length === 0) return null;

  const [rows, inactive] = await Promise.all([
    fetchAllRows<AttendanceFlagRow>("member_attendance", "member_name,absent,m,s", {
      eq: [["tenant_id", tenantId]],
      in: [["bni_week_id", weekIds]] as [string, string[]][],
      pageSize: 1000,
    }),
    fetchAllRows<{ name: string }>("members", "name", {
      eq: [
        ["tenant_id", tenantId],
        ["is_inactive", true],
      ],
      pageSize: 1000,
    }),
  ]);
  const { groups, total } = bucketAttendance(
    rows,
    inactive.map((r) => nameKey(r.name)),
  );
  return { from, to, meetingCount: weekIds.length, groups, total };
}
