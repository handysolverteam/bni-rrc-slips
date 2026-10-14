// DEV CHECK (not part of the app): how close does the Traffic Lights screen get to BNI's own monthly report?
// The Excel is only an ANSWER KEY here — it is read by this script and never imported into the app.
//
//   npx tsx tests/check-traffic-lights-vs-excel.mts "<BNI Member Traffic Lights.xlsx>" ["<PALMS attendance .xls>"]
//
// The second file (optional) stands in for the full PALMS attendance import when the database only holds
// part of it. Needs .env.local (read-only Supabase queries). Prints, per component and in total, how many
// members match BNI exactly, and lists the members that differ.
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i > 0) process.env[l.slice(0, i)] = l.slice(i + 1);
}
const [excelPath, palmsPath] = process.argv.slice(2);
if (!excelPath) {
  console.error('usage: npx tsx tests/check-traffic-lights-vs-excel.mts "<BNI xlsx>" ["<PALMS attendance xls>"]');
  process.exit(1);
}

const T = process.env.TENANT_ID ?? "d1000000-0000-4000-8000-000000000001";
const { fetchTrafficData } = await import("../lib/traffic-lights");
const { buildTrafficRows, windowMeetings, firstLastKey } = await import("../lib/traffic-light-calc");
const { lightFor } = await import("../lib/traffic-light-score");
const { parsePalmsWideFile } = await import("../lib/palms-import");

// ---- BNI's report (answer key). Row 1 = title "… FOR SEPTEMBER '26", then a header row, then one row per member.
const wb = XLSX.read(readFileSync(excelPath));
const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", blankrows: false });
const title = String(grid[0]?.[0] ?? "");
const MONTHS: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
const t = /FOR\s+([A-Za-z]+)\s*'?\s*(\d{2,4})/i.exec(title);
if (!t || !MONTHS[t[1].toLowerCase()]) throw new Error(`Cannot read the month from the title: ${title}`);
const month = `${t[2].length === 2 ? "20" + t[2] : t[2]}-${MONTHS[t[1].toLowerCase()]}`;
const hi = grid.findIndex((r) => r.map((c) => String(c).trim().toLowerCase()).includes("total score"));
const head = grid[hi].map((c) => String(c).trim().toLowerCase());
const col = (n: string) => head.indexOf(n);
type Key = { name: string; total: number; att: number; ceu: number; oto: number; ref: number; tyf: number; vis: number; spo: number };
const answer = new Map<string, Key>();
for (const r of grid.slice(hi + 1)) {
  const name = String(r[col("name")] ?? "").replace(/\s+/g, " ").trim();
  if (!name) continue;
  const n = (c: string) => Number(r[col(c)]) || 0;
  answer.set(firstLastKey(name), {
    name, total: n("total score"), att: n("attendance score"), ceu: n("ceu score"), oto: n("121 score"),
    ref: n("referrals given score"), tyf: n("tyfcb score"), vis: n("visitor score"), spo: n("sponsor score"),
  });
}

// ---- our data
const d = await fetchTrafficData(T);
const meetings = windowMeetings(d.meetings, month);
const slips = { ...d.slips };
if (palmsPath) {
  const byDate = new Map(meetings.map((m) => [m.date, m.id]));
  const palms = parsePalmsWideFile(readFileSync(palmsPath));
  slips.attendance = [];
  for (const m of palms.members) {
    palms.columns.forEach((c, i) => {
      const id = byDate.get(c.iso);
      const L = String(m.cells[i] ?? "").trim().toUpperCase();
      if (!id || !L) return;
      slips.attendance.push({ week: id, name: m.name, present: L === "P" ? 1 : 0, absent: L === "A" ? 1 : 0, m: L === "M" ? 1 : 0, s: L === "S" ? 1 : 0, l: L === "L" ? 1 : 0 });
    });
  }
}
const rows = buildTrafficRows({ members: d.members, homeAll: d.homeAll, meetings, slips });

// ---- compare
const agree = { att: 0, ceu: 0, oto: 0, ref: 0, tyf: 0, vis: 0, spo: 0 };
let n = 0, exact = 0, w5 = 0, colour = 0;
const differing: string[] = [];
for (const r of rows) {
  const a = answer.get(firstLastKey(r.name));
  if (!a) continue;
  n++;
  if (r.attendance.score === a.att) agree.att++;
  if (r.ceu.score === a.ceu) agree.ceu++;
  if (r.oneToOne.score === a.oto) agree.oto++;
  if (r.referrals.score === a.ref) agree.ref++;
  if (r.tyfcb.score === a.tyf) agree.tyf++;
  if (r.visitors.score === a.vis) agree.vis++;
  if (r.sponsors.score === a.spo) agree.spo++;
  const diff = r.total - a.total;
  if (diff === 0) exact++;
  else differing.push(`${r.name}: ours ${r.total} vs BNI ${a.total} (${diff > 0 ? "+" : ""}${diff})  [att ${r.attendance.score}/${a.att}, vis ${r.visitors.score}/${a.vis}, spo ${r.sponsors.score}/${a.spo}]`);
  if (Math.abs(diff) <= 5) w5++;
  if (lightFor(r.total) === lightFor(a.total)) colour++;
}
console.log(`Report month ${month}: window ${meetings.length} meetings, ${rows.length} of our active members, ${answer.size} in BNI's file, ${n} compared`);
console.log("Component score agreement (members with the SAME points as BNI):", JSON.stringify(agree));
console.log(`Total score: exact ${exact}/${n}, within 5 points ${w5}/${n}, same colour ${colour}/${n}`);
if (differing.length > 0) console.log("Differences:\n  " + differing.join("\n  "));
