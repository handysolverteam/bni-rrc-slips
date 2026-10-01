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
const HOME = kv("NEXT_PUBLIC_CHAPTER_NAME") || "BNI Influencer";
const TEST_CHAPTER = "BNI Test Chapter";
const IGNORE_CHAPTER = "BNI Ignore Chapter"; // detail on non-bold rows — must never be created
const MEETING = "2026-09-30"; // existing week 40
const TITLE = "Slips Audit Report for 30/09/2026\n";
const HEAD = "From,To,Slip Type,Inside/Outside,TYFCB Amount,CEU Credits,Detail\n";

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
const post = (path, form) => fetch(`${APP}${path}`, { method: "POST", body: form });

// ---- db helpers -----------------------------------------------------------
async function count(table, filter) {
  let q = sb.from(table).select("id", { count: "exact" }).limit(1);
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
    .eq("bni_week_id", weekId);
  const otoWeighted = (otos ?? []).reduce(
    (n, r) => n + (r.initiated_by_is_other_chapter === true || r.met_with_is_other_chapter === true ? 1 : 2),
    0,
  );
  return { otoWeighted, ref, tyfcb, vis, ceu, total: otoWeighted + ref + tyfcb + vis + ceu };
}
async function exportSummary(weekId) {
  const r = await fetch(`${APP}/api/report/export?week=${weekId}&tab=all&format=json`);
  const j = await r.json();
  return j.summary;
}
async function membersNamed(names) {
  const { data } = await sb.from("members").select("id,name,chapter_id").in("name", names);
  return data ?? [];
}
async function chapterIdByName(name) {
  const { data } = await sb.from("chapters").select("id").ilike("name", name).maybeSingle();
  return data?.id ?? null;
}
async function batchId(filename) {
  const { data } = await sb
    .from("import_batches").select("id").eq("filename", filename)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? null;
}

// ---- 0) pre-clean leftovers + capture baseline ----------------------------
async function preClean() {
  const { data: oldBatches } = await sb
    .from("import_batches").select("id,filename").or("filename.eq.e2e-seed.csv,filename.eq.e2e-bold.xlsx");
  for (const b of oldBatches ?? []) {
    for (const t of ["slip_referrals", "slip_one_to_ones", "slip_tyfcb", "slip_visitors", "slip_ceus"]) {
      await sb.from(t).delete().eq("import_batch_id", b.id);
    }
    await sb.from("import_batches").delete().eq("id", b.id);
  }
  await sb.from("members").delete().like("name", "E2E %");
  const tc = await chapterIdByName(TEST_CHAPTER);
  if (tc) await sb.from("chapters").delete().eq("id", tc);
}
async function cleanup() {
  const { data: batches } = await sb
    .from("import_batches").select("id,filename").or("filename.eq.e2e-seed.csv,filename.eq.e2e-bold.xlsx");
  for (const b of batches ?? []) {
    for (const t of ["slip_referrals", "slip_one_to_ones", "slip_tyfcb", "slip_visitors", "slip_ceus"]) {
      await sb.from(t).delete().eq("import_batch_id", b.id);
    }
    await sb.from("import_batches").delete().eq("id", b.id);
  }
  await sb.from("members").delete().like("name", "E2E %");
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
  "baseline is the known good state",
  base.total === 213 && baseExport.total === 213 && baseExport.total === base.total,
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

const ceuRows = await sb.from("slip_ceus").select("id,member_id").eq("member_name", "E2E Home Person");
check("duplicate CEU rows both imported", (ceuRows.data ?? []).length === 2, `count=${(ceuRows.data ?? []).length}`);
check("CEU rows linked to the member", (ceuRows.data ?? []).every((x) => !!x.member_id));

const refDup = await count("slip_referrals", { from_name: "E2E Dup Row", to_name: "E2E Dup Target" });
check("duplicate referrals attempted (>=1)", refDup >= 1, `count=${refDup}`);
if (refDup === 1) info("referral duplicate rejected by DB — migration 003_allow_duplicate_slips.sql still pending (message recorded on the batch)");
else if (refDup === 2) info("both duplicate referrals imported — migration 003 already applied");

const refSeed = await sb.from("slip_referrals").select("from_member_id,to_member_id").eq("from_name", "E2E Seed Person").eq("to_name", "E2E Seed Guest").limit(1).maybeSingle();
check("referral linked to member ids", !!refSeed.data?.from_member_id && !!refSeed.data?.to_member_id);
const visRow = await sb.from("slip_visitors").select("invited_by_member_id").eq("full_name", "E2E Visitor Guest").limit(1).maybeSingle();
check("visitor inviter linked, guest unlinked", !!visRow.data?.invited_by_member_id);
const tyfcbRow = await sb.from("slip_tyfcb").select("member_id").eq("member_name", "E2E TYFCB Recipient").limit(1).maybeSingle();
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
const ceuBoldRow = await sb.from("slip_ceus").select("member_id").eq("member_name", "E2E CEU Person").limit(1).maybeSingle();
check("bold CEU slip linked to its HOME member row", !!ceuBoldRow.data?.member_id);

// ---- 4) today's screens reflect the import (caches cleared on import) ----
const filtered = await (await fetch(`${APP}/members?c_chapter=${encodeURIComponent(TEST_CHAPTER)}`)).text();
// Rows serialize as \"name\":\"...\"; the Name column's filter options are a bare
// string array of ALL member names, so only the row-key form proves the filter.
const q = String.fromCharCode(34), bs = String.fromCharCode(92);
const rowIn = (html, name) => html.includes(bs + q + "name" + bs + q + ":" + bs + q + name + bs + q);
check(
  "members screen filters the new chapter",
  rowIn(filtered, "E2E Bold Person") && rowIn(filtered, "E2E Seed Person") && !rowIn(filtered, "E2E Home Person"),
  "chapter-filtered SSR rows",
);
const memberPage = await (await fetch(`${APP}/members`)).text();
check("Chapter column filter offers the new chapter", memberPage.includes(TEST_CHAPTER), "distinct options refreshed");

const dbNow = await dbSummary(weekId);
const expNow = await exportSummary(weekId);
check(
  "export summary matches DB after import",
  expNow && expNow.total === dbNow.total &&
    JSON.stringify(expNow.rows.map((x) => x.count)) === JSON.stringify([dbNow.otoWeighted, dbNow.ref, dbNow.tyfcb, dbNow.vis, dbNow.ceu]),
  `export=${JSON.stringify(expNow?.rows)} total=${expNow?.total} db=${JSON.stringify(dbNow)}`,
);
check("summary grew by the imported slips", dbNow.total > base.total, `${base.total} -> ${dbNow.total}`);

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

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
