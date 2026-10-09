// E2E: merging two spellings of one member.
//   1. The import preview suggests "Same person as …" for a look-alike new name.
//   2. Importing with that merge pick adds NO new member and stores the
//      attendance under the existing member's name (works with or without
//      migration 008; the pick is applied in-memory when the table is missing).
//   3. POST /api/members/merge merges already-imported data: member row, slip
//      names + ids, attendance (same-week clash keeps the canonical cell).
//   4. With migration 008 applied, the merge is remembered and a later import
//      maps the old spelling without being told.
// Only "E2E MRG " rows are touched. Run: node tests/e2e-member-merge.mjs
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";

const APP = "http://localhost:3000";
const ENV = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const kv = (k) => ENV.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1);
const sb = createClient(kv("NEXT_PUBLIC_SUPABASE_URL"), kv("SUPABASE_SERVICE_ROLE_KEY"));
const TENANT = "d1000000-0000-4000-8000-000000000001";
const AUTH = { Authorization: `Bearer ${kv("SUPABASE_SERVICE_ROLE_KEY")}` };
const serialFor = (iso) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse("1899-12-30T00:00:00Z")) / 86400000);
const XLS = "application/vnd.ms-excel";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
const info = (msg) => results.push(`INFO  ${msg}`);

const fd = (content, name, extra = {}) => {
  const f = new FormData();
  f.append("file", new File([content], name, { type: XLS }));
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
};
const post = (path, body) => fetch(`${APP}${path}`, { method: "POST", body, headers: { ...AUTH } });

