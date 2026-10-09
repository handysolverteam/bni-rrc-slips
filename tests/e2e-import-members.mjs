// E2E: import requirements — new members are added to `members` with the
// correct chapter, duplicates are kept, only typing mistakes pause, and the
// list/report/export screens reflect the import immediately.
//
// Run:  node tests/e2e-import-members.mjs   (from the repo root)
// Self-cleaning: removes every row it creates, then re-checks the baseline.
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";

const APP = "http://localhost:3000";
const ENV = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const kv = (k) => ENV.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1);
const sb = createClient(kv("NEXT_PUBLIC_SUPABASE_URL"), kv("SUPABASE_SERVICE_ROLE_KEY"));
const HOME = "BNI Influencers"; // the default tenant's own name (the .env chapter name is no longer used)
const TEST_CHAPTER = "BNI Test Chapter";
const IGNORE_CHAPTER = "BNI Ignore Chapter"; // detail on non-bold rows — must never be created
const MEETING = "2026-09-30"; // existing week 40
const TITLE = "Slips Audit Report for 30/09/2026\n";
const HEAD = "From,To,Slip Type,Inside/Outside,TYFCB Amount,CEU Credits,Detail\n";
// Multi-tenant: every API/page call authenticates as a server-to-server
// caller (service-role bearer) against the default tenant, and every DB
// ground-truth query is scoped to it.
const TENANT = "d1000000-0000-4000-8000-000000000001";
const AUTH = { Authorization: `Bearer ${kv("SUPABASE_SERVICE_ROLE_KEY")}` };

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
const info = (msg) => results.push(`INFO  ${msg}`);

// ---- fixtures -------------------------------------------------------------
// CSV (no bold possible): everything non-bold files HOME, duplicates kept,
// the number-in-name row is the only skip.
const seedCsv =
  TITLE + HEAD +
  `E2E Seed Person,E2E Seed Guest,Referral,Tier 1,,,${IGNORE_CHAPTER}\n` +
  "E2E Home Person,,CEU,,,4,\n" +
  "E2E Home Person,,CEU,,,4,\n" + // exact duplicate CEU — must import twice
  "E2E Visitor Host,E2E Visitor Guest,Visitor,,,,\n" +
  `E2E TYFCB Host,E2E TYFCB Recipient,TYFCB,,5000,,${IGNORE_CHAPTER}\n` +
  "E2E Dup Row,E2E Dup Target,Referral,Tier 1,,,\n" +
  "E2E Dup Row,E2E Dup Target,Referral,Tier 1,,,\n" +
  "3,E2E Typo Target,Referral,Tier 1,,,\n"; // typing mistake -> skip

