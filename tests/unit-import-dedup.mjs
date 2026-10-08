// Unit: pure re-import dedup logic (lib/import-dedup.ts) — compiled standalone
// with tsc (the module has zero imports on purpose) and exercised directly.
//
// Run:  node tests/unit-import-dedup.mjs   (from the repo root)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsc = join(ROOT, "..", "node_modules", "typescript", "bin", "tsc");
const out = mkdtempSync(join(tmpdir(), "bni-dedup-"));

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let dd = null;
try {
  execFileSync(
    process.execPath,
    [tsc, join(ROOT, "..", "lib", "import-dedup.ts"), "--outDir", out, "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
    { stdio: "pipe" },
  );
  dd = require(join(out, "import-dedup.js"));
  check("compiles lib/import-dedup.ts standalone", true);
} catch (e) {
  check("compiles lib/import-dedup.ts standalone", false, `${e.message}\n${e.stdout ?? ""}`);
}

if (dd) {
  const { SIG_FIELDS, rowSignature, dropDuplicates } = dd;

  check(
    "referral identity = From/To/detail/inside/flags only (no ids)",
    eq(SIG_FIELDS.slip_referrals, ["from_name", "to_name", "other_chapter_member", "inside_outside", "from_is_other_chapter", "to_is_other_chapter"]),
    JSON.stringify(SIG_FIELDS.slip_referrals),
  );
  check(
    "one-to-one identity covers initiator + met-with",
    eq(SIG_FIELDS.slip_one_to_ones, ["initiated_by_name", "met_with_name", "other_chapter_member", "initiated_by_is_other_chapter", "met_with_is_other_chapter"]),
    JSON.stringify(SIG_FIELDS.slip_one_to_ones),
  );
  check(
    "tyfcb identity = member/amount/detail/thanker",
    eq(SIG_FIELDS.slip_tyfcb, ["member_name", "amount", "other_chapter_member", "thanker_name", "thanker_is_other_chapter"]),
    JSON.stringify(SIG_FIELDS.slip_tyfcb),
  );
  check(
    "visitor identity = the two names",
    eq(SIG_FIELDS.slip_visitors, ["full_name", "invited_by_name"]),
    JSON.stringify(SIG_FIELDS.slip_visitors),
  );
  check(
    "ceu identity = member + credits only (slip_ceus has no detail/thanker columns)",
    eq(SIG_FIELDS.slip_ceus, ["member_name", "credits"]),
    JSON.stringify(SIG_FIELDS.slip_ceus),
  );

  // ---- rowSignature --------------------------------------------------------
  const refA = {
    from_name: "E2E A",
    to_name: "E2E B",
    other_chapter_member: null,
    inside_outside: "inside",
    from_is_other_chapter: false,
    to_is_other_chapter: false,
  };
  check(
    "same fields -> same signature",
    rowSignature("slip_referrals", refA) === rowSignature("slip_referrals", { ...refA }),
  );
  check(
    "different Detail -> different signature",
    rowSignature("slip_referrals", { ...refA, other_chapter_member: "Other" }) !== rowSignature("slip_referrals", refA),
  );
  check(
    "null and empty string hash identically",
    rowSignature("slip_referrals", { ...refA, other_chapter_member: null }) ===
      rowSignature("slip_referrals", { ...refA, other_chapter_member: "" }),
  );
  check(
    "number and its string form hash identically (PostgREST numeric round-trip)",
    rowSignature("slip_tyfcb", { member_name: "X", amount: 3, other_chapter_member: null, thanker_name: null, thanker_is_other_chapter: false }) ===
      rowSignature("slip_tyfcb", { member_name: "X", amount: "3", other_chapter_member: "", thanker_name: null, thanker_is_other_chapter: false }),
  );
  check(
    "values are joined with a separator (\"A\",\"B\" name never equals A with B detail)",
    rowSignature("slip_referrals", { ...refA, from_name: "E2E A", to_name: "E2E B" }) !==
      rowSignature("slip_referrals", { ...refA, from_name: "E2E A E2E", to_name: "B" }),
  );

  // ---- dropDuplicates ------------------------------------------------------
  const rows = [
    { member_name: "Alice", credits: 1, other_chapter_member: null, thanker_name: null, thanker_is_other_chapter: false },
    { member_name: "Bob", credits: 2, other_chapter_member: null, thanker_name: null, thanker_is_other_chapter: false },
  ];
  {
    const { fresh, duplicateCount } = dropDuplicates("slip_ceus", rows, new Set());
    check("first import keeps every row", fresh.length === 2 && duplicateCount === 0, `fresh=${fresh.length} dup=${duplicateCount}`);
  }
  {
    const existing = new Set([rowSignature("slip_ceus", rows[1])]);
    const { fresh, duplicateCount } = dropDuplicates("slip_ceus", rows, existing);
    check("re-import drops only rows already in the DB", fresh.length === 1 && duplicateCount === 1 && fresh[0].member_name === "Alice", `fresh=[${fresh.map((r) => r.member_name)}] dup=${duplicateCount}`);
  }
  {
    const twins = [rows[0], rows[0]];
    const { fresh, duplicateCount } = dropDuplicates("slip_ceus", twins, new Set());
    check("owner rule: identical rows inside one file both import", fresh.length === 2 && duplicateCount === 0, `fresh=${fresh.length} dup=${duplicateCount}`);
  }
  {
    const { fresh, duplicateCount } = dropDuplicates("slip_ceus", [rows[0], rows[0]], new Set([rowSignature("slip_ceus", rows[0])]));
    check("full re-import of a twin file skips every row", fresh.length === 0 && duplicateCount === 2, `fresh=${fresh.length} dup=${duplicateCount}`);
  }
  {
    const existing = new Set([rowSignature("slip_visitors", { full_name: "G", invited_by_name: "H" })]);
    const { fresh, duplicateCount } = dropDuplicates(
      "slip_visitors",
      [{ full_name: "G", invited_by_name: "H" }, { full_name: "I", invited_by_name: "J" }],
      existing,
    );
    check("visitors dedupe on their two names", fresh.length === 1 && duplicateCount === 1, `fresh=${fresh.length} dup=${duplicateCount}`);
  }
  {
    const { fresh } = dropDuplicates("slip_tyfcb", [], new Set());
    check("empty payload -> nothing to insert", fresh.length === 0);
  }
}

rmSync(out, { recursive: true, force: true });
console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);