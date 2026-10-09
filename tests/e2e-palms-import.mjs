// E2E: PALMS Report (/palms) — wide 6-month attendance import.
// Guards (wrong file / old single-meeting format / missing From / auth), the
// dry-run preview (new vs skipped cells, unknown header dates, bad letters),
// skip-duplicates import semantics, the member × week matrix screen, week
// filter, exports (xlsx/csv/pdf/json), remove-all, per-file batch delete, and
// the slips decoupling: /summary is gone, /report carries no PALMS verdict,
// the slips import returns no PALMS warning, and no slips row ever moves.
//
// Run:  node tests/e2e-palms-import.mjs   (from the repo root)
// Self-cleaning: snapshots the tenant's attendance, palms_stats and batches
// first, then restores all three exactly.
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const APP = "http://localhost:3000";
const ENV = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const kv = (k) => ENV.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1);
const sb = createClient(kv("NEXT_PUBLIC_SUPABASE_URL"), kv("SUPABASE_SERVICE_ROLE_KEY"));
const TENANT = "d1000000-0000-4000-8000-000000000001";
const AUTH = { Authorization: `Bearer ${kv("SUPABASE_SERVICE_ROLE_KEY")}` };

// Five real Wednesday meetings in the fixture window (all on the calendar).
const WEDS = ["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"];
const FROM_ISO = "2026-09-01";
const TO_ISO = "2026-09-30";
const serialFor = (iso) =>
  Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse("1899-12-30T00:00:00Z")) / 86400000);

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
function info(msg) {
  results.push(`INFO  ${msg}`);
}

const fd = (content, name, type) => {
  const f = new FormData();
  f.append("file", new File([content], name, { type }));
  return f;
};
const XLSX_TYPE = "application/vnd.ms-excel";
const postPalms = (buf, name, type = XLSX_TYPE) =>
  fetch(`${APP}/api/import/palms`, { method: "POST", body: fd(buf, name, type), headers: { ...AUTH } });
const postPreview = (buf, name, type = XLSX_TYPE) =>
  fetch(`${APP}/api/import/palms/preview`, { method: "POST", body: fd(buf, name, type), headers: { ...AUTH } });

/**
 * The shell server-renders only a spinner (AppShell suspense around the
 * client auth bootstrap); page content ships in the RSC flight payload and
 * is rendered by the browser. Decode the pushed payload segments into one
 * string so assertions can search the rendered tree.
 */
function flight(html) {
  const out = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      // segment not a plain string row — skip
    }
  }
  return out.join("");
}

const fetchPage = async (path) => {
  const res = await fetch(`${APP}${path}`, { headers: { ...AUTH } });
  return { status: res.status, dec: flight(await res.text()) };
};
const readSrc = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ---- fixtures -------------------------------------------------------------
// Wide report: First Name / Last Name / spacer, then one column per date.
// "Sep 29" (a Tuesday) parses as a date but is NOT on the Wednesday calendar
// -> weeksUnknown; pseudo rows (Visitors / BNI / Total) must be ignored.
const WIDE_HEADER = [
  "First Name", "Last Name", "",
  "Sep 02", "Sep 09", "Sep 16", "Sep 23", "Sep 29", "Sep 30",
];
const WIDE_ROWS = [
  ["E2E", "Palm", "", "P", "A", "M", "S", "P", "L"],
  ["E2E", "Palm Two", "", "", "", "", "", "", "P"],
  ["E2E", "Palm Zero", "", "", "", "", "", "", ""],
  ["E2E", "Odd", "", "", "", "X", "", "", ""],
  ["Visitors", "", "", "P", "", "", "", "", ""],
  ["BNI", "", "", "P", "", "", "", "", ""],
  ["Total", "", "", "P", "", "", "", "", ""],
];