// XLSX with real bold cells: bold name -> Detail chapter, CEU bold stays HOME,
// existing HOME member gains a second (name, chapter) row — never moved.
async function buildBoldXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.addRow(["Slips Audit Report for 30/09/2026"]);
  ws.addRow([]);
  ws.addRow(["From", "To", "Slip Type", "Inside/Outside", "TYFCB Amount", "CEU Credits", "Detail"]);
  const a = ws.addRow([`E2E Bold Person`, "E2E Home Person", "Referral", "Tier 1", "", "", TEST_CHAPTER]);
  a.getCell(1).font = { bold: true };
  const b = ws.addRow(["E2E Seed Person", "E2E Seed Guest", "Referral", "Tier 1", "", "", TEST_CHAPTER]);
  b.getCell(1).font = { bold: true };
  const c = ws.addRow(["E2E CEU Person", "", "CEU", "", "", "3", TEST_CHAPTER]);
  c.getCell(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const fd = (content, name, type = "text/csv") => {
  const f = new FormData();
  f.append("file", new File([content], name, { type }));
  return f;
};
const post = (path, form) => fetch(`${APP}${path}`, { method: "POST", body: form, headers: { ...AUTH } });

// ---- db helpers -----------------------------------------------------------
async function count(table, filter) {
  let q = sb.from(table).select("id", { count: "exact" }).eq("tenant_id", TENANT).limit(1);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { count: c } = await q;
  return c ?? 0;
}
async function weekIdNow() {
  const { data } = await sb.from("bni_weeks").select("id").eq("meeting_date", MEETING).maybeSingle();
  return data?.id ?? null;
}
// Section counts exactly as the report summary computes them (121s weighted).
async function dbSummary(weekId) {
  const num = async (table) => count(table, { bni_week_id: weekId });
  const [ref, tyfcb, vis, ceu] = await Promise.all([
    num("slip_referrals"), num("slip_tyfcb"), num("slip_visitors"), num("slip_ceus"),
  ]);
  const { data: otos } = await sb
    .from("slip_one_to_ones")
    .select("initiated_by_is_other_chapter,met_with_is_other_chapter")
    .eq("tenant_id", TENANT)
    .eq("bni_week_id", weekId);
  const otoWeighted = (otos ?? []).reduce(
    (n, r) => n + (r.initiated_by_is_other_chapter === true || r.met_with_is_other_chapter === true ? 1 : 2),
    0,
  );
  // The export Summary row for Referral mirrors the stat card: the GIVEN
  // count only (From side home = not bold), not the raw row count.
  const { data: refRows } = await sb
    .from("slip_referrals")
    .select("from_is_other_chapter")
    .eq("tenant_id", TENANT)
    .eq("bni_week_id", weekId);
  const refGiven = (refRows ?? []).filter((r) => r.from_is_other_chapter !== true).length;
  return { otoWeighted, ref, refGiven, tyfcb, vis, ceu, total: otoWeighted + ref + tyfcb + vis + ceu };
}
async function exportSummary(weekId) {
  const r = await fetch(`${APP}/api/report/export?week=${weekId}&tab=all&format=json`, { headers: { ...AUTH } });
  const j = await r.json();
  return j.summary;
}
async function membersNamed(names) {
  const { data } = await sb.from("members").select("id,name,chapter_id").eq("tenant_id", TENANT).in("name", names);
  return data ?? [];
}
async function chapterIdByName(name) {
  const { data } = await sb.from("chapters").select("id").eq("tenant_id", TENANT).ilike("name", name).maybeSingle();
  return data?.id ?? null;
}
async function batchId(filename) {
  const { data } = await sb
    .from("import_batches").select("id").eq("tenant_id", TENANT).eq("filename", filename)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? null;
}

// ---- 0) pre-clean leftovers + capture baseline ----------------------------
async function preClean() {
  const { data: oldBatches } = await sb
    .from("import_batches").select("id,filename").eq("tenant_id", TENANT).or("filename.eq.e2e-seed.csv,filename.eq.e2e-bold.xlsx,filename.eq.e2e-delete.csv,filename.eq.e2e-reimport.csv");
  for (const b of oldBatches ?? []) {
    for (const t of ["slip_referrals", "slip_one_to_ones", "slip_tyfcb", "slip_visitors", "slip_ceus"]) {
      await sb.from(t).delete().eq("import_batch_id", b.id);
    }
    await sb.from("import_batches").delete().eq("id", b.id);
  }
  await sb.from("members").delete().eq("tenant_id", TENANT).like("name", "E2E %");
  const tc = await chapterIdByName(TEST_CHAPTER);
  if (tc) await sb.from("chapters").delete().eq("id", tc);
}
async function cleanup() {
  const { data: batches } = await sb
    .from("import_batches").select("id,filename").eq("tenant_id", TENANT).or("filename.eq.e2e-seed.csv,filename.eq.e2e-bold.xlsx,filename.eq.e2e-delete.csv,filename.eq.e2e-reimport.csv");
  for (const b of batches ?? []) {
    for (const t of ["slip_referrals", "slip_one_to_ones", "slip_tyfcb", "slip_visitors", "slip_ceus"]) {
      await sb.from(t).delete().eq("import_batch_id", b.id);
    }
    await sb.from("import_batches").delete().eq("id", b.id);
  }
  await sb.from("members").delete().eq("tenant_id", TENANT).like("name", "E2E %");
  const tc = await chapterIdByName(TEST_CHAPTER);
  if (tc) await sb.from("chapters").delete().eq("id", tc);
}

await preClean();
const weekId = await weekIdNow();
check("week 40 exists (meeting 30 Sep 2026)", !!weekId, String(weekId));
const base = await dbSummary(weekId);
const baseMembers = await count("members", {});
const baseExport = await exportSummary(weekId);
check(
  // Baseline may grow with real imports; it must never shrink below the
  // known floor and the export summary must match the DB exactly.
  "baseline is the known good state",
  base.total >= 213 && baseExport.total === base.total,
  `db=${base.total} export=${baseExport?.total} members=${baseMembers}`,
);

// ---- 1) preview: pause only for typing mistakes ---------------------------
let r = await post("/api/import/preview", fd(seedCsv, "e2e-seed.csv"));
let p = await r.json();
check("preview seed: week exists", p.weekExists === true && p.weekId === weekId, `${p.weekLabel} exists=${p.weekExists}`);
check("preview seed: exactly 1 typing-mistake skip", p.rowIssues?.skippedCount === 1, JSON.stringify(p.rowIssues));
check("preview seed: bold not used", p.boldUsed === false);

const boldBuf = await buildBoldXlsx();
r = await post("/api/import/preview", fd(boldBuf, "e2e-bold.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
p = await r.json();
check("preview bold xlsx parses with bold flags", p.boldUsed === true, `skips=${p.rowIssues?.skippedCount}`);
check("preview bold xlsx: 0 skips", p.rowIssues?.skippedCount === 0, JSON.stringify(p.rowIssues));

// ---- 2) import CSV: members created under HOME ----------------------------
r = await post("/api/import/report", fd(seedCsv, "e2e-seed.csv"));
let imp = await r.json();
check("seed import ok", r.ok && (imp.importedCount === 7 || imp.importedCount === 6), JSON.stringify({ imported: imp.importedCount, skipped: imp.skippedCount, errors: imp.errors }));
check("seed import skipped only the typing mistake", imp.skippedCount === 1 || imp.skippedCount === 2, String(imp.skippedCount));
check("skip reason names the number-in-name row", (imp.errors ?? []).some((e) => e.includes("number instead of a name")), JSON.stringify(imp.errors));

const homeId = await chapterIdByName(HOME);
const seedNames = ["E2E Seed Person", "E2E Seed Guest", "E2E Home Person", "E2E Visitor Host", "E2E Dup Row", "E2E Dup Target"];
const seedRows = await membersNamed([...seedNames, "E2E Visitor Guest", "E2E TYFCB Host", "E2E TYFCB Recipient", "E2E Typo Target"]);
check("all 6 expected members created", seedNames.every((n) => seedRows.some((m) => m.name === n)) && seedRows.filter((m) => seedNames.includes(m.name)).length === 6, seedRows.map((m) => m.name).join(", "));
check("every new member is in HOME chapter", seedRows.filter((m) => seedNames.includes(m.name)).every((m) => m.chapter_id === homeId), `home=${homeId}`);
for (const no of ["E2E Visitor Guest", "E2E TYFCB Host", "E2E TYFCB Recipient", "E2E Typo Target"]) {
  check(`${no} is NOT a member`, !seedRows.some((m) => m.name === no));
}
const ignoreId = await chapterIdByName(IGNORE_CHAPTER);
check("detail on non-bold rows never creates a chapter", !ignoreId, String(ignoreId));

const ceuRows = await sb.from("slip_ceus").select("id,member_id").eq("tenant_id", TENANT).eq("member_name", "E2E Home Person");
check("duplicate CEU rows both imported", (ceuRows.data ?? []).length === 2, `count=${(ceuRows.data ?? []).length}`);
check("CEU rows linked to the member", (ceuRows.data ?? []).every((x) => !!x.member_id));

const refDup = await count("slip_referrals", { from_name: "E2E Dup Row", to_name: "E2E Dup Target" });
check("duplicate referrals attempted (>=1)", refDup >= 1, `count=${refDup}`);
if (refDup === 1) info("referral duplicate rejected by DB — migration 003_allow_duplicate_slips.sql still pending (message recorded on the batch)");
else if (refDup === 2) info("both duplicate referrals imported — migration 003 already applied");

const refSeed = await sb.from("slip_referrals").select("from_member_id,to_member_id").eq("tenant_id", TENANT).eq("from_name", "E2E Seed Person").eq("to_name", "E2E Seed Guest").limit(1).maybeSingle();
check("referral linked to member ids", !!refSeed.data?.from_member_id && !!refSeed.data?.to_member_id);
const visRow = await sb.from("slip_visitors").select("invited_by_member_id").eq("tenant_id", TENANT).eq("full_name", "E2E Visitor Guest").limit(1).maybeSingle();
check("visitor inviter linked, guest unlinked", !!visRow.data?.invited_by_member_id);
const tyfcbRow = await sb.from("slip_tyfcb").select("member_id").eq("tenant_id", TENANT).eq("member_name", "E2E TYFCB Recipient").limit(1).maybeSingle();
check("TYFCB thanked member not linked/filed", tyfcbRow.data?.member_id == null, String(tyfcbRow.data?.member_id));

// ---- 3) import bold XLSX: detail chapter + multi-chapter rows -------------
r = await post("/api/import/report", fd(boldBuf, "e2e-bold.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
imp = await r.json();
check("bold import ok (3 rows)", r.ok && imp.importedCount === 3 && imp.skippedCount === 0, JSON.stringify({ imported: imp.importedCount, skipped: imp.skippedCount, errors: imp.errors }));

const testChapterId = await chapterIdByName(TEST_CHAPTER);
check("missing Detail chapter auto-created", !!testChapterId, String(testChapterId));

const boldNames = ["E2E Bold Person", "E2E Seed Person", "E2E CEU Person"];
const allRows = await membersNamed([...boldNames, "E2E Seed Guest"]);
const boldPerson = allRows.filter((m) => m.name === "E2E Bold Person");
check("bold name filed under Detail chapter", boldPerson.length === 1 && boldPerson[0].chapter_id === testChapterId, `rows=${boldPerson.length}`);
const seedPerson = allRows.filter((m) => m.name === "E2E Seed Person");
check(
  "same name now has 2 rows (HOME + Detail), home row untouched",
  seedPerson.length === 2 && seedPerson.some((m) => m.chapter_id === homeId) && seedPerson.some((m) => m.chapter_id === testChapterId),
  `rows=${seedPerson.length} chapters=${seedPerson.map((m) => m.chapter_id).join(",")}`,
);
const ceuPerson = allRows.filter((m) => m.name === "E2E CEU Person");
check("bold CEU attendee still filed HOME", ceuPerson.length === 1 && ceuPerson[0].chapter_id === homeId, `rows=${ceuPerson.length}`);
const ceuBoldRow = await sb.from("slip_ceus").select("member_id").eq("tenant_id", TENANT).eq("member_name", "E2E CEU Person").limit(1).maybeSingle();
check("bold CEU slip linked to its HOME member row", !!ceuBoldRow.data?.member_id);

// ---- 4) today's screens reflect the import (caches cleared on import) ----
const filtered = await (await fetch(`${APP}/members?c_chapter=${encodeURIComponent(TEST_CHAPTER)}`, { headers: { ...AUTH } })).text();
// Rows serialize as \"name\":\"...\"; the Name column's filter options are a bare
// string array of ALL member names, so only the row-key form proves the filter.
const q = String.fromCharCode(34), bs = String.fromCharCode(92);
const rowIn = (html, name) => html.includes(bs + q + "name" + bs + q + ":" + bs + q + name + bs + q);
check(
  "members screen filters the new chapter",
  rowIn(filtered, "E2E Bold Person") && rowIn(filtered, "E2E Seed Person") && !rowIn(filtered, "E2E Home Person"),
  "chapter-filtered SSR rows",
);
check(
  "members subtitle counts follow the chapter filter (2 active · 0 inactive)",
  filtered.includes("2 active · 0 inactive"),
  "filtered subtitle",
);
const memberPage = await (await fetch(`${APP}/members`, { headers: { ...AUTH } })).text();
check("Chapter column filter offers the new chapter", memberPage.includes(TEST_CHAPTER), "distinct options refreshed");

const dbNow = await dbSummary(weekId);
const expNow = await exportSummary(weekId);
check(
  "export summary matches DB after import",
  expNow && expNow.total === dbNow.total &&
    JSON.stringify(expNow.rows.map((x) => x.count)) === JSON.stringify([dbNow.otoWeighted, dbNow.refGiven, dbNow.tyfcb, dbNow.vis, dbNow.ceu]),
  `export=${JSON.stringify(expNow?.rows)} total=${expNow?.total} db=${JSON.stringify(dbNow)}`,
);
check(
  "export summary rows mirror the stat cards (referral chips + CEU member line)",
  !!expNow &&
    expNow.rows[1].info.startsWith("RGI ") &&
    expNow.rows[4].info.includes("Member") &&
    expNow.rows[4].info.includes("credits"),
  JSON.stringify([expNow?.rows[1], expNow?.rows[4]]),
);
check("summary grew by the imported slips", dbNow.total > base.total, `${base.total} -> ${dbNow.total}`);

// ---- 4b) PDF export: section title once + styled table header only --------
// The section's plain-text column-header row was removed (the styled header
// repeats on every page) — "Invited By" must appear exactly once.
const pdfRes = await fetch(
  `${APP}/api/report/export?week=${weekId}&tab=visitor&format=pdf`,
  { headers: { ...AUTH } },
);
const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
const pdfText = pdfBuf.toString("latin1");
const invitedBy = pdfText.split("Invited By").length - 1;
// jsPDF escapes the parens of the title row: "Visitor \(12\)".
const titleKept = pdfText.includes("Visitor \\(");
check(
  "pdf: section title kept, no duplicated text header row",
  pdfRes.ok && titleKept && invitedBy === 1,
  `status=${pdfRes.status} title=${titleKept} invitedBy=${invitedBy} bytes=${pdfBuf.length}`,
);

// ---- 4c) DELETE /api/import/batches/{id} removes the batch + its rows -----
const delCsv =
  TITLE + HEAD + "E2E Delete Person,E2E Delete Guest,Referral,Tier 1,,,\n" + "E2E Delete Person,,CEU,,,2,\n";
const delImp = await post("/api/import/report", fd(delCsv, "e2e-delete.csv", "text/csv"));
const delJson = await delImp.json().catch(() => ({}));
check(
  "delete-fixture import ok (2 rows)",
  delImp.ok && delJson.importedCount === 2,
  JSON.stringify({ s: delImp.status, i: delJson.importedCount, k: delJson.skippedCount }),
);
const delBatch = await batchId("e2e-delete.csv");
check("delete-fixture batch in history", !!delBatch, String(delBatch));
if (delBatch) {
  const rowsBefore =
    (await count("slip_referrals", { import_batch_id: delBatch })) +
    (await count("slip_ceus", { import_batch_id: delBatch }));
  const d1 = await fetch(`${APP}/api/import/batches/${delBatch}`, { method: "DELETE", headers: { ...AUTH } });
  const d1j = await d1.json().catch(() => ({}));
  check(
    "DELETE import returns ok + per-table removed counts",
    d1.ok && d1j.ok === true && d1j.removed?.slip_referrals === 1 && d1j.removed?.slip_ceus === 1,
    JSON.stringify(d1j),
  );
  const rowsAfter =
    (await count("slip_referrals", { import_batch_id: delBatch })) +
    (await count("slip_ceus", { import_batch_id: delBatch }));
  check("import rows are gone", rowsBefore === 2 && rowsAfter === 0, `${rowsBefore} -> ${rowsAfter}`);
  check("batch removed from history", !(await batchId("e2e-delete.csv")), "");
  const d2 = await fetch(`${APP}/api/import/batches/${delBatch}`, { method: "DELETE", headers: { ...AUTH } });
  check("second delete of the same import is a 404", d2.status === 404, String(d2.status));
}
const dUnknown = await fetch(`${APP}/api/import/batches/11111111-2222-3333-4444-555555555555`, {
  method: "DELETE",
  headers: { ...AUTH },
});
check("delete of an unknown id is a 404", dUnknown.status === 404, String(dUnknown.status));
const dNoAuth = await fetch(`${APP}/api/import/batches/${delBatch ?? "11111111-2222-3333-4444-555555555555"}`, {
  method: "DELETE",
});
check("delete requires auth (401)", dNoAuth.status === 401, String(dNoAuth.status));

// ---- 4d) history kinds (slips vs PALMS) + xlsx prints bold names bold ------
// The history must carry BOTH kinds. Other suites clean up after themselves,
// so this test seeds — and then removes — its own PALMS batch (week 40 =
// 30 Sep 2026, already on the calendar).
const HIST_PALMS_FILE = "e2e-hist-palms.xls";
async function removeBatchesNamed(filename) {
  const { data } = await sb
    .from("import_batches").select("id").eq("tenant_id", TENANT).eq("filename", filename);
  for (const b of data ?? []) {
    const r = await fetch(`${APP}/api/import/batches/${b.id}`, { method: "DELETE", headers: { ...AUTH } });
    check(`cleanup: leftover ${filename} removed`, r.ok, String(r.status));
  }
}
await removeBatchesNamed(HIST_PALMS_FILE); // crashed-run leftovers
async function buildHistPalmsXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  const serial = (iso) =>
    Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse("1899-12-30T00:00:00Z")) / 86400000);
  ws.addRow(["PALMS Attendance Report"]);
  ws.addRow(["Chapter:", "BNI Influencers"]);
  ws.addRow(["Parameters"]);
  ws.addRow(["From:", serial("2026-09-01")]);
  ws.addRow(["To:", serial("2026-09-30")]);
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow(["First Name", "Last Name", "", "Sep 30"]);
  ws.addRow(["E2E", "Hist", "", "P"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const hSeed = await post("/api/import/palms", fd(await buildHistPalmsXlsx(), HIST_PALMS_FILE, "application/vnd.ms-excel"));
const hSeedJson = hSeed.ok ? await hSeed.json() : {};
check(
  "PALMS history seed import",
  hSeed.ok && hSeedJson.importedCount === 1 && hSeedJson.skippedCount === 0,
  JSON.stringify({ s: hSeed.status, j: hSeedJson }),
);
const hist = await fetch(`${APP}/api/import/batches`, { headers: { ...AUTH } });
const histJson = hist.ok ? await hist.json() : {};
const histList = Array.isArray(histJson.batches) ? histJson.batches : [];
check(
  "history GET tags every batch with kind slips|palms",
  hist.ok && histList.length > 0 && histList.every((b) => b.kind === "slips" || b.kind === "palms"),
  `n=${histList.length} s=${histJson.error ?? ""}`,
);
check(
  "history mixes slips and PALMS batches",
  histList.some((b) => b.kind === "slips") && histList.some((b) => b.kind === "palms"),
  histList.slice(0, 12).map((b) => `${b.kind}:${b.filename}`).join(" | "),
);
await removeBatchesNamed(HIST_PALMS_FILE); // the seed's own batch (drops its attendance rows too)

// ---- 4e) re-import of the same file skips every already-imported row ------
// The seed file's 7 data rows now exist for this week (plus the 1 typing
// mistake that is always skipped): a re-import must insert 0 and report the
// duplicates + the mistake as 8 skips — in both migration-003 states.
const dbBefore = await dbSummary(weekId);
// The preview already tells what the re-import will skip: all 7 valid rows
// are in the DB, none are new (the typing mistake is a bad row, not a dup).
const pvDup = await (await post("/api/import/preview", fd(seedCsv, "e2e-preview-dup.csv"))).json();
check(
  "preview of an imported file: 7 duplicates, 0 new",
  pvDup.duplicateCount === 7 && pvDup.newCount === 0,
  JSON.stringify({ dup: pvDup.duplicateCount, new: pvDup.newCount }),
);
const rp = await post("/api/import/report", fd(seedCsv, "e2e-reimport.csv"));
const rpJson = rp.ok ? await rp.json() : {};
check(
  "re-import: 0 rows imported (all already in for this week)",
  rp.ok && rpJson.importedCount === 0,
  JSON.stringify({ s: rp.status, i: rpJson.importedCount, k: rpJson.skippedCount, errors: rpJson.errors }),
);
check(
  "re-import: skipped = 7 duplicates + 1 typing mistake = 8",
  rpJson.skippedCount === 8,
  String(rpJson.skippedCount),
);
check(
  "re-import: error line names the duplicate skip",
  (rpJson.errors ?? []).some((e) => e.includes("duplicate")),
  JSON.stringify(rpJson.errors),
);
check(
  "re-import: slip summary unchanged",
  (await dbSummary(weekId)).total === dbBefore.total,
  `=${dbBefore.total}`,
);
const dupBatch = await batchId("e2e-reimport.csv");
if (dupBatch) {
  const d = await fetch(`${APP}/api/import/batches/${dupBatch}`, { method: "DELETE", headers: { ...AUTH } });
  const dj = await d.json().catch(() => ({}));
  check(
    "DELETE works for an all-skipped (0 imported) batch",
    d.ok && dj.ok === true,
    `${d.status} ${JSON.stringify(dj)}`,
  );
}

const rxB = await fetch(`${APP}/api/report/export?week=${weekId}&tab=referral&format=xlsx`, { headers: { ...AUTH } });
const xbBuf = Buffer.from(await rxB.arrayBuffer());
check("referral xlsx export 200 + bytes", rxB.ok && xbBuf.length > 500, `${rxB.status} len=${xbBuf.length}`);
const xbw = new ExcelJS.Workbook();
await xbw.xlsx.load(xbBuf);
const xsh = xbw.getWorksheet("Referral");
const boldCells = [];
if (xsh) {
  const hdr = xsh.getRow(3);
  const fromToCols = [];
  hdr.eachCell((c, n) => {
    if (c.value === "Referral From" || c.value === "Referral To") fromToCols.push(n);
  });
  xsh.eachRow((row, rn) => {
    if (rn <= 3) return;
    for (const n of fromToCols) {
      const cell = row.getCell(n);
      if (cell.font?.bold && cell.value) boldCells.push(String(cell.value));
    }
  });
}
check(
  "xlsx export prints the bold (other-chapter) name bold",
  !!xsh && boldCells.includes("E2E Bold Person"),
  `sheet=${!!xsh} bold=${JSON.stringify(boldCells)}`,
);

const rjR = await fetch(`${APP}/api/report/export?week=${weekId}&tab=referral&format=json`, { headers: { ...AUTH } });
const jR = rjR.ok ? await rjR.json() : {};
check(
  "report json carries column keys (client PDF bold)",
  Array.isArray(jR.sections?.[0]?.keys) &&
    jR.sections[0].keys.includes("from") &&
    jR.sections[0].keys.includes("to"),
  JSON.stringify(jR.sections?.[0]?.keys),
);

// ---- 5) cleanup + baseline restored ---------------------------------------
await cleanup();
const after = await dbSummary(weekId);
const afterMembers = await count("members", {});
const afterExport = await exportSummary(weekId);
check(
  "cleanup restores slip counts + member count",
  after.total === base.total && afterMembers === baseMembers,
  `slips ${after.total}/${base.total} members ${afterMembers}/${baseMembers}`,
);
check("export summary back to baseline", afterExport?.total === base.total, String(afterExport?.total));
check("test chapter removed", !(await chapterIdByName(TEST_CHAPTER)));

// ---- 6) home chapter rules for OTHER tenants (env never applies) ----------
// Blank-Detail members file to the tenant's home_chapter_name when set,
// else the tenant's own name; NEXT_PUBLIC_CHAPTER_NAME is default-tenant only.
{
  const T1 = "e2000000-0000-4000-8000-00000000001a"; // home_chapter_name configured
  const T2 = "e2000000-0000-4000-8000-00000000002b"; // no home_chapter_name
  const T1_NAME = "E2E Configured Tenant";
  const T2_NAME = "E2E Named Tenant";
  const CONFIGURED_HOME = "E2E Configured Home";
  const homeCsv =
    TITLE + HEAD +
    "E2E T1 Person,,CEU,,,3,\n" +
    "E2E T2 Person,,CEU,,,3,\n";
  const homeFd = (content) => {
    const f = new FormData();
    f.append("file", new File([content], "e2e-home.csv", { type: "text/csv" }));
    return f;
  };
  const postTo = (tenant, form) =>
    fetch(`${APP}/api/import/report`, { method: "POST", body: form, headers: { ...AUTH, "x-tenant-id": tenant } });

  async function memberChapterName(tenant, name) {
    const { data } = await sb
      .from("members")
      .select("chapters(name)")
      .eq("tenant_id", tenant)
      .eq("name", name)
      .maybeSingle();
    const rel = data?.chapters;
    return (Array.isArray(rel) ? rel[0] : rel)?.name ?? null;
  }
  async function wipeTenant(tenant) {
    const { data: batches } = await sb.from("import_batches").select("id").eq("tenant_id", tenant);
    for (const b of batches ?? []) {
      for (const t of ["slip_referrals", "slip_one_to_ones", "slip_tyfcb", "slip_visitors", "slip_ceus"]) {
        await sb.from(t).delete().eq("import_batch_id", b.id);
      }
    }
    await sb.from("import_batches").delete().eq("tenant_id", tenant);
    await sb.from("members").delete().eq("tenant_id", tenant);
    await sb.from("chapters").delete().eq("tenant_id", tenant);
    await sb.from("tenants").delete().eq("id", tenant);
  }

  // Idempotent re-runs: drop leftovers from a previous run first.
  await wipeTenant(T1);
  await wipeTenant(T2);
  const t1 = await sb.from("tenants").insert({ id: T1, name: T1_NAME, home_chapter_name: CONFIGURED_HOME }).select("id").single();
  const t2 = await sb.from("tenants").insert({ id: T2, name: T2_NAME, home_chapter_name: null }).select("id").single();
  if (t1.error || t2.error) {
    check("home-rule tenants created", false, String(t1.error?.message ?? t2.error?.message));
  } else {
    const r1 = await postTo(T1, homeFd(homeCsv));
    const i1 = await r1.json();
    const r2 = await postTo(T2, homeFd(homeCsv));
    const i2 = await r2.json();
    check("other-tenant imports ok", r1.ok && r2.ok, JSON.stringify({ i1: i1.importedCount ?? i1.error, i2: i2.importedCount ?? i2.error }));

    const ch1 = await memberChapterName(T1, "E2E T1 Person");
    check(
      "configured home_chapter_name wins for other tenants",
      ch1 === CONFIGURED_HOME,
      `chapter=${ch1}`,
    );
    const ch2 = await memberChapterName(T2, "E2E T2 Person");
    check(
      "no configured home -> tenant's own name (never the env chapter)",
      ch2 === T2_NAME && ch2 !== HOME,
      `chapter=${ch2} envHome=${HOME}`,
    );
    const envInT1 = await sb.from("chapters").select("id").eq("tenant_id", T1).ilike("name", HOME).maybeSingle();
    const envInT2 = await sb.from("chapters").select("id").eq("tenant_id", T2).ilike("name", HOME).maybeSingle();
    check(
      "NEXT_PUBLIC_CHAPTER_NAME never created in other tenants",
      !envInT1.data && !envInT2.data,
      JSON.stringify({ t1: envInT1.data, t2: envInT2.data }),
    );
  }

  await wipeTenant(T1);
  await wipeTenant(T2);
  check(
    "home-rule tenants cleaned up",
    !(await sb.from("tenants").select("id").in("id", [T1, T2]).maybeSingle()).data,
    "",
  );
}

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
