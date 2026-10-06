// Unit: pure Wednesday-gap logic (lib/missing-weeks.ts) — compiled standalone
// with tsc (the module has zero imports on purpose) and exercised directly.
//
// Run:  node tests/unit-missing-weeks.mjs   (from the repo root)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsc = join(ROOT, "..", "node_modules", "typescript", "bin", "tsc");
const out = mkdtempSync(join(tmpdir(), "bni-mw-"));

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let mw = null;
try {
  execFileSync(
    process.execPath,
    [tsc, join(ROOT, "..", "lib", "missing-weeks.ts"), "--outDir", out, "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
    { stdio: "pipe" },
  );
  mw = require(join(out, "missing-weeks.js"));
  check("compiles lib/missing-weeks.ts standalone", true);
} catch (e) {
  check("compiles lib/missing-weeks.ts", false, `${e.message}\n${e.stdout ?? ""}`);
}

if (mw) {
  const { missingWednesdays, todayIso } = mw;

  // 2026-09-16/23/30 and 2026-10-07 are Wednesdays; 2026-10-06 is a Tuesday.
  check(
    "single gap between two imported Wednesdays",
    eq(missingWednesdays(["2026-09-16", "2026-09-30"], "2026-10-01"), ["2026-09-23"]),
    JSON.stringify(missingWednesdays(["2026-09-16", "2026-09-30"], "2026-10-01")),
  );
  check(
    "current week not yet passed -> no warning",
    eq(missingWednesdays(["2026-09-30"], "2026-10-06"), []),
    JSON.stringify(missingWednesdays(["2026-09-30"], "2026-10-06")),
  );
  check(
    "current week passed without a file -> warning",
    eq(missingWednesdays(["2026-09-30"], "2026-10-08"), ["2026-10-07"]),
    JSON.stringify(missingWednesdays(["2026-09-30"], "2026-10-08")),
  );
  check("empty import history -> no warnings", eq(missingWednesdays([], "2026-10-06"), []));
  check(
    "multiple missing Wednesdays in range",
    eq(missingWednesdays(["2026-09-16"], "2026-10-06"), ["2026-09-23", "2026-09-30"]),
    JSON.stringify(missingWednesdays(["2026-09-16"], "2026-10-06")),
  );
  check(
    "non-Wednesday days are never warned",
    eq(missingWednesdays(["2026-09-30"], "2026-10-01"), []),
    JSON.stringify(missingWednesdays(["2026-09-30"], "2026-10-01")),
  );
  check(
    "dates before the first imported meeting are out of range",
    eq(missingWednesdays(["2026-04-01"], "2026-04-02"), []),
    JSON.stringify(missingWednesdays(["2026-04-01"], "2026-04-02")),
  );
  check(
    "future-only history -> no warnings",
    eq(missingWednesdays(["2026-10-07"], "2026-10-06"), []),
    JSON.stringify(missingWednesdays(["2026-10-07"], "2026-10-06")),
  );
  check(
    "garbage entries are ignored, not crash",
    eq(missingWednesdays(["", "not-a-date"], "2026-10-06"), []),
    JSON.stringify(missingWednesdays(["", "not-a-date"], "2026-10-06")),
  );
  check("todayIso formats a local date", todayIso(new Date(2026, 9, 6)) === "2026-10-06", todayIso(new Date(2026, 9, 6)));
}

rmSync(out, { recursive: true, force: true });
console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