async function buildWide({ from, to, header, rows, includeFrom = true }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.addRow(["PALMS Attendance Report"]);
  ws.addRow(["Chapter:", "BNI Influencers"]);
  ws.addRow(["Parameters"]);
  if (includeFrom) ws.addRow(["From:", from]);
  ws.addRow(["To:", to]);
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const wideBuf = () =>
  buildWide({ from: serialFor(FROM_ISO), to: serialFor(TO_ISO), header: WIDE_HEADER, rows: WIDE_ROWS });

/** Slips-shaped workbook: no First Name / Last Name header row. */
async function buildSlipsLikeXls() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.addRow(["Slips Audit Report for 30/09/2026"]);
  ws.addRow(["From", "To", "Slip Type", "Inside/Outside", "TYFCB Amount", "CEU Credits", "Detail"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The old single-meeting PALMS layout: P/A/L/M/S count columns, no dates. */
async function buildOldFormat() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.addRow(["Chapter Summary PALMS Report"]);
  ws.addRow(["From:", serialFor("2026-09-30")]);
  ws.addRow(["To:", serialFor("2026-09-30")]);
  ws.addRow([]);
  ws.addRow(["First Name", "Last Name", "P", "A", "", "L", "M", "S"]);
  ws.addRow(["E2E", "Palm", 3, 0, "", 1, 0, 0]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- db helpers -----------------------------------------------------------
async function e2eRows() {
  const { data } = await sb
    .from("member_attendance")
    .select("*")
    .eq("tenant_id", TENANT)
    .like("member_name", "E2E %");
  return data ?? [];
}
async function latestBatch(filename) {
  const { data } = await sb
    .from("import_batches")
    .select("id,filename,bni_week_id,imported_count,skipped_count,status,error_message")
    .eq("tenant_id", TENANT)
    .eq("filename", filename)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// ---- baseline snapshot / restore -----------------------------------------
let baseline = [];
let baselineStats = [];
let baselineBatches = [];

async function preClean() {
  // The test owns the tenant's attendance + stats for its duration; the
  // exact pre-test rows come back in cleanup().
  await sb.from("member_attendance").delete().eq("tenant_id", TENANT);
  await sb.from("palms_stats").delete().eq("tenant_id", TENANT);
  await sb.from("members").delete().eq("tenant_id", TENANT).like("name", "E2E %");
  const { data: stale } = await sb
    .from("import_batches")
    .select("id")
    .eq("tenant_id", TENANT)
    .like("filename", "e2e-palms%");
  for (const b of stale ?? []) await sb.from("import_batches").delete().eq("id", b.id);
}

async function cleanup() {
  await sb.from("member_attendance").delete().eq("tenant_id", TENANT);
  await sb.from("palms_stats").delete().eq("tenant_id", TENANT);
  await sb.from("members").delete().eq("tenant_id", TENANT).like("name", "E2E %");
  const { data: testB } = await sb
    .from("import_batches")
    .select("id")
    .eq("tenant_id", TENANT)
    .like("filename", "e2e-palms%");
  for (const b of testB ?? []) await sb.from("import_batches").delete().eq("id", b.id);
  // Remove-all drops the batches the baseline stats/attendance referenced —
  // put any missing baseline batch back first (children FK on import_batch_id).
  const { data: nowB } = await sb.from("import_batches").select("id").eq("tenant_id", TENANT);
  const nowIds = new Set((nowB ?? []).map((b) => b.id));
  const missing = baselineBatches.filter((b) => !nowIds.has(b.id));
  if (missing.length > 0) {
    const { error } = await sb.from("import_batches").insert(missing);
    if (error) info(`batch restore failed: ${error.message}`);
  }
  if (baseline.length > 0) {
    const { error } = await sb.from("member_attendance").insert(baseline);
    if (error) info(`attendance restore failed: ${error.message}`);
  }
  if (baselineStats.length > 0) {
    const { error } = await sb.from("palms_stats").insert(baselineStats);
    if (error) info(`stats restore failed: ${error.message}`);
  }
}

// ---- run ------------------------------------------------------------------
try {
  const { data: att0 } = await sb.from("member_attendance").select("*").eq("tenant_id", TENANT);
  const { data: stats0 } = await sb.from("palms_stats").select("*").eq("tenant_id", TENANT);
  baseline = att0 ?? [];
  baselineStats = stats0 ?? [];
  await preClean();
  const { data: batches0 } = await sb.from("import_batches").select("*").eq("tenant_id", TENANT);
  baselineBatches = batches0 ?? [];
  info(
    `baseline: ${baseline.length} attendance rows, ${baselineStats.length} stats rows, ` +
      `${baselineBatches.length} batches`,
  );

  const { data: weekRows } = await sb
    .from("bni_weeks")
    .select("id,meeting_date,label")
    .in("meeting_date", WEDS);
  const weekByIso = new Map((weekRows ?? []).map((w) => [w.meeting_date, w]));
  check("all 5 fixture Wednesdays exist on the calendar", (weekRows ?? []).length === 5,
    `${(weekRows ?? []).length} week(s)`);
  const w = (iso) => weekByIso.get(iso)?.id ?? "";

  // 1) file-type + format guards -------------------------------------------
  let r = await postPalms("From,To,Slip Type\n", "e2e-palms.csv", "text/csv");
  let j = await r.json();
  check("import: csv rejected by extension guard", r.status === 400 && /xls/i.test(j.error ?? ""),
    `${r.status} ${j.error}`);
  r = await postPreview("From,To,Slip Type\n", "e2e-palms.csv", "text/csv");
  check("preview: csv rejected by extension guard", r.status === 400, String(r.status));

  r = await postPalms(await buildSlipsLikeXls(), "e2e-palms-slips-shape.xls");
  j = await r.json();
  check("slips-shaped xls: 400 names the header row",
    r.status === 400 && /First Name/i.test(j.error ?? ""), `${r.status} ${j.error}`);

  r = await postPalms(await buildOldFormat(), "e2e-palms-old-format.xls");
  j = await r.json();
  check("old single-meeting format rejected with a clear message",
    r.status === 400 && /old single-meeting/i.test(j.error ?? ""), `${r.status} ${j.error}`);

  r = await postPalms(
    await buildWide({ from: serialFor(FROM_ISO), to: serialFor(TO_ISO), header: WIDE_HEADER, rows: WIDE_ROWS, includeFrom: false }),
    "e2e-palms-no-from.xls",
  );
  j = await r.json();
  check("missing From: range rejected", r.status === 400 && /Could not read/i.test(j.error ?? ""),
    `${r.status} ${j.error}`);

  r = await fetch(`${APP}/api/import/palms/preview`, { method: "POST", body: fd("x", "e2e-palms.xls", XLSX_TYPE) });
  check("preview requires auth (401)", r.status === 401, String(r.status));
  r = await fetch(`${APP}/api/import/palms`, { method: "POST", body: fd("x", "e2e-palms.xls", XLSX_TYPE) });
  check("import requires auth (401)", r.status === 401, String(r.status));

  // 2) dry-run preview ------------------------------------------------------
  const file1 = await wideBuf();
  r = await postPreview(file1, "e2e-palms-v1.xls");
  j = await r.json();
  check("preview: 200 + From/To range", r.ok && j.from === FROM_ISO && j.to === TO_ISO,
    `${r.status} ${j.from} -> ${j.to}`);
  check("preview: 4 members, 5 matched weeks", j.memberCount === 4 && j.weeksMatched === 5,
    JSON.stringify({ memberCount: j.memberCount, weeksMatched: j.weeksMatched }));
  check("preview: off-calendar Sep 29 warned, not fatal",
    Array.isArray(j.weeksUnknown) && j.weeksUnknown.length === 1 && j.weeksUnknown[0] === "Sep 29",
    JSON.stringify(j.weeksUnknown));
  check("preview: 6 letter cells, all new", j.cellTotal === 6 && j.cellNew === 6 && j.cellSkipped === 0,
    JSON.stringify({ cellTotal: j.cellTotal, cellNew: j.cellNew, cellSkipped: j.cellSkipped }));
  check("preview: unknown letter listed as an issue",
    j.issues?.length === 1 && /^E2E Odd — Sep 16: "X" is not a known attendance letter/.test(j.issues[0]),
    JSON.stringify(j.issues));
  check("preview writes nothing", (await e2eRows()).length === 0);

  // 3) import ---------------------------------------------------------------
  r = await postPalms(file1, "e2e-palms-v1.xls");
  j = await r.json();
  check("import: 6 new cells across 5 weeks",
    r.ok && j.importedCount === 6 && j.skippedCount === 0 && j.weekCount === 5,
    `${r.status} ${JSON.stringify(j).slice(0, 240)}`);
  check("import echoes members, unknown date and issues",
    j.memberCount === 4 && j.weeksUnknown?.[0] === "Sep 29" && j.issues?.length === 1 && j.errors?.length === 0,
    JSON.stringify({ memberCount: j.memberCount, weeksUnknown: j.weeksUnknown, issues: j.issues?.length }));

  const rows1 = await e2eRows();
  const byKey = new Map(rows1.map((x) => [`${x.member_name}|${x.bni_week_id}`, x]));
  const cnt = (n) => rows1.filter((x) => x.member_name === n).length;
  check("6 rows stored (pseudo + blank members skipped)",
    rows1.length === 6 && cnt("E2E Palm") === 5 && cnt("E2E Palm Two") === 1 &&
      cnt("E2E Palm Zero") === 0 && cnt("E2E Odd") === 0,
    `n=${rows1.length}`);
  const flagsOk = (name, iso, exp) => {
    const row = byKey.get(`${name}|${w(iso)}`);
    if (!row) return false;
    return ["present", "absent", "l", "m", "s"].every((k) => row[k] === exp[k]);
  };
  check("P cell -> present flag", flagsOk("E2E Palm", "2026-09-02", { present: 1, absent: 0, l: 0, m: 0, s: 0 }));
  check("A cell -> absent flag", flagsOk("E2E Palm", "2026-09-09", { present: 0, absent: 1, l: 0, m: 0, s: 0 }));
  check("M cell -> m flag", flagsOk("E2E Palm", "2026-09-16", { present: 0, absent: 0, l: 0, m: 1, s: 0 }));
  check("S cell -> s flag", flagsOk("E2E Palm", "2026-09-23", { present: 0, absent: 0, l: 0, m: 0, s: 1 }));
  check("L cell -> l flag", flagsOk("E2E Palm", "2026-09-30", { present: 0, absent: 0, l: 1, m: 0, s: 0 }));
  check("every stored cell carries t=1", rows1.length > 0 && rows1.every((x) => x.t === 1));
  const otherTenant = await sb
    .from("member_attendance")
    .select("id")
    .neq("tenant_id", TENANT)
    .like("member_name", "E2E %");
  check("no E2E rows outside the active tenant",
    (otherTenant.data ?? []).length === 0, String(otherTenant.error ?? ""));

  const batch = await latestBatch("e2e-palms-v1.xls");
  check("batch history: counts recorded, no single week id",
    !!batch && batch.imported_count === 6 && batch.skipped_count === 0 && batch.bni_week_id === null,
    JSON.stringify(batch));
  check("batch keeps the issue list for the audit trail",
    !!batch?.error_message?.includes("E2E Odd"), String(batch?.error_message).slice(0, 160));

  // 4) idempotence: cells are skipped, never replaced ------------------------
  r = await postPalms(file1, "e2e-palms-v1.xls");
  j = await r.json();
  check("re-import: 0 new, 6 skipped",
    r.ok && j.importedCount === 0 && j.skippedCount === 6 && j.weekCount === 5,
    `${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  check("re-import stored no duplicates", (await e2eRows()).length === 6, String((await e2eRows()).length));
  const v1Batches = await sb
    .from("import_batches")
    .select("id")
    .eq("tenant_id", TENANT)
    .eq("filename", "e2e-palms-v1.xls");
  check("zero-new import creates no second batch", (v1Batches.data ?? []).length === 1,
    String((v1Batches.data ?? []).length));

  r = await postPreview(file1, "e2e-palms-v1.xls");
  j = await r.json();
  check("preview after import: everything skipped",
    j.cellNew === 0 && j.cellSkipped === 6 && j.cellTotal === 6,
    JSON.stringify({ cellNew: j.cellNew, cellSkipped: j.cellSkipped }));
  check("skip samples name member + date",
    Array.isArray(j.skippedSamples) && j.skippedSamples.includes("E2E Palm — Sep 02"),
    JSON.stringify(j.skippedSamples?.slice(0, 3)));

  // 5) /palms screen ---------------------------------------------------------
  const pal = await fetchPage("/palms");
  check("/palms renders200", pal.status === 200, String(pal.status));
  check("/palms shows the Attendance h1", pal.dec.includes('"Attendance"'));
  check("/palms count badge = 2 members", pal.dec.includes('[2," member(s)"]'));
  check("/palms default scope = All weeks", pal.dec.includes('"children":"All weeks"'));
  check("/palms matrix headers 02..30 Sep",
    ["02 Sep", "09 Sep", "16 Sep", "23 Sep", "30 Sep"].every((h) => pal.dec.includes(`"${h}"`)),
    "");
  check("/palms never renders the off-calendar 29 Sep column", !pal.dec.includes('"29 Sep"'));
  {
    // The stats card now sits ABOVE the matrix and can list the same name, so
    // look for the matrix row from the grid table onward.
    // (Flight chunks may be ordered either way, so take the occurrence that
    // is followed by letter cells.)
    let i = -1;
    for (let k = pal.dec.indexOf('"E2E Palm"'); k >= 0; k = pal.dec.indexOf('"E2E Palm"', k + 1)) {
      if (pal.dec.slice(k, k + 900).includes("plm-")) { i = k; break; }
    }
    const slice = i > 0 ? pal.dec.slice(i, i + 900) : "";
    check("/palms E2E Palm row shows P A M S L letter cells",
      i > 0 && ["plm-p", "plm-a", "plm-m", "plm-s", "plm-l"].every((c) => slice.includes(c)),
      `i=${i}`);
  }
  check("/palms blank / bad-letter members are not rows",
    !pal.dec.includes("E2E Palm Zero") && !pal.dec.includes("E2E Odd"));
  check("/palms shows the P/A/M/S/L legend",
    pal.dec.includes("P Present · A Absent · M Medical · S Substitute · L Leave"));
  check("/palms names the imported file", pal.dec.includes("e2e-palms-v1.xls"));
  // Client subtrees ship as refs + props only (the DOM renders in the
  // browser), so the panel state is asserted through its props.
  check("/palms panel props: hasData=true + import record",
    pal.dec.includes('"hasData":true') && pal.dec.includes('"record"'),
    "");
  check("/palms hides the empty-state hint after import",
    !pal.dec.includes("No PALMS attendance imported yet"));
  check("/palms loading route ships PalmsSkeleton",
    readSrc("app/palms/loading.tsx").includes("<PalmsSkeleton"));

  // 6) week filter -----------------------------------------------------------
  const wk = await fetchPage(`/palms?week=${w("2026-09-30")}`);
  check("week filter narrows the matrix to one column",
    wk.dec.includes('"30 Sep"') && !wk.dec.includes('"02 Sep"'));
  check("week scope label = the meeting's label",
    !!weekByIso.get("2026-09-30")?.label && wk.dec.includes(weekByIso.get("2026-09-30").label),
    weekByIso.get("2026-09-30")?.label);

  // 7) /summary removed -------------------------------------------------------
  const rSum = await fetch(`${APP}/summary`, { headers: { ...AUTH } });
  check("/summary is gone (404)", rSum.status === 404, String(rSum.status));
  const rSumExp = await fetch(`${APP}/api/summary/export?week=all&format=xlsx`, { headers: { ...AUTH } });
  check("/api/summary/export is gone (404)", rSumExp.status === 404, String(rSumExp.status));
  const navSrc = readSrc("components/Nav.tsx");
  check("nav: Attendance links to /palms, no /summary entry",
    navSrc.includes('{ href: "/palms", label: "Attendance"') && !navSrc.includes('"/summary"'));

  // 8) exports ---------------------------------------------------------------
  const normRow = (row) => Array.from({ length: 6 }, (_, i) => row?.[i] ?? "");
  const rx = await fetch(`${APP}/api/palms/export?week=all&format=xlsx`, { headers: { ...AUTH } });
  const xbuf = Buffer.from(await rx.arrayBuffer());
  check("xlsx export: 200 + palms-report filename",
    rx.ok && (rx.headers.get("content-disposition") ?? "").includes("palms-report-All-weeks.xlsx"),
    rx.headers.get("content-disposition") ?? "");
  const wbk = XLSX.read(xbuf, { type: "buffer" });
  check("xlsx: exactly one Attendance sheet",
    wbk.SheetNames.length === 1 && wbk.SheetNames[0] === "Attendance",
    JSON.stringify(wbk.SheetNames));
  const aoa = XLSX.utils.sheet_to_json(wbk.Sheets["Attendance"], { header: 1 });
  check("xlsx: title + member count row",
    aoa[0]?.[0] === "Attendance — All weeks" && aoa[1]?.[0] === "Members: 2",
    JSON.stringify(aoa.slice(0, 2)));
  check("xlsx: headers = Member + the 5 week columns",
    JSON.stringify(normRow(aoa[2])) ===
      JSON.stringify(["Member", "02 Sep", "09 Sep", "16 Sep", "23 Sep", "30 Sep"]),
    JSON.stringify(aoa[2]));
  check("xlsx cells identical to the screen (P A M S L)",
    JSON.stringify(normRow(aoa.find((row) => row?.[0] === "E2E Palm"))) ===
      JSON.stringify(["E2E Palm", "P", "A", "M", "S", "L"]),
    JSON.stringify(aoa.find((row) => row?.[0] === "E2E Palm")));
  check("xlsx blank cells export as empty strings",
    JSON.stringify(normRow(aoa.find((row) => row?.[0] === "E2E Palm Two"))) ===
      JSON.stringify(["E2E Palm Two", "", "", "", "", "P"]),
    JSON.stringify(aoa.find((row) => row?.[0] === "E2E Palm Two")));

  const rw = await fetch(`${APP}/api/palms/export?week=${w("2026-09-30")}&format=xlsx`, { headers: { ...AUTH } });
  const wbk2 = XLSX.read(Buffer.from(await rw.arrayBuffer()), { type: "buffer" });
  const aoa2 = XLSX.utils.sheet_to_json(wbk2.Sheets["Attendance"], { header: 1 });
  check("xlsx week scope: title uses the week's label, one date column",
    aoa2[0]?.[0] === `Attendance — ${weekByIso.get("2026-09-30").label}` &&
      JSON.stringify(normRow(aoa2[2]).slice(0, 2)) === JSON.stringify(["Member", "30 Sep"]),
    JSON.stringify(aoa2[0]) + " " + JSON.stringify(aoa2[2]));

  const rc = await fetch(`${APP}/api/palms/export?week=all&format=csv`, { headers: { ...AUTH } });
  const csv = await rc.text();
  check("csv: scope line + member row identical to the screen",
    csv.includes('Week,"All weeks"') && csv.includes('Members,2') &&
      csv.includes('"E2E Palm","P","A","M","S","L"'),
    csv.split("\n").slice(0, 4).join(" | "));

  const rj = await (await fetch(`${APP}/api/palms/export?week=all&format=json`, { headers: { ...AUTH } })).json();
  check("json: filename, scope, counts, null total row",
    rj.filename === "palms-report-All-weeks.pdf" && rj.weekLabel === "All weeks" &&
      rj.memberCount === 2 && rj.totalRow === null,
    JSON.stringify(rj).slice(0, 200));
  check("json: headers + rows mirror the screen",
    JSON.stringify(rj.headers) ===
      JSON.stringify(["Member", "02 Sep", "09 Sep", "16 Sep", "23 Sep", "30 Sep"]) &&
      rj.rows?.length === 2 && JSON.stringify(rj.rows[0]) ===
        JSON.stringify(["E2E Palm", "P", "A", "M", "S", "L"]),
    JSON.stringify(rj.headers));

  const rpdf = await fetch(`${APP}/api/palms/export?week=all&format=pdf`, { headers: { ...AUTH } });
  const pbuf = Buffer.from(await rpdf.arrayBuffer());
  const ptxt = pbuf.toString("latin1");
  check("pdf: %PDF- header + Attendance title",
    rpdf.ok && pbuf.slice(0, 5).toString() === "%PDF-" && ptxt.includes("Attendance"),
    pbuf.slice(0, 5).toString());
  check("pdf: no comparison leftovers", !ptxt.includes("PALMS vs slips") && !ptxt.includes("MISMATCH"));

  const rNoWeek = await fetch(`${APP}/api/palms/export?format=xlsx`, { headers: { ...AUTH } });
  check("export without week: 400", rNoWeek.status === 400, String(rNoWeek.status));
  const rBadFmt = await fetch(`${APP}/api/palms/export?week=all&format=docx`, { headers: { ...AUTH } });
  const badJ = await rBadFmt.json();
  check("export rejects unknown formats", rBadFmt.status === 400 && /format/i.test(badJ.error ?? ""),
    `${rBadFmt.status} ${badJ.error}`);
  const rNoAuth = await fetch(`${APP}/api/palms/export?week=all`);
  check("export requires auth (401)", rNoAuth.status === 401, String(rNoAuth.status));

  // 9) /report decoupled from PALMS -----------------------------------------
  const rep = await fetchPage("/report");
  check("/report: no PALMS-vs-slips verdict anywhere",
    !rep.dec.includes("PALMS matches slip data") && !rep.dec.includes("PALMS vs slips") &&
      !rep.dec.includes("Chapter Summary PALMS"));
  check("/report still ships its loading skeleton", rep.dec.includes('"skel"'), "");
  const reportSrc = readSrc("app/report/page.tsx");
  const dwAt = reportSrc.indexOf("<DataWarnings");
  const impAt = reportSrc.indexOf("<ImportPanel");
  const cardsAt = reportSrc.indexOf('className="cards stat-cards"');
  check("/report mounts DataWarnings -> ImportPanel -> stat cards, no PALMS panel",
    dwAt > 0 && impAt > dwAt && cardsAt > impAt && !reportSrc.includes("<PalmsImportPanel") &&
      !reportSrc.includes('variant="toolbar"'),
    `dw=${dwAt} slips=${impAt} cards=${cardsAt}`);
  check("report page carries no comparison logic",
    !reportSrc.includes("fetchPalmsComparisons") && !reportSrc.includes("PalmsComparisonTable"));
  const dwSrc = readSrc("components/DataWarnings.tsx");
  check("DataWarnings shows slips notices only",
    !dwSrc.includes("PALMS vs slips") && !dwSrc.includes("matches slip data") &&
      !dwSrc.includes("Chapter Summary"));

  // Slips import: independent, and it no longer warns about PALMS at all.
  const slipsCsv =
    "Slips Audit Report for 14/10/2026\n" +
    "From,To,Slip Type,Inside/Outside,TYFCB Amount,CEU Credits,Detail\n" +
    "E2E Slip Person,E2E Slip Target,Referral,Tier 1,,,\n";
  r = await fetch(`${APP}/api/import/report`, {
    method: "POST",
    body: fd(slipsCsv, "e2e-palms-slips.csv", "text/csv"),
    headers: { ...AUTH },
  });
  j = await r.json();
  check("slips import: 200 with no PALMS warning field",
    r.ok && !("warning" in j), `${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  const slBatch = await latestBatch("e2e-palms-slips.csv");
  const delSl = slBatch
    ? await fetch(`${APP}/api/import/batches/${slBatch.id}`, { method: "DELETE", headers: { ...AUTH } })
    : null;
  check("slips test batch removed (cleanup)", !!delSl?.ok, `${delSl?.status ?? "no batch"}`);

  // 10) skeletons + /import history ------------------------------------------
  const imp = await fetchPage("/import");
  check("/import: skeleton + both history titles",
    imp.dec.includes('"skel"') && imp.dec.includes("Imported Slips Audit Reports") &&
      imp.dec.includes("Imported PALMS Reports"),
    "");
  const impSrc = readSrc("components/ImportPage.tsx");
  check("ImportPage history titles: PALMS Reports, old name gone",
    impSrc.includes('title="Imported Slips Audit Reports"') &&
      impSrc.includes('title="Imported PALMS Reports"') &&
      !impSrc.includes("Imported Chapter Summary PALMS") && !impSrc.includes("Imported weeks"));
  const skelSrc = readSrc("components/Skeletons.tsx");
  check("Skeletons ship PalmsSkeleton + PALMS panel/table mirrors",
    skelSrc.includes("export function PalmsSkeleton") &&
      skelSrc.includes('PanelSkeleton title="PALMS Report (6 months)"') &&
      skelSrc.includes('ImportHistorySkeleton heading="Imported PALMS Reports"'));

  // 11) panel flow (source-level) --------------------------------------------
  const panelSrc = readSrc("components/PalmsImportPanel.tsx");
  {
    const f = panelSrc.indexOf('type="file"');
    const b = panelSrc.indexOf("onClick={upload}");
    check("panel is two-step: picking a file only previews",
      f > 0 && b > f && panelSrc.slice(f, b).includes("preview(") &&
        !panelSrc.slice(f, b).includes("upload("),
      `file=${f} btn=${b}`);
  }
  check("panel: Import disabled while a preview has nothing new",
    panelSrc.includes("disabled={state.kind === \"busy\" || refreshing || pv.cellNew === 0}"));
  check("panel: minimize / import-files toggle",
    panelSrc.includes('className="import-toggle"') && panelSrc.includes("aria-expanded={open}") &&
      panelSrc.includes('{open ? "− Minimize" : "+ Import files"}'));
  check("panel: remove-all confirm dialog names what stays",
    panelSrc.includes('title="Remove all PALMS data?"') &&
      panelSrc.includes("The slips import and every other import stay."));
  check("panel hits the dry-run preview before the real import",
    panelSrc.includes('fetch("/api/import/palms/preview"') &&
      panelSrc.indexOf("/api/import/palms/preview") <
        panelSrc.indexOf('fetch("/api/import/palms", { method: "POST"'));
  check("panel offers Remove all PALMS data when the chapter has cells",
    panelSrc.includes("Remove all PALMS data") && panelSrc.includes("hasData ? ("));

  // 12) remove-all ------------------------------------------------------------
  const { count: slipsBefore } = await sb
    .from("slip_referrals")
    .select("id", { count: "exact", head: true });
  r = await fetch(`${APP}/api/import/palms`, { method: "DELETE", headers: { ...AUTH } });
  j = await r.json();
  check("remove-all: 200 + counts",
    r.ok && j.ok === true && j.removed?.attendance === 6 && j.removed?.batches === 1,
    JSON.stringify(j));
  const allRows = await sb.from("member_attendance").select("id").eq("tenant_id", TENANT);
  check("remove-all empties the chapter's attendance", (allRows.data ?? []).length === 0,
    String((allRows.data ?? []).length));
  const { count: slipsAfter } = await sb
    .from("slip_referrals")
    .select("id", { count: "exact", head: true });
  check("remove-all never touches slips rows", slipsAfter === slipsBefore,
    `${slipsBefore} -> ${slipsAfter}`);
  check("PALMS batch gone from history", !(await latestBatch("e2e-palms-v1.xls")), "");
  r = await fetch(`${APP}/api/import/palms`, { method: "DELETE", headers: { ...AUTH } });
  check("second remove-all: 404 (nothing left)", r.status === 404, String(r.status));

  const gone = await fetchPage("/palms");
  check("/palms: empty-state hint back", gone.dec.includes("No PALMS attendance imported yet"));
  check("/palms: hasData=false, import record gone",
    gone.dec.includes('"hasData":false') && !gone.dec.includes("e2e-palms-v1.xls"));
  check("/palms: badge back to 0", gone.dec.includes('[0," member(s)"]'));
  check("/palms: stats card hidden with no attendance", !gone.dec.includes("Last 6 Months"));

  // 13) re-import + per-file batch delete ------------------------------------
  r = await postPalms(await wideBuf(), "e2e-palms-restore.xls");
  j = await r.json();
  check("re-import after remove-all works", r.ok && j.importedCount === 6,
    `${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  const pb = await latestBatch("e2e-palms-restore.xls");
  const dP = pb
    ? await fetch(`${APP}/api/import/batches/${pb.id}`, { method: "DELETE", headers: { ...AUTH } })
    : null;
  const dPJ = dP?.ok ? await dP.json() : {};
  check("per-file batch delete removes exactly its cells",
    dP?.ok && dPJ.removed?.member_attendance === 6, JSON.stringify(dPJ));
  check("attendance empty again after the batch delete", (await e2eRows()).length === 0,
    String((await e2eRows()).length));

  // 14) rolling 26-week "Active members" breakdown card ----------------------
  // Attendance is empty here, so the card sees exactly the rows seeded below:
  // one member per bucket (depth 1-4), a present-only control, and an
  // inactive member that must be filtered out entirely.
  const att = (name, iso, flags) => ({
    tenant_id: TENANT,
    bni_week_id: w(iso),
    member_name: name,
    present: 0, absent: 0, l: 0, m: 0, s: 0, t: 0,
    ...flags,
  });
  const bRows = [
    att("E2E Four Absent", "2026-09-02", { absent: 1 }),
    att("E2E Four Absent", "2026-09-09", { absent: 1 }),
    att("E2E Four Absent", "2026-09-16", { absent: 1 }),
    att("E2E Four Absent", "2026-09-23", { absent: 1 }),
    att("E2E Three Absent", "2026-09-02", { absent: 1 }),
    att("E2E Three Absent", "2026-09-09", { absent: 1 }),
    att("E2E Three Absent", "2026-09-16", { absent: 1 }),
    att("E2E Two Absent", "2026-09-02", { absent: 1 }),
    att("E2E Two Absent", "2026-09-09", { absent: 1 }),
    att("E2E Palm", "2026-09-09", { absent: 1 }),
    att("E2E Palm", "2026-09-16", { m: 1 }),
    att("E2E Palm", "2026-09-23", { s: 1 }),
    att("E2E Three Medical", "2026-09-02", { m: 1 }),
    att("E2E Three Medical", "2026-09-09", { m: 1 }),
    att("E2E Three Medical", "2026-09-16", { m: 1 }),
    att("E2E Two Medical", "2026-09-02", { m: 1 }),
    att("E2E Two Medical", "2026-09-09", { m: 1 }),
    att("E2E Three Substitute", "2026-09-02", { s: 1 }),
    att("E2E Three Substitute", "2026-09-09", { s: 1 }),
    att("E2E Three Substitute", "2026-09-16", { s: 1 }),
    att("E2E Two Substitute", "2026-09-02", { s: 1 }),
    att("E2E Two Substitute", "2026-09-09", { s: 1 }),
    att("E2E Inactive Person", "2026-09-02", { absent: 1 }),
    att("E2E Inactive Person", "2026-09-09", { absent: 1 }),
    att("E2E Inactive Person", "2026-09-16", { absent: 1 }),
    att("E2E Palm Two", "2026-09-02", { present: 1 }),
    att("E2E Palm Two", "2026-09-09", { present: 1 }),
  ];
  const memIns = await sb.from("members").insert({
    name: "E2E Inactive Person",
    tenant_id: TENANT,
    is_inactive: true,
  });
  check("bucket seeding: inactive member inserted", !memIns.error,
    memIns.error ? memIns.error.message : "ok");
  const rowIns = await sb.from("member_attendance").insert(bRows);
  check("bucket seeding: 27 attendance rows inserted", !rowIns.error,
    rowIns.error ? rowIns.error.message : `${bRows.length} rows`);

  const bm = await fetchPage("/palms");
  const hi = bm.dec.indexOf("Last 6 Months");
  // Start a little before the heading text so the element's opening props
  // ("children":…) are inside the slice too.
  // The card ends where the week-filter card begins (it sits above the filters now).
  const endAt = hi >= 0 ? bm.dec.indexOf('"className":"card report-controls"', hi) : -1;
  const s = hi >= 0 ? bm.dec.slice(Math.max(0, hi - 100), endAt > hi ? endAt : undefined) : "";
  check("stats card: heading rendered", hi >= 0 && s.includes(
    '"children":"Last 6 Months rolling period (26 weeks): Active members"'));
  check("stats card: window line renders", s.includes(" meeting(s)"));

  const LABELS = [
    "3+ Absents", "2 Absents", "1 Absent",
    "3+ Medicals", "2 Medicals", "1 Medical",
    "3+ Substitutes", "2 Substitutes", "1 Substitute",
  ];
  let prev = -1;
  let ordered = true;
  for (const l of LABELS) {
    const i = s.indexOf(`"${l}"`);
    if (i < 0 || i < prev) { ordered = false; break; }
    prev = i;
  }
  check("stats card: all 9 bucket labels in order", ordered);
  const region = (label) => {
    const i = s.indexOf(`"${label}"`);
    if (i < 0) return "";
    let end = s.length;
    for (let k = LABELS.indexOf(label) + 1; k < LABELS.length; k++) {
      const j = s.indexOf(`"${LABELS[k]}"`, i + 1);
      if (j >= 0) { end = j; break; }
    }
    return s.slice(i, end);
  };
  check("3+ Absents: Four+Three (count 2)",
    region("3+ Absents").includes("E2E Four Absent") &&
    region("3+ Absents").includes("E2E Three Absent") &&
    region("3+ Absents").includes('"children":2'),
    region("3+ Absents").slice(0, 300));
  check("2 Absents: Two Absent only",
    region("2 Absents").includes("E2E Two Absent") &&
    !region("2 Absents").includes("E2E Four Absent"));
  check("1 Absent: E2E Palm", region("1 Absent").includes("E2E Palm"));
  check("3+ Medicals: Three Medical (count 1)",
    region("3+ Medicals").includes("E2E Three Medical") &&
    region("3+ Medicals").includes('"children":1'));
  check("2 Medicals: Two Medical only",
    region("2 Medicals").includes("E2E Two Medical") &&
    !region("2 Medicals").includes("E2E Three Medical"));
  check("1 Medical: E2E Palm", region("1 Medical").includes("E2E Palm"));
  check("3+ Substitutes: Three Substitute",
    region("3+ Substitutes").includes("E2E Three Substitute"));
  check("2 Substitutes: Two Substitute only",
    region("2 Substitutes").includes("E2E Two Substitute") &&
    !region("2 Substitutes").includes("E2E Three Substitute"));
  check("1 Substitute: E2E Palm", region("1 Substitute").includes("E2E Palm"));
  const inDb = (await sb.from("member_attendance").select("id")
    .eq("tenant_id", TENANT).eq("member_name", "E2E Inactive Person")).data ?? [];
  check("inactive member's rows exist but name is out of the card",
    inDb.length === 3 && !s.includes("E2E Inactive Person"),
    `rows=${inDb.length} inSlice=${s.includes("E2E Inactive Person")}`);
  check("present-only member is out of the card, present members are in",
    !s.includes("E2E Palm Two") && s.includes("E2E Palm"));
  check("PalmsSkeleton mirrors the breakdown card",
    readSrc("components/Skeletons.tsx").includes("palms-stats-groups"));
} finally {
  await cleanup();
  const att = (await sb.from("member_attendance").select("id").eq("tenant_id", TENANT)).data ?? [];
  check("baseline attendance restored", att.length === baseline.length,
    `now=${att.length} base=${baseline.length}`);
  const stats = (await sb.from("palms_stats").select("id").eq("tenant_id", TENANT)).data ?? [];
  check("baseline palms_stats restored", stats.length === baselineStats.length,
    `now=${stats.length} base=${baselineStats.length}`);
  const { data: nowB } = await sb.from("import_batches").select("id,filename").eq("tenant_id", TENANT);
  const testLeft = (nowB ?? []).filter((b) => /^e2e-palms/i.test(b.filename ?? ""));
  check("no test batches left behind", testLeft.length === 0, JSON.stringify(testLeft));
  const baseIds = new Set(baselineBatches.map((b) => b.id));
  const kept = (nowB ?? []).filter((b) => baseIds.has(b.id));
  check("baseline batches restored", kept.length === baselineBatches.length,
    `now=${kept.length} base=${baselineBatches.length}`);
}

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
