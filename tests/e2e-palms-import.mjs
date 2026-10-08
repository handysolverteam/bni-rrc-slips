// E2E: Chapter Summary PALMS attendance import — parser guards (wrong file,
// range report, unknown week), replace-per-week semantics, tenant scoping, and
// the /summary member-wise table (P A L M S + slip stats, totals row). Either
// file may be imported first: a calendar week without slips imports fine and
// the response + screens show the red "not imported yet" notice instead of a
// 400, and a slips import without PALMS warns the same way. Plus the
// data-health features: palms_stats Total-row
// storage, the immediate PALMS-vs-slips comparison verdict, the green match /
// red mismatch banners on /summary and /report, and the missing-Wednesday
// warning staying quiet while the import history is gap-free. Plus the
// Chapter Summary export (`/api/summary/export`): xlsx cells (member table
// only — the PALMS-vs-slips comparison is screen-only and never exported),
// json payload for the in-browser PDF, the server pdf, and parameter/auth
// guards.
//
// Run:  node tests/e2e-palms-import.mjs   (from the repo root)
// Self-cleaning: snapshots the week's attendance + palms_stats first, then
// restores both.
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const APP = "http://localhost:3000";
const ENV = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const kv = (k) => ENV.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1);
const sb = createClient(kv("NEXT_PUBLIC_SUPABASE_URL"), kv("SUPABASE_SERVICE_ROLE_KEY"));
const MEETING = "2026-09-30"; // existing week 40
const SERIAL = 46295; // Excel serial for 2026-09-30 (epoch 1899-12-30)
const TENANT = "d1000000-0000-4000-8000-000000000001";
const AUTH = { Authorization: `Bearer ${kv("SUPABASE_SERVICE_ROLE_KEY")}` };

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);

const fd = (content, name, type) => {
  const f = new FormData();
  f.append("file", new File([content], name, { type }));
  return f;
};
const postPalms = (buf, name, type = "application/vnd.ms-excel") =>
  fetch(`${APP}/api/import/palms`, { method: "POST", body: fd(buf, name, type), headers: { ...AUTH } });

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

/** True when `name`'s row contains cell `label` holding `val`. */
function rowWin(dec, name, label, val) {
  const i = dec.indexOf(`"${name}"`);
  if (i < 0) return false;
  return dec.slice(i, i + 700).includes(`"td","${label}",{"children":"${val}"}`);
}

// ---- fixtures -------------------------------------------------------------
const HEADER = [
  "First Name", "Last Name", "P", "A", "", "L", "M", "S", "",
  "RGI", "RGO", "RRI", "", "RRO", "V", "1-2-1", "", "TYFCB", "CEU", "T",
];