/** members: [[firstPart, lastWord, sep02Letter, sep09Letter]] — the full name is `${first} ${last}`. */
async function palms(members) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.addRow(["Chapter ► PALMS Attendance Report"]);
  ws.addRow(["Parameters"]);
  ws.addRow(["Chapter", "", "", "Influencers"]);
  ws.addRow(["From:", "", "", serialFor("2026-09-01")]);
  ws.addRow(["To:", "", "", serialFor("2026-09-30")]);
  ws.addRow([]);
  ws.addRow(["First Name", "Last Name", "", "Sep 02", "Sep 09"]);
  for (const [first, last, a, b] of members) ws.addRow([first, last, "", a, b]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const aliasTable = !(await sb.from("member_aliases").select("id").limit(1)).error;
async function cleanup() {
  await sb.from("member_attendance").delete().eq("tenant_id", TENANT).like("member_name", "E2E MRG %");
  await sb.from("slip_ceus").delete().eq("tenant_id", TENANT).like("member_name", "E2E MRG %");
  await sb.from("members").delete().eq("tenant_id", TENANT).like("name", "E2E MRG %");
  await sb.from("import_batches").delete().eq("tenant_id", TENANT).like("filename", "e2e-mrg-%");
  if (aliasTable) await sb.from("member_aliases").delete().eq("tenant_id", TENANT).like("alias_name", "E2E MRG %");
}
const membersNamed = async (like) => (await sb.from("members").select("id,name").eq("tenant_id", TENANT).like("name", like)).data ?? [];
const attendanceOf = async (name) =>
  (await sb.from("member_attendance").select("member_name,bni_week_id").eq("tenant_id", TENANT).ilike("member_name", name)).data ?? [];

try {
  await cleanup();
  info(`migration 008 table ${aliasTable ? "present — remembered merges are tested" : "MISSING — remembered-merge checks are skipped (run supabase/migrations/008_member_aliases.sql)"}`);

  // Existing member "E2E MRG Amit Bahl" (Sep 02 attendance only).
  await post("/api/import/palms", fd(await palms([["E2E MRG Amit", "Bahl", "P", ""]]), "e2e-mrg-a.xls"));
  check("setup: canonical member exists", (await membersNamed("E2E MRG Amit Bahl")).length === 1);

  // 1) preview suggests the look-alike
  const fileB = await palms([["E2E MRG Amit K", "Bahl", "P", "M"]]);
  const pv = await (await post("/api/import/palms/preview", fd(fileB, "e2e-mrg-b.xls"))).json();
  check(
    "preview lists the look-alike as new and suggests the existing member",
    pv.newMembers?.includes("E2E MRG Amit K Bahl") && pv.similar?.["E2E MRG Amit K Bahl"]?.includes("E2E MRG Amit Bahl"),
    JSON.stringify({ n: pv.newMembers, s: pv.similar }),
  );

  // 2) import with the merge pick: no new member, attendance under the canonical name
  const pick = JSON.stringify({ "E2E MRG Amit K Bahl": "E2E MRG Amit Bahl" });
  const imp = await (await post("/api/import/palms", fd(fileB, "e2e-mrg-b.xls", { mergeMembers: pick }))).json();
  check("merged import adds no member", imp.membersAdded === 0 && (await membersNamed("E2E MRG %")).length === 1, JSON.stringify({ added: imp.membersAdded }));
  const canon = await attendanceOf("E2E MRG Amit Bahl");
  const alias = await attendanceOf("E2E MRG Amit K Bahl");
  check("Sep 02 already existed (skipped), Sep 09 stored under the canonical name", canon.length === 2 && alias.length === 0, JSON.stringify({ canon: canon.length, alias: alias.length }));
  if (aliasTable) {
    check("the merge was remembered", imp.aliasesSaved === 1, JSON.stringify(imp.aliasesSaved));
    const again = await (await post("/api/import/palms/preview", fd(fileB, "e2e-mrg-b.xls"))).json();
    check("a later preview maps the old spelling silently (not new, no question)", !again.newMembers?.includes("E2E MRG Amit K Bahl") && !again.similar?.["E2E MRG Amit K Bahl"], JSON.stringify(again.newMembers));
  } else {
    check("without the table the import still succeeds and warns", typeof imp.warning === "string" && imp.warning.includes("008"), String(imp.warning));
  }

  // 3) merge already-imported data through the API
  await post("/api/import/palms", fd(await palms([["E2E MRG Rita", "Shah", "P", ""], ["E2E MRG Rita S", "Shah", "A", "M"]]), "e2e-mrg-c.xls"));
  const both = await membersNamed("E2E MRG Rita%");
  check("setup: two spellings exist as separate members", both.length === 2);
  const keep = both.find((x) => x.name === "E2E MRG Rita Shah");
  // slips pointing at the alias member
  const away = both.find((x) => x.name === "E2E MRG Rita S Shah");
  const wk = (await sb.from("bni_weeks").select("id").eq("meeting_date", "2026-09-30").maybeSingle()).data;
  await sb.from("slip_ceus").insert({ tenant_id: TENANT, bni_week_id: wk.id, member_id: away.id, member_name: "E2E MRG Rita S Shah", credits: 1 });
  const res = await post("/api/members/merge", JSON.stringify({ from: "E2E MRG Rita S Shah", into: "E2E MRG Rita Shah" }));
  const mj = await res.json();
  check("merge API ok", res.ok && mj.ok === true, JSON.stringify(mj));
  const after = await membersNamed("E2E MRG Rita%");
  check("the alias member row is gone, the kept one remains", after.length === 1 && after[0].id === keep.id, JSON.stringify(after));
  const ceu = (await sb.from("slip_ceus").select("member_id,member_name").eq("tenant_id", TENANT).like("member_name", "E2E MRG Rita%")).data ?? [];
  check("slip name + member link moved to the kept member", ceu.length === 1 && ceu[0].member_name === "E2E MRG Rita Shah" && ceu[0].member_id === keep.id, JSON.stringify(ceu));
  const ritaKept = await attendanceOf("E2E MRG Rita Shah");
  const ritaAlias = await attendanceOf("E2E MRG Rita S Shah");
  // Rita Shah had Sep 02 = P; Rita S Shah had Sep 02 = A (clash -> dropped) and Sep 09 = M (moved).
  check("attendance: clash keeps the kept member's cell, the other week moves over", ritaKept.length === 2 && ritaAlias.length === 0, JSON.stringify({ kept: ritaKept.length, alias: ritaAlias.length }));
  check("merge result counts", mj.membersMerged === 1 && mj.attendanceMoved === 1 && mj.attendanceDropped === 1, JSON.stringify(mj));
  if (aliasTable) {
    check("the API merge is remembered", mj.remembered === true);
  } else {
    check("without the table the merge still works and warns", mj.remembered === false && String(mj.warning).includes("008"), String(mj.warning));
  }
  const bad = await post("/api/members/merge", JSON.stringify({ from: "E2E MRG Rita Shah", into: "e2e mrg rita  shah" }));
  check("merging a name into itself is refused", bad.status === 400);
} finally {
  await cleanup();
  const left = (await membersNamed("E2E MRG %")).length + (await attendanceOf("E2E MRG %")).length;
  results.push(`${left === 0 ? "PASS" : "FAIL"}  cleanup removed every E2E MRG row`);
}

const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(results.join("\n"));
console.log(`TOTAL: ${results.filter((r) => r.startsWith("PASS")).length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
