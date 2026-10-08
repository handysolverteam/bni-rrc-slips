// Unit: pure rolling 26-week bucket logic (lib/palms-buckets.ts) — compiled
// standalone with tsc (the module has zero imports on purpose) and exercised
// directly.
//
// Run:  node tests/unit-palms-stats.mjs   (from the repo root)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsc = join(ROOT, "..", "node_modules", "typescript", "bin", "tsc");
const out = mkdtempSync(join(tmpdir(), "bni-stats-"));

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let pb = null;
try {
  execFileSync(
    process.execPath,
    [tsc, join(ROOT, "..", "lib", "palms-buckets.ts"), "--outDir", out, "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
    { stdio: "pipe" },
  );
  pb = require(join(out, "palms-buckets.js"));
  check("compiles lib/palms-buckets.ts standalone", true);
} catch (e) {
  check("compiles lib/palms-buckets.ts", false, `${e.message}\n${e.stdout ?? ""}`);
}

if (pb) {
  const { ROLLING_WEEKS, rollingWindow, bucketIndexFor, bucketAttendance, attendanceNameKey } = pb;

  // ---- rollingWindow -------------------------------------------------------
  check("window is 26 weeks", ROLLING_WEEKS === 26, String(ROLLING_WEEKS));
  check(
    "window ends today, 181 days back",
    eq(rollingWindow("2026-10-06"), { from: "2026-04-08", to: "2026-10-06" }),
    JSON.stringify(rollingWindow("2026-10-06")),
  );
  check(
    "window crosses the year boundary",
    eq(rollingWindow("2026-02-02"), { from: "2025-08-05", to: "2026-02-02" }),
    JSON.stringify(rollingWindow("2026-02-02")),
  );
  {
    const { from, to } = rollingWindow("2026-10-06");
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
    check("window spans 182 days (26 weeks, inclusive)", days === 181, `${days} + 1`);
  }

  // ---- bucketIndexFor ------------------------------------------------------
  check("0 letters -> no bucket", bucketIndexFor(0) === -1, String(bucketIndexFor(0)));
  check("1 letter -> bucket 2", bucketIndexFor(1) === 2, String(bucketIndexFor(1)));
  check("2 letters -> bucket 1", bucketIndexFor(2) === 1, String(bucketIndexFor(2)));
  check("3 letters -> bucket 0", bucketIndexFor(3) === 0, String(bucketIndexFor(3)));
  check("4 letters -> still bucket 0 (3+)", bucketIndexFor(4) === 0, String(bucketIndexFor(4)));

  // ---- attendanceNameKey ---------------------------------------------------
  check(
    "name key collapses case + spaces",
    attendanceNameKey("  E2E   Palm\tTwo ") === "e2e palm two",
    attendanceNameKey("  E2E   Palm\tTwo "),
  );

  // ---- bucketAttendance ----------------------------------------------------
  const row = (member_name, flags) => ({
    member_name,
    absent: null,
    m: null,
    s: null,
    ...flags,
  });
  const inactiveKeys = ["inactive bob"];

  const rows = [
    row("Zed Third", { absent: 1 }),
    row("Zed Third", { absent: 1 }),
    row("Zed Third", { absent: 1 }),
    row("Ada Third", { absent: 1 }),
    row("Ada Third", { absent: 1 }),
    row("Ada Third", { absent: 1 }),
    row("Mid Second", { absent: 1 }),
    row("Mid Second", { absent: 1 }),
    row("Solo First", { absent: 1 }),
    row("Legacy Five", { absent: 5 }),
    row("Med Third", { m: 1 }),
    row("Med Third", { m: 1 }),
    row("Med Third", { m: 1 }),
    row("Med Second", { m: 1 }),
    row("Med Second", { m: 1 }),
    row("Solo Medical", { m: 1 }),
    row("Sub Third", { s: 1 }),
    row("Sub Third", { s: 1 }),
    row("Sub Third", { s: 1 }),
    row("Sub Second", { s: 1 }),
    row("Sub Second", { s: 1 }),
    row("Solo Sub", { s: 1 }),
    row("Both Letters", { m: 1 }),
    row("Both Letters", { m: 1 }),
    row("Both Letters", { s: 1 }),
    row("Both Letters", { s: 1 }),
    row("Present Only", { absent: 0, m: 0, s: 0 }),
    row("Inactive  Bob", { absent: 1 }),
    row("Inactive  Bob", { absent: 1 }),
    row("Inactive  Bob", { absent: 1 }),
    row("   ", { absent: 1 }),
    { member_name: "No Name Flags", absent: null, m: null, s: null },
  ];
  const { groups, total } = bucketAttendance(rows, inactiveKeys);

  check("three groups in absent/medical/substitute order",
    eq(groups.map((g) => g.key), ["absent", "medical", "substitute"]),
    JSON.stringify(groups.map((g) => g.key)));
  const g = Object.fromEntries(groups.map((x) => [x.key, x.buckets]));
  check(
    "absent buckets: labels + alphabetical names",
    eq(g.absent, [
      { label: "3+ Absents", count: 3, names: ["Ada Third", "Legacy Five", "Zed Third"] },
      { label: "2 Absents", count: 1, names: ["Mid Second"] },
      { label: "1 Absent", count: 1, names: ["Solo First"] },
    ]),
    JSON.stringify(g.absent),
  );
  check(
    "medical buckets",
    eq(g.medical, [
      { label: "3+ Medicals", count: 1, names: ["Med Third"] },
      { label: "2 Medicals", count: 2, names: ["Both Letters", "Med Second"] },
      { label: "1 Medical", count: 1, names: ["Solo Medical"] },
    ]),
    JSON.stringify(g.medical),
  );
  check(
    "substitute buckets",
    eq(g.substitute, [
      { label: "3+ Substitutes", count: 1, names: ["Sub Third"] },
      { label: "2 Substitutes", count: 2, names: ["Both Letters", "Sub Second"] },
      { label: "1 Substitute", count: 1, names: ["Solo Sub"] },
    ]),
    JSON.stringify(g.substitute),
  );
  check(
    "total = distinct bucketed members, letters counted once",
    total === 12,
    String(total),
  );
  check("inactive member fully excluded",
    !JSON.stringify(groups).toLowerCase().includes("inactive bob"));
  check("blank member names skipped", !JSON.stringify(groups).includes("   "));
  check("all-null flags do not bucket", !JSON.stringify(groups).includes("No Name Flags"));

  const empty = bucketAttendance([], ["x"]);
  check(
    "no rows -> empty groups + total 0",
    empty.total === 0 && empty.groups.every((x) => x.buckets.every((b) => b.count === 0 && b.names.length === 0)),
    JSON.stringify(empty),
  );
}

rmSync(out, { recursive: true, force: true });
console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
