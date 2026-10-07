// Unit: responsive layout (mobile ≤640px + iPad ≤1024px) — source-level checks
// on the media queries in app/globals.css, the structural wrappers they style,
// and the CSS Next.js actually emitted into .next/static (so the rules really
// ship with the build).
//
// Run:  node tests/unit-responsive.mjs   (from the repo root; run after `npm run build`)
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);

/** Extract a media block (with balanced braces) from a stylesheet. */
function extractMedia(css, query) {
  const start = css.indexOf(`@media (${query}) {`);
  if (start === -1) return null;
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  return null;
}

const css = read("../app/globals.css");
const phone = extractMedia(css, "max-width: 640px");
const tablet = extractMedia(css, "max-width: 1024px");

// 1) both breakpoints exist and are real blocks
check("media query ≤640px exists", !!phone && phone.length > 800, `${phone?.length ?? 0} chars`);
check("media query ≤1024px exists", !!tablet && tablet.length > 150, `${tablet?.length ?? 0} chars`);

// 2) phone block: top bar collapses (brand text + user label hidden, switcher capped)
for (const [name, needle] of [
  ["phone hides brand text", ".brand-name { display: none;"],
  ["phone hides user label", ".user-label { display: none;"],
  ["phone caps chapter switcher", "max-width: 110px"],
  ["phone shrinks top bar gap", ".topbar { gap: 10px"],
]) check(name, !!phone && phone.includes(needle), needle);

// 3) phone block: filters/forms lose their desktop min-widths
for (const [name, needle] of [
  ["report week combo goes full width", ".report-controls-row .filter-form .combo { min-width: 0; width: 100%; }"],
  ["report actions drop the divider", ".report-controls-row .report-actions { padding-left: 0; border-left: none; }"],
  ["search form min-width dropped", ".search-form { min-width: 0; }"],
]) check(name, !!phone && phone.includes(needle), needle);

// 4) phone block: desktop min-widths are untouched outside the media query
check("desktop report combo keeps 340px min-width", css.includes(".report-controls-row .filter-form .combo { min-width: 340px; }"));
check("desktop filter combo keeps 280px min-width", css.includes(".filter-form .combo { flex: 1 1 300px; min-width: 280px; max-width: 460px; }"));

// 5) phone block: iOS 16px input font (no zoom on focus) + card padding + dialog wrap
for (const [name, needle] of [
  ["phone inputs render at 16px", "input, select, textarea, .combo-input, .filter-form .combo-input, .chat-input textarea { font-size: 16px; }"],
  ["phone card padding (chat card excluded)", ".card:not(.chat-card) { padding: 16px; }"],
  ["phone dialog actions wrap", ".dialog-actions { flex-wrap: wrap; }"],
]) check(name, !!phone && phone.includes(needle), needle);

// 6) phone block: chart + skeleton pinned to the 960px viewBox width
for (const [name, needle] of [
  ["phone pins chart SVG to 960px", ".trend-svg-scroll > .trend-svg { width: 960px; }"],
  ["phone pins chart skeleton to 960px", ".trend-svg-scroll > .trend-skel { width: 960px; }"],
]) check(name, !!phone && phone.includes(needle), needle);

// 7) base styles: the scroll wrapper exists (desktop = no-op overflow)
check("trend scroll wrapper in base CSS", css.includes(".trend-svg-scroll {") && css.includes("overflow-x: auto; scrollbar-width: thin"));

// 8) tablet block: lighter tightening
for (const [name, needle] of [
  ["tablet shrinks wrap padding", ".wrap { padding: 24px 18px 64px; }"],
  ["tablet scales page title", ".page-head h1 { font-size: 25px; }"],
]) check(name, !!tablet && tablet.includes(needle), needle);

// 9) structure: viewport meta + component wrappers
const layoutSrc = read("../app/layout.tsx");
check(
  "layout exports device-width viewport",
  layoutSrc.includes("Viewport") && layoutSrc.includes('width: "device-width"') && layoutSrc.includes("initialScale: 1"),
);

const chartSrc = read("../components/TrendChart.tsx");
check(
  "TrendChart SVG wrapped in trend-svg-scroll",
  chartSrc.includes('className="trend-svg-scroll"') && chartSrc.indexOf('className="trend-svg-scroll"') < chartSrc.indexOf("<svg"),
);

const skelSrc = read("../components/Skeletons.tsx");
const homeSkel = skelSrc.slice(skelSrc.indexOf("export function HomeSkeleton"), skelSrc.indexOf("const REPORT_SECTIONS"));
check(
  "HomeSkeleton mirrors the chart wrapper",
  homeSkel.includes("trend-svg-scroll") && homeSkel.includes("trend-skel"),
);

const userSrc = read("../components/UserMenu.tsx");
check("UserMenu label carries user-label class", userSrc.includes('className="muted user-label"'));

// 10) every table source sits inside a table-scroll wrapper
for (const f of ["../components/SlipsTable.tsx", "../components/ImportPage.tsx", "../components/PalmsComparisonTable.tsx"]) {
  const src = read(f);
  const tags = [...src.matchAll(/<table[\s>]/g)].map((m) => m.index);
  const ok = tags.length > 0 && tags.every((i) => src.lastIndexOf("table-scroll", i) !== -1);
  check(`tables wrapped in table-scroll: ${f.split("/").pop()}`, ok, `${tags.length} <table> tag(s)`);
}

// 11) the build actually shipped the responsive CSS
{
  const dir = new URL("../.next/static/", import.meta.url);
  let files = [];
  try {
    files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".css"));
  } catch {
    files = [];
  }
  const built = files
    .map((f) => readFileSync(new URL(String(f).replace(/\\/g, "/"), dir), "utf8"))
    .join("\n");
  const flat = built.replace(/\s+/g, "");
  check(".next static CSS found (run npm run build)", files.length > 0, `${files.length} file(s)`);
  check("built CSS ships the 640px block", flat.includes("@media(max-width:640px)"));
  check("built CSS ships the 1024px block", flat.includes("@media(max-width:1024px)"));
  check("built CSS ships the trend scroll wrapper + 960px pin", flat.includes(".trend-svg-scroll") && flat.includes("width:960px"));
}

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