async function buildPalms(rows, { from = SERIAL, to = SERIAL } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.addRow(["Chapter Summary PALMS Report"]);
  ws.addRow(["Chapter:", "BNI Influencer"]);
  ws.addRow([]);
  ws.addRow(["From:", from]);
  ws.addRow(["To:", to]);
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow(HEADER);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// 3 members with attendance; pseudo rows must be ignored by the parser.
const membersV1 = [
  ["E2E", "Palm", 3, 0, "", 1, 0, 0, "", "", "", "", "", "", "", "", "", "", "", 0],
  ["E2E", "Palm Two", 0, 1, "", 0, 2, 0, "", "", "", "", "", "", "", "", "", "", "", 1],
  ["E2E", "Palm Zero", 0, 0, "", 0, 0, 0, "", "", "", "", "", "", "", "", "", "", "", 0],
  ["Visitors", "", 1, 0, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["BNI", "", 0, 1, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["Total", "", 4, 2, "", 1, 2, 0, "", "", "", "", "", "", "", "", "", "", "", 1],
];
const membersV2 = membersV1.map((r, i) =>
  i === 0 ? ["E2E", "Palm", 5, 0, "", 1, 0, 0, "", "", "", "", "", "", "", "", "", "", "", 0] : r,
);

// A slips-shaped workbook: no First Name header row.
async function buildSlipsLikeXls() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.addRow(["Slips Audit Report for 30/09/2026"]);
  ws.addRow(["From", "To", "Slip Type", "Inside/Outside", "TYFCB Amount", "CEU Credits", "Detail"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- db helpers -----------------------------------------------------------
async function weekIdNow() {
  const { data } = await sb.from("bni_weeks").select("id").eq("meeting_date", MEETING).maybeSingle();
  return data?.id ?? null;
}
async function attendanceRows(filter = {}) {
  let q = sb.from("member_attendance").select("*").eq("tenant_id", TENANT);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data } = await q;
  return data ?? [];
}
async function latestBatch(filename) {
  const { data } = await sb
    .from("import_batches")
    .select("id,filename,imported_count,skipped_count,status")
    .eq("tenant_id", TENANT)
    .eq("filename", filename)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// ---- baseline snapshot / restore -----------------------------------------
let weekId = null;
let baseline = [];
let baselineStats = [];

async function preClean() {
  await sb.from("member_attendance").delete().eq("tenant_id", TENANT).like("member_name", "E2E %");
  await sb.from("members").delete().eq("tenant_id", TENANT).like("name", "E2E %");
  // Stats were snapshotted before this call; the run replaces the week's rows
  // wholesale, so drop everything now and restore the snapshot in cleanup().
  await sb.from("palms_stats").delete().eq("tenant_id", TENANT);
  const { data: batches } = await sb
    .from("import_batches")
    .select("id")
    .eq("tenant_id", TENANT)
    .like("filename", "e2e-palms%");
  for (const b of batches ?? []) await sb.from("import_batches").delete().eq("id", b.id);
}

async function cleanup() {
  await sb.from("member_attendance").delete().eq("tenant_id", TENANT).like("member_name", "E2E %");
  const { data: batches } = await sb
    .from("import_batches")
    .select("id")
    .eq("tenant_id", TENANT)
    .like("filename", "e2e-palms%");
  for (const b of batches ?? []) await sb.from("import_batches").delete().eq("id", b.id);
  // The 10b slips fixture creates member rows; drop them with the rest.
  await sb.from("members").delete().eq("tenant_id", TENANT).like("name", "E2E %");
  // Restore the snapshotted attendance exactly (tests replace week rows).
  await sb.from("member_attendance").delete().eq("tenant_id", TENANT).eq("bni_week_id", weekId);
  if (baseline.length > 0) {
    const rows = baseline.map((r) => ({
      tenant_id: r.tenant_id,
      bni_week_id: r.bni_week_id,
      member_name: r.member_name,
      present: r.present,
      absent: r.absent,
      l: r.l,
      m: r.m,
      s: r.s,
      t: r.t,
      import_batch_id: r.import_batch_id,
    }));
    await sb.from("member_attendance").insert(rows);
  }
  // ...and the snapshotted PALMS comparison stats.
  await sb.from("palms_stats").delete().eq("tenant_id", TENANT);
  if (baselineStats.length > 0) {
    await sb.from("palms_stats").insert(
      baselineStats.map((s) => ({
        tenant_id: s.tenant_id,
        bni_week_id: s.bni_week_id,
        rgi: s.rgi,
        rgo: s.rgo,
        rri: s.rri,
        rro: s.rro,
        visitors: s.visitors,
        one_to_ones: s.one_to_ones,
        tyfcb: s.tyfcb,
        ceu: s.ceu,
        import_batch_id: s.import_batch_id,
      })),
    );
  }
}

// ---- run ------------------------------------------------------------------
try {
  // Snapshot BEFORE preClean (preClean drops the tenant's stats rows).
  const { data: statsBefore } = await sb.from("palms_stats").select("*").eq("tenant_id", TENANT);
  baselineStats = statsBefore ?? [];
  info(`baseline palms_stats rows: ${baselineStats.length}`);

  await preClean();
  weekId = await weekIdNow();
  check("week 40 exists (meeting 30 Sep 2026)", !!weekId, String(weekId));
  baseline = await attendanceRows({ bni_week_id: weekId });
  info(`baseline attendance rows for week: ${baseline.length}`);

  // 1) file-type guard
  let r = await postPalms("From,To,Slip Type\n", "e2e-palms.csv", "text/csv");
  let j = await r.json();
  check("csv rejected by extension guard", r.status === 400 && /xls/i.test(j.error ?? ""), `${r.status} ${j.error}`);

  // 2) slips-shaped xls is not a PALMS file
  r = await postPalms(await buildSlipsLikeXls(), "e2e-palms-slips.xls");
  j = await r.json();
  check("slips-shaped xls: 400 with header error", r.status === 400 && /First Name/i.test(j.error ?? ""), `${r.status} ${j.error}`);

  // 3) range report rejected
  r = await postPalms(await buildPalms(membersV1, { from: SERIAL, to: SERIAL + 7 }), "e2e-palms-range.xls");
  j = await r.json();
  check("range report (From != To): 400", r.status === 400 && /range/i.test(j.error ?? ""), `${r.status} ${j.error}`);

  // 4) unknown meeting date -> calendar-only error (slips are never required)
  r = await postPalms(await buildPalms(membersV1, { from: 46000, to: 46000 }), "e2e-palms-unknown.xls");
  j = await r.json();
  check("unknown meeting date: 400 names the calendar", r.status === 400 && /Wednesday calendar/i.test(j.error ?? ""), `${r.status} ${j.error}`);

  // 5) happy path
  r = await postPalms(await buildPalms(membersV1), "e2e-palms.xls");
  j = await r.json();
  check("import ok", r.ok && j.importedCount === 3, JSON.stringify(j));
  check("meeting date + week label returned", j.meetingDate === MEETING && !!j.weekLabel, JSON.stringify({ meetingDate: j.meetingDate, weekLabel: j.weekLabel }));
  check("replaces the rows that were already there", j.replacedCount === baseline.length, String(j.replacedCount));

  const rows1 = await attendanceRows({ bni_week_id: weekId });
  check("3 attendance rows in DB (pseudo rows skipped)", rows1.length === 3, `count=${rows1.length}`);
  const palm = rows1.find((x) => x.member_name === "E2E Palm");
  check("values stored per member", palm?.present === 3 && palm?.l === 1 && palm?.t === 0, JSON.stringify(palm));
  const weekScoped = rows1.every((x) => x.bni_week_id === weekId && x.tenant_id === TENANT);
  check("rows scoped to week + tenant", weekScoped, "");
  const otherTenant = await sb.from("member_attendance").select("id").neq("tenant_id", TENANT).limit(1);
  check("no rows outside the active tenant", (otherTenant.data ?? []).length === 0, String(otherTenant.error ?? ""));

  const batch = await latestBatch("e2e-palms.xls");
  check("import_batches history row recorded", !!batch && batch.imported_count === 3, JSON.stringify(batch));

  // 6) /summary page shows attendance + slip-derived columns + totals
  const html = await (await fetch(`${APP}/summary?week=${weekId}`, { headers: { ...AUTH } })).text();
  const dec = flight(html);
  check("/summary renders Chapter Summary h1", dec.includes('["Chapter Summary",["$","span"'));
  check("/summary lists the imported member with P=3", rowWin(dec, "E2E Palm", "P", "3"), dec.slice(Math.max(0, dec.indexOf('"E2E Palm"')), Math.max(0, dec.indexOf('"E2E Palm"')) + 300));
  check("/summary shows slip participant without attendance as –", dec.includes('"children":"–"'));
  check("/summary totals row present", dec.includes('"children":"Total"'));
  check("/summary hides the no-attendance hint after import", !html.includes("No PALMS attendance imported"));

  // 7) re-import replaces the week's rows (idempotent, no duplicates)
  r = await postPalms(await buildPalms(membersV2), "e2e-palms-v2.xls");
  j = await r.json();
  check("re-import ok", r.ok && j.importedCount === 3 && j.replacedCount === 3, JSON.stringify(j));
  const rows2 = await attendanceRows({ bni_week_id: weekId });
  const palm2 = rows2.find((x) => x.member_name === "E2E Palm");
  check("re-import replaced rows without duplicates", rows2.length === 3 && palm2?.present === 5, `count=${rows2.length} present=${palm2?.present}`);

  // 8) summary reflects the re-imported value
  const html2 = await (await fetch(`${APP}/summary?week=${weekId}`, { headers: { ...AUTH } })).text();
  check("/summary shows updated P=5", rowWin(flight(html2), "E2E Palm", "P", "5"));

  // 9) all-weeks scope renders too
  const html3 = await (await fetch(`${APP}/summary?week=all`, { headers: { ...AUTH } })).text();
  check("/summary week=all still renders", flight(html3).includes('["Chapter Summary"'));

  // 10) calendar week without slips (14 Oct, serial 46309): the import
  // SUCCEEDS and the response + both screens carry the red notice.
  r = await postPalms(await buildPalms(membersV1, { from: 46309, to: 46309 }), "e2e-palms-noslips.xls");
  j = await r.json();
  check(
    "calendar week without slips: import succeeds, comparison null",
    r.ok && j.importedCount === 3 && (j.comparison ?? null) === null,
    `${r.status} ${JSON.stringify(j).slice(0, 260)}`,
  );
  check("response warns that the slips file is missing", /^No slips imported for /.test(j.warning ?? ""), String(j.warning ?? ""));
  const { data: w42row } = await sb.from("bni_weeks").select("id").eq("meeting_date", "2026-10-14").maybeSingle();
  const w42 = w42row?.id ?? "";
  check("slipless calendar week (14 Oct 2026) resolved", !!w42, String(w42));
  const htmlN1 = await (await fetch(`${APP}/summary?week=${w42}`, { headers: { ...AUTH } })).text();
  const decN1 = flight(htmlN1);
  check(
    "/summary shows the red not-imported-yet box for the slips side",
    decN1.includes("Meeting data not imported yet in 1 meeting") && decN1.includes("Slips Audit Report not imported yet"),
    "",
  );
  const htmlN2 = await (await fetch(`${APP}/report?week=${w42}`, { headers: { ...AUTH } })).text();
  check("/report shows the same slips-not-imported notice", flight(htmlN2).includes("Slips Audit Report not imported yet"), "");
  const delW42 = await fetch(`${APP}/api/import/palms?week=${w42}`, { method: "DELETE", headers: { ...AUTH } });
  check("week 42 PALMS removed again (cleanup)", delW42.ok && (await attendanceRows({ bni_week_id: w42 })).length === 0, String(delW42.status));

  // 10b) the other order: slips first, no PALMS yet -> the slips import
  // succeeds with a warning and the screen flips to the PALMS-side notice.
  const slipsCsv =
    "Slips Audit Report for 14/10/2026\n" +
    "From,To,Slip Type,Inside/Outside,TYFCB Amount,CEU Credits,Detail\n" +
    "E2E Slip Person,E2E Slip Target,Referral,Tier 1,,,\n";
  r = await fetch(`${APP}/api/import/report`, {
    method: "POST",
    body: fd(slipsCsv, "e2e-palms-slips-w42.csv", "text/csv"),
    headers: { ...AUTH },
  });
  j = await r.json();
  check(
    "slips import without PALMS: 200 + warning",
    r.ok && /^No PALMS summary imported for /.test(j.warning ?? ""),
    `${r.status} ${JSON.stringify(j).slice(0, 240)}`,
  );
  const htmlN3 = await (await fetch(`${APP}/report?week=${w42}`, { headers: { ...AUTH } })).text();
  check("/report flips to the PALMS-not-imported notice", flight(htmlN3).includes("Chapter Summary PALMS not imported yet"), "");
  const slBatch = await latestBatch("e2e-palms-slips-w42.csv");
  const delSl = slBatch
    ? await fetch(`${APP}/api/import/batches/${slBatch.id}`, { method: "DELETE", headers: { ...AUTH } })
    : null;
  check("week 42 slips batch removed (cleanup)", !!delSl?.ok, `${delSl?.status ?? "no batch"}`);

  // 11) the real Chapter Summary file (77 members) -> palms_stats + verdict
  const real = readFileSync("C:\\Users\\HP\\Downloads\\Chapter_Summary_PALMS_Report_05-10-2026_10-57_PM.xls");
  r = await postPalms(real, "e2e-palms-real.xls");
  j = await r.json();
  check("real file imports 77 members", r.ok && j.importedCount === 77, `${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  check("real file: comparison verdict allMatch", !!j.comparison && j.comparison.allMatch === true, JSON.stringify(j.comparison));
  const { data: stats } = await sb
    .from("palms_stats")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("bni_week_id", weekId)
    .maybeSingle();
  check(
    "palms_stats stores the file's Total row",
    !!stats &&
      stats.rgi === 18 && stats.rgo === 36 && stats.rri === 26 && stats.rro === 38 &&
      stats.visitors === 11 && stats.one_to_ones === 73 && stats.tyfcb === 81441353 && stats.ceu === 87,
    JSON.stringify(stats),
  );

  // 12) /summary: success shows NO banner (warnings only), comparison table
  // sits at the bottom, and the loading skeleton ships with the page.
  const html4 = await (await fetch(`${APP}/summary?week=${weekId}`, { headers: { ...AUTH } })).text();
  const dec4 = flight(html4);
  check("/summary hides the success banner (warnings only)", !dec4.includes("PALMS matches slip data"), "");
  check("/summary comparison table shows TYFCB (en-IN grouping)", dec4.includes("8,14,41,353"), "");
  check("/summary comparison status cells say Match", dec4.includes('"children":"Match"') && !dec4.includes("MISMATCH"), "");
  check(
    "/summary comparison table renders after the member table (JSX order)",
    (() => {
      // The flight payload does not guarantee segment push order matches DOM
      // order (client components + lazy rows split it), so assert the render
      // order in the page source: member table (tfoot) first, comparison after.
      const summarySrc = readFileSync(new URL("../app/summary/page.tsx", import.meta.url), "utf8");
      const tfootAt = summarySrc.indexOf("<tfoot");
      const cmpAt = summarySrc.indexOf("<PalmsComparisonTable");
      return tfootAt > 0 && cmpAt > tfootAt;
    })(),
    "",
  );
  check("/summary no missing-file banner (history gap-free)", !dec4.includes("Missing slip file"), "");
  check("/summary ships its loading skeleton", dec4.includes('"skel"'), "");

  // 13) /report: success shows NO banner either, still no missing-file warning
  const html5 = await (await fetch(`${APP}/report?week=${weekId}`, { headers: { ...AUTH } })).text();
  const dec5 = flight(html5);
  check("/report hides the success banner (warnings only)", !dec5.includes("PALMS matches slip data"), "");
  check("/report no missing-file banner (history gap-free)", !dec5.includes("Missing slip file"), "");
  check("/report still ships its loading skeleton", dec5.includes('"skel"'), "");
  // Client-component subtrees are not serialized into flight (only their
  // props are), so assert the mount from the server page's JSX order —
  // same approach as the /summary comparison-table check below.
  const reportSrc = readFileSync(new URL("../app/report/page.tsx", import.meta.url), "utf8");
  const dwAt = reportSrc.indexOf("<DataWarnings");
  const impAt = reportSrc.indexOf("<ImportPanel");
  const cardsAt = reportSrc.indexOf('className="cards stat-cards"');
  check(
    "/report mounts the week-slips import panel (between DataWarnings and the stat cards), PALMS panel + toolbar button gone",
    dwAt > 0 && impAt > dwAt && cardsAt > impAt && !reportSrc.includes("<PalmsImportPanel") && !reportSrc.includes('variant="toolbar"'),
    `dw=${dwAt} slips=${impAt} cards=${cardsAt}`,
  );
  const panelSrc = readFileSync(new URL("../components/PalmsImportPanel.tsx", import.meta.url), "utf8");
  const fileAt = panelSrc.indexOf('type="file"');
  const importBtnAt = panelSrc.indexOf("onClick={() => picked && upload(picked)}");
  check(
    "PALMS panel is two-step: picking a file never uploads",
    fileAt > 0 &&
      importBtnAt > fileAt &&
      panelSrc.slice(fileAt, importBtnAt).includes("setPicked") &&
      !panelSrc.slice(fileAt, importBtnAt).includes("upload(") &&
      panelSrc.includes('disabled={!picked || state.kind === "busy"}'),
    `fileAt=${fileAt} btnAt=${importBtnAt}`,
  );
  // Collapse/expand: same import-toggle pattern as ImportPanel (body hidden
  // when collapsed, Remove action + dialog stay reachable from the head).
  check(
    "PALMS panel collapses via a − Minimize / + Import files toggle",
    panelSrc.includes('className="import-toggle"') &&
      panelSrc.includes("aria-expanded={open}") &&
      panelSrc.includes('useState(true)') &&
      panelSrc.includes('{open ? "− Minimize" : "+ Import files"}'),
    "",
  );
  const skelMirror = readFileSync(new URL("../components/Skeletons.tsx", import.meta.url), "utf8").includes(
    'PanelSkeleton title="Chapter Summary PALMS (attendance)" toggle="− Minimize"',
  );
  check("PALMS skeleton mirrors the toggle", skelMirror, "");
  const skelAll = readFileSync(new URL("../components/Skeletons.tsx", import.meta.url), "utf8");
  const repSkelAt = skelAll.indexOf("export function ReportSkeleton");
  const repSkelSlice = skelAll.slice(repSkelAt, skelAll.indexOf("function PanelSkeleton"));
  check(
    "/report skeleton mirrors the slips upload card (no PALMS panel)",
    repSkelSlice.includes('PanelSkeleton title="Import Report XLS"') && !repSkelSlice.includes("Chapter Summary PALMS"),
    "",
  );

  // 13b) /import ships the matching skeleton too
  const htmlImp = await (await fetch(`${APP}/import`, { headers: { ...AUTH } })).text();
  const decImp = flight(htmlImp);
  check("/import ships its loading skeleton", decImp.includes('"skel"'), "");
  check(
    "/import skeleton mirrors the two history tables",
    decImp.includes("Imported Slips Audit Reports") && decImp.includes("Imported Chapter Summary PALMS"),
    "",
  );
  const importPageSrc = readFileSync(new URL("../components/ImportPage.tsx", import.meta.url), "utf8");
  check(
    "ImportPage renders both history tables (no single 'Imported weeks' table)",
    importPageSrc.includes('title="Imported Slips Audit Reports"') &&
      importPageSrc.includes('title="Imported Chapter Summary PALMS"') &&
      !importPageSrc.includes("Imported weeks"),
    "",
  );

  // 14) a mismatching Total row flips the verdict
  const membersBad = membersV1.map((row, i) =>
    i === membersV1.length - 1
      ? row.map((v, c) => (c === 14 ? 99 : c === 17 ? 12345 : v)) // V=99, TYFCB=12345
      : row,
  );
  r = await postPalms(await buildPalms(membersBad), "e2e-palms-mismatch.xls");
  j = await r.json();
  check("mismatching import ok + verdict flags mismatch", r.ok && !!j.comparison && j.comparison.allMatch === false, JSON.stringify(j.comparison));
  check(
    "verdict rows name the V difference (PALMS 99 vs slips 11)",
    (j.comparison?.rows ?? []).some((x) => x.key === "visitors" && x.palms === 99 && x.slips === 11 && x.match === false),
    JSON.stringify(j.comparison?.rows),
  );

  // 15) both screens warn with week + metric + both values
  const html6 = await (await fetch(`${APP}/summary?week=${weekId}`, { headers: { ...AUTH } })).text();
  const dec6 = flight(html6);
  check("/summary shows mismatch banner", dec6.includes("PALMS vs slips mismatch in 1 week"), "");
  check("/summary names V: PALMS 99 vs slips 11", dec6.includes("V: PALMS 99 vs slips 11"), "");
  check("/summary names TYFCB: PALMS 12,345 vs slips 8,14,41,353", dec6.includes("TYFCB: PALMS 12,345 vs slips 8,14,41,353"), "");
  const html7 = await (await fetch(`${APP}/report?week=${weekId}`, { headers: { ...AUTH } })).text();
  const dec7 = flight(html7);
  check("/report shows mismatch banner too", dec7.includes("PALMS vs slips mismatch in 1 week"), "");
  check("/report names the V difference", dec7.includes("V: PALMS 99 vs slips 11"), "");

  // 16) re-import the real file so the mid-test mismatch is undone here too
  r = await postPalms(real, "e2e-palms-real-restore.xls");
  j = await r.json();
  check("re-import of the real file matches again", r.ok && !!j.comparison && j.comparison.allMatch === true, JSON.stringify(j.comparison));

  // 17) Chapter Summary export mirrors the screen: xlsx sheets/cells, json
  // payload for the in-browser PDF, server pdf, and the parameter guards.
  check("/summary ships the export switch (scopeLabel prop)", dec4.includes('"scopeLabel"'), "");
  const expUrl = `${APP}/api/summary/export?week=${weekId}`;
  const rx = await fetch(`${expUrl}&format=xlsx`, { headers: { ...AUTH } });
  check(
    "summary export xlsx 200 + attachment name",
    rx.ok && (rx.headers.get("Content-Disposition") ?? "").includes("chapter-summary-"),
    `${rx.status} ${rx.headers.get("Content-Disposition")}`,
  );
  const wbk = XLSX.read(Buffer.from(await rx.arrayBuffer()), { type: "buffer" });
  check(
    "xlsx has the Chapter Summary sheet only (comparison not exported)",
    wbk.SheetNames.length === 1 && wbk.SheetNames[0] === "Chapter Summary",
    wbk.SheetNames.join(","),
  );
  const aoa = XLSX.utils.sheet_to_json(wbk.Sheets["Chapter Summary"], { header: 1 });
  check(
    "xlsx header row = screen columns",
    JSON.stringify(aoa[2]) ===
      JSON.stringify(["Member", "P", "A", "L", "M", "S", "RGI", "RGO", "RRI", "RRO", "V", "1-2-1", "TYFCB", "CEU", "T"]),
    JSON.stringify(aoa[2]),
  );
  const totalX = aoa[aoa.length - 1];
  check(
    "xlsx keeps all member rows + Total row with en-IN TYFCB",
    aoa.length === 4 + 78 && totalX?.[0] === "Total" && totalX?.[1] === "60" && totalX?.[12] === "8,14,41,353",
    `rows=${aoa.length} total=${JSON.stringify(totalX)}`,
  );
  const rj = await fetch(`${expUrl}&format=json`, { headers: { ...AUTH } });
  const jexp = rj.ok ? await rj.json() : {};
  check(
    "json payload = member table only (78 rows, no comparison)",
    rj.ok &&
      jexp.headers?.[0] === "Member" &&
      jexp.totalRow?.[0] === "Total" &&
      jexp.memberCount === 78 &&
      jexp.rows?.length === 78 &&
      (jexp.comparison ?? null) === null,
    JSON.stringify({ s: rj.status, m: jexp.memberCount, rows: jexp.rows?.length, cmp: jexp.comparison ?? null }),
  );
  const rpdf = await fetch(`${expUrl}&format=pdf`, { headers: { ...AUTH } });
  const pbuf = Buffer.from(await rpdf.arrayBuffer());
  const ptxt = pbuf.toString("latin1");
  check(
    "pdf starts with %PDF + titles Chapter Summary",
    rpdf.ok && pbuf.slice(0, 5).toString() === "%PDF-" && ptxt.includes("Chapter Summary"),
    `${rpdf.status} ${pbuf.slice(0, 8).toString()}`,
  );
  check(
    "pdf carries the Total row and no comparison block",
    ptxt.includes("Total") && !ptxt.includes("PALMS vs slips") && !ptxt.includes("MISMATCH"),
    "",
  );
  const rNoWeek = await fetch(`${APP}/api/summary/export?format=xlsx`, { headers: { ...AUTH } });
  check("export without week is a 400", rNoWeek.status === 400, String(rNoWeek.status));
  const rBadFmt = await fetch(`${expUrl}&format=docx`, { headers: { ...AUTH } });
  check("export rejects unknown format", rBadFmt.status === 400, String(rBadFmt.status));
  const rNoAuth = await fetch(`${expUrl}&format=xlsx`);
  check("export requires auth (401)", rNoAuth.status === 401, String(rNoAuth.status));

  // 18) report export Summary mirrors the /report stat cards (Week 40 truth).
  const rRep = await fetch(`${APP}/api/report/export?week=${weekId}&tab=all&format=json`, { headers: { ...AUTH } });
  const rep = rRep.ok ? await rRep.json() : {};
  const bySec = Object.fromEntries((rep.summary?.rows ?? []).map((x) => [x.section, x]));
  check(
    "report export Summary mirrors the referral card (54 + RGI/RGO/RRI/RRO chips)",
    bySec.Referral?.count === 54 && bySec.Referral?.info === "RGI 18 · RGO 36 · RRI 26 · RRO 38",
    JSON.stringify(bySec.Referral),
  );
  check(
    "report export Summary mirrors the CEU card line",
    bySec.CEU?.count === 12 && bySec.CEU?.info === "12 Members · 87 CEU credits",
    JSON.stringify(bySec.CEU),
  );
  check(
    "report export Summary matches the other cards + screen badge total",
    bySec["One-to-One"]?.count === 73 &&
      bySec["One-to-One"]?.info === "121s" &&
      bySec.TYFCB?.count === 47 &&
      bySec.TYFCB?.info === "8,14,41,353 total" &&
      bySec.Visitor?.count === 11 &&
      rep.summary?.total === 220,
    JSON.stringify(rep.summary),
  );
  // 19) Remove PALMS from the Chapter Summary screen: the panel ships the
  // remove action + imported-file record for single-week scope, and the
  // endpoint drops attendance/stats + the referenced batch (slips stay).
  const html8 = await (await fetch(`${APP}/summary?week=${weekId}`, { headers: { ...AUTH } })).text();
  const dec8 = flight(html8);
  check(
    "/summary panel ships removeWeekId + record props",
    dec8.includes('"removeWeekId"') && dec8.includes('"record"'),
    "",
  );
  check("/summary panel names the imported PALMS file", dec8.includes("e2e-palms-real-restore.xls"), "");
  const rd = await fetch(`${APP}/api/import/palms?week=${weekId}`, { method: "DELETE", headers: { ...AUTH } });
  const rdj = rd.ok ? await rd.json() : {};
  check(
    "DELETE /api/import/palms removes the week's attendance",
    rd.ok && rdj.removed?.attendance === 77,
    JSON.stringify(rdj),
  );
  const attGone = await attendanceRows({ bni_week_id: weekId });
  const { data: statsGone } = await sb.from("palms_stats").select("*").eq("tenant_id", TENANT).eq("bni_week_id", weekId);
  check(
    "attendance + palms_stats gone after remove",
    attGone.length === 0 && (statsGone ?? []).length === 0,
    `att=${attGone.length} stats=${(statsGone ?? []).length}`,
  );
  check("referenced PALMS batch removed from history", !(await latestBatch("e2e-palms-real-restore.xls")), "");
  const htmlGone = await (await fetch(`${APP}/summary?week=${weekId}`, { headers: { ...AUTH } })).text();
  const decGone = flight(htmlGone);
  check(
    "/summary flags the removed PALMS summary as not imported yet",
    decGone.includes("Meeting data not imported yet in 1 meeting") && decGone.includes("Chapter Summary PALMS not imported yet"),
    "",
  );
  const rd404 = await fetch(`${APP}/api/import/palms?week=11111111-2222-3333-4444-555555555555`, {
    method: "DELETE",
    headers: { ...AUTH },
  });
  check("remove with no PALMS data is a 404", rd404.status === 404, String(rd404.status));
  const rdNoWeek = await fetch(`${APP}/api/import/palms`, { method: "DELETE", headers: { ...AUTH } });
  check("remove without week is a 400", rdNoWeek.status === 400, String(rdNoWeek.status));
  const rdNoAuth = await fetch(`${APP}/api/import/palms?week=${weekId}`, { method: "DELETE" });
  check("remove requires auth (401)", rdNoAuth.status === 401, String(rdNoAuth.status));

  // restore, then the ImportPage path: a PALMS batch deleted by batch id
  // must drop its attendance + stats + the batch row in one call.
  r = await postPalms(real, "e2e-palms-real-restore.xls");
  j = await r.json();
  check(
    "re-import restores the week after removal",
    r.ok && !!j.comparison && j.comparison.allMatch === true && (await attendanceRows({ bni_week_id: weekId })).length === 77,
    JSON.stringify(j.comparison),
  );
  const pb = await latestBatch("e2e-palms-real-restore.xls");
  const dPalms = pb
    ? await fetch(`${APP}/api/import/batches/${pb.id}`, { method: "DELETE", headers: { ...AUTH } })
    : null;
  const dPalmsJ = dPalms?.ok ? await dPalms.json() : {};
  check(
    "DELETE import removes a PALMS batch's attendance + stats",
    dPalms?.ok && dPalmsJ.removed?.member_attendance === 77 && dPalmsJ.removed?.palms_stats === 1,
    JSON.stringify(dPalmsJ),
  );
  check("attendance gone via batch delete too", (await attendanceRows({ bni_week_id: weekId })).length === 0, "");

  // final restore so the finally-block baseline checks stay green
  r = await postPalms(real, "e2e-palms-real-restore.xls");
  j = await r.json();
  check(
    "final re-import leaves the baseline intact",
    r.ok && !!j.comparison && j.comparison.allMatch === true && (await attendanceRows({ bni_week_id: weekId })).length === 77,
    JSON.stringify(j.comparison),
  );
  // ...and with both files in place, no screen shows a not-imported-yet box.
  const htmlEnd = await (await fetch(`${APP}/summary?week=${weekId}`, { headers: { ...AUTH } })).text();
  const htmlEndR = await (await fetch(`${APP}/report?week=${weekId}`, { headers: { ...AUTH } })).text();
  check(
    "no not-imported-yet notice once both files are imported",
    !flight(htmlEnd).includes("not imported yet") && !flight(htmlEndR).includes("not imported yet"),
    "",
  );
} finally {
  await cleanup();
  const after = weekId ? await attendanceRows({ bni_week_id: weekId }) : [];
  check("baseline attendance restored", after.length === baseline.length, `now=${after.length} base=${baseline.length}`);
  const { data: statsAfter } = await sb.from("palms_stats").select("*").eq("tenant_id", TENANT);
  check(
    "baseline palms_stats restored",
    (statsAfter ?? []).length === baselineStats.length,
    `now=${(statsAfter ?? []).length} base=${baselineStats.length}`,
  );
}

function info(msg) {
  results.push(`INFO  ${msg}`);
}

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
