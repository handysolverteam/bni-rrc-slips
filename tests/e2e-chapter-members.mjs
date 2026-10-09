// E2E: chapter read from the file + "add to home chapter" checkboxes.
//   1. PALMS / slips previews read the chapter named in the file header
//      ("Influencers" == the BNI Influencers chapter -> match; another name ->
//      choose, with the existing chapters offered).
//   2. Previews list the NEW home-chapter members (ticked by default in the UI).
//   3. skipMembers: an un-ticked PALMS member is not created and their
//      attendance is not stored; an un-ticked slips member is not created but
//      their slip still imports (without a member link).
// Everything uses unique "E2E CHM " names and removes only those rows.
// Run: node tests/e2e-chapter-members.mjs   (prod server on :3000)
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";

const APP = "http://localhost:3000";
const ENV = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const kv = (k) => ENV.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1);
const sb = createClient(kv("NEXT_PUBLIC_SUPABASE_URL"), kv("SUPABASE_SERVICE_ROLE_KEY"));
const TENANT = "d1000000-0000-4000-8000-000000000001";
const AUTH = { Authorization: `Bearer ${kv("SUPABASE_SERVICE_ROLE_KEY")}` };
const WEDS = ["2026-09-02", "2026-09-09"];
const serialFor = (iso) =>
  Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse("1899-12-30T00:00:00Z")) / 86400000);

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);

const fd = (content, name, type, extra = {}) => {
  const f = new FormData();
  f.append("file", new File([content], name, { type }));
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
};
const post = (path, form) => fetch(`${APP}${path}`, { method: "POST", body: form, headers: { ...AUTH } });
const XLS = "application/vnd.ms-excel";

/** PALMS wide file; `chapterLayout` mirrors the real export (name BELOW a "Chapter" cell) or the parameter row (name to the RIGHT). */
async function palmsFile(chapter, layout, members) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.addRow(["Chapter ► PALMS Attendance Report"]);
  if (layout === "below") {
    ws.addRow(["Running User", "", "", "", "", "Chapter"]);
    ws.addRow(["Someone", "", "", "", "", chapter]);
    ws.addRow(["Parameters"]);
    ws.addRow(["From:", "", "", "", "", serialFor("2026-09-01")]);
    ws.addRow(["To:", "", "", "", "", serialFor("2026-09-30")]);
  } else {
    ws.addRow(["Parameters"]);
    ws.addRow(["Chapter", "", "", chapter]);
    ws.addRow(["From:", "", "", serialFor("2026-09-01")]);
    ws.addRow(["To:", "", "", serialFor("2026-09-30")]);
  }
  ws.addRow([]);
  ws.addRow(["First Name", "Last Name", "", "Sep 02", "Sep 09"]);
  for (const [first, last, a, b] of members) ws.addRow([first, last, "", a, b]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const slipsCsv = (name, chapterBlock = "") =>
  "Slips Audit Report for 30/09/2026\n" +
  chapterBlock +
  "From,To,Slip Type,Inside/Outside,TYFCB Amount,CEU Credits,Detail\n" +
  `${name},,CEU,,,6,\n`;

async function cleanup() {
  await sb.from("member_attendance").delete().eq("tenant_id", TENANT).like("member_name", "E2E CHM %");
  await sb.from("slip_ceus").delete().eq("tenant_id", TENANT).like("member_name", "E2E CHM %");
  await sb.from("members").delete().eq("tenant_id", TENANT).like("name", "E2E CHM %");
  await sb.from("import_batches").delete().eq("tenant_id", TENANT).like("filename", "e2e-chm-%");
}

try {
  await cleanup();
  const homeId = (
    await sb.from("chapters").select("id").eq("tenant_id", TENANT).ilike("name", "BNI Influencers").maybeSingle()
  ).data?.id;
  check("home chapter row exists", !!homeId);

  // ---- 1) PALMS preview: chapter detection (both header layouts) ------------
  const people = [["E2E", "CHM Newbie One", "P", "A"], ["E2E", "CHM Newbie Two", "M", "P"]];
  for (const layout of ["below", "right"]) {
    const buf = await palmsFile("Influencers", layout, people);
    const j = await (await post("/api/import/palms/preview", fd(buf, `e2e-chm-${layout}.xls`, XLS))).json();
    check(
      `PALMS (${layout}): "Influencers" = the active BNI Influencers chapter`,
      j.chapter?.detected === "Influencers" && j.chapter?.normalized === "BNI Influencers" && j.chapter?.status === "match",
      JSON.stringify(j.chapter),
    );
    check(
      `PALMS (${layout}): both people are listed as new home members`,
      JSON.stringify(j.newMembers) === JSON.stringify(["E2E CHM Newbie One", "E2E CHM Newbie Two"]) &&
        j.homeChapter === "BNI Influencers",
      JSON.stringify(j.newMembers),
    );
  }
  const otherBuf = await palmsFile("Zorbs", "below", people);
  const other = await (await post("/api/import/palms/preview", fd(otherBuf, "e2e-chm-other.xls", XLS))).json();
  check(
    "a different chapter in the file -> choose (existing chapters offered, none suggested)",
    other.chapter?.status === "choose" &&
      other.chapter?.normalized === "BNI Zorbs" &&
      other.chapter?.suggestedId === null &&
      other.chapter?.options?.some((o) => o.id === TENANT),
    JSON.stringify(other.chapter),
  );
  const asNew = await (
    await post("/api/import/palms/preview", fd(otherBuf, "e2e-chm-other.xls", XLS, { chapter: JSON.stringify({ newName: "E2E CHM Brand New Chapter" }) }))
  ).json();
  check(
    "typed new chapter: preview recounts against an empty chapter (everyone new, cells all new)",
    asNew.homeChapter === "E2E CHM Brand New Chapter" && asNew.newMembers?.length === 2 && asNew.cellSkipped === 0,
    JSON.stringify({ home: asNew.homeChapter, n: asNew.newMembers?.length }),
  );
  const noChapter = await (
    await post("/api/import/palms/preview", fd(await palmsFile("", "right", people), "e2e-chm-none.xls", XLS))
  ).json();
  check("no chapter in the file -> undetected (imports into the active chapter)", noChapter.chapter?.status === "undetected", JSON.stringify(noChapter.chapter));

  // ---- 2) PALMS import: un-ticked member skipped with their attendance ------
  const buf = await palmsFile("Influencers", "below", people);
  const imp = await (
    await post("/api/import/palms", fd(buf, "e2e-chm-palms.xls", XLS, { skipMembers: JSON.stringify(["E2E CHM Newbie Two"]) }))
  ).json();
  check("import: 1 member added, 1 skipped", imp.membersAdded === 1 && imp.membersSkipped === 1, JSON.stringify({ a: imp.membersAdded, s: imp.membersSkipped }));
  const mem = (await sb.from("members").select("name,chapter_id").eq("tenant_id", TENANT).like("name", "E2E CHM %")).data ?? [];
  check(
    "ticked member created in the HOME chapter, un-ticked one not created",
    mem.length === 1 && mem[0].name === "E2E CHM Newbie One" && mem[0].chapter_id === homeId,
    JSON.stringify(mem),
  );
  const att = (await sb.from("member_attendance").select("member_name").eq("tenant_id", TENANT).like("member_name", "E2E CHM %")).data ?? [];
  check(
    "attendance stored only for the ticked member (2 cells)",
    att.length === 2 && att.every((r) => r.member_name === "E2E CHM Newbie One"),
    JSON.stringify(att),
  );
  const again = await (await post("/api/import/palms/preview", fd(buf, "e2e-chm-palms.xls", XLS))).json();
  check(
    "re-preview: the added member is no longer new, the skipped one still is",
    JSON.stringify(again.newMembers) === JSON.stringify(["E2E CHM Newbie Two"]),
    JSON.stringify(again.newMembers),
  );

  // ---- 3) slips: preview lists the new home member; un-ticked keeps the slip ---
  const sp = await (await post("/api/import/preview", fd(slipsCsv("E2E CHM Slip Newbie"), "e2e-chm-slips.csv", "text/csv"))).json();
  check("slips preview lists the new home member", sp.newMembers?.includes("E2E CHM Slip Newbie"), JSON.stringify(sp.newMembers));
  check("slips preview: no chapter in the CSV -> undetected", sp.chapter?.status === "undetected", JSON.stringify(sp.chapter));
  const withChapter = await (
    await post("/api/import/preview", fd(slipsCsv("E2E CHM Slip Newbie", "Chapter\nInfluencers\n"), "e2e-chm-slips-ch.csv", "text/csv"))
  ).json();
  check(
    "slips file: chapter read from the header block (Influencers = BNI Influencers)",
    withChapter.chapter?.detected === "Influencers" && withChapter.chapter?.status === "match",
    JSON.stringify(withChapter.chapter),
  );
  const withOther = await (
    await post("/api/import/preview", fd(slipsCsv("E2E CHM Slip Newbie", "Chapter\nZorbs\n"), "e2e-chm-slips-zb.csv", "text/csv"))
  ).json();
  check("slips file for another chapter -> choose", withOther.chapter?.status === "choose" && withOther.chapter?.normalized === "BNI Zorbs", JSON.stringify(withOther.chapter));
  const si = await (
    await post("/api/import/report", fd(slipsCsv("E2E CHM Slip Newbie"), "e2e-chm-slips.csv", "text/csv", { skipMembers: JSON.stringify(["E2E CHM Slip Newbie"]) }))
  ).json();
  const ceu = (await sb.from("slip_ceus").select("member_id,member_name").eq("tenant_id", TENANT).like("member_name", "E2E CHM %")).data ?? [];
  const slipMember = (await sb.from("members").select("id").eq("tenant_id", TENANT).like("name", "E2E CHM Slip%")).data ?? [];
  check(
    "un-ticked slips member: slip imported, no member row, no member link",
    si.importedCount === 1 && ceu.length === 1 && ceu[0].member_id === null && slipMember.length === 0 && si.membersSkipped === 1,
    JSON.stringify({ imp: si.importedCount, ceu: ceu.length, members: slipMember.length, skipped: si.membersSkipped }),
  );
} finally {
  await cleanup();
  const left = (await sb.from("members").select("id").eq("tenant_id", TENANT).like("name", "E2E CHM %")).data ?? [];
  const leftBatches = (await sb.from("import_batches").select("id").eq("tenant_id", TENANT).like("filename", "e2e-chm-%")).data ?? [];
  results.push(`${left.length === 0 && leftBatches.length === 0 ? "PASS" : "FAIL"}  cleanup removed every E2E CHM row`);
}

const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(results.join("\n"));
console.log(`TOTAL: ${results.filter((r) => r.startsWith("PASS")).length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
