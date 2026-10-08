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
  ["phone lets the chart-type pills wrap (no page overflow)", ".trend-controls .trend-chart-tabs { flex: 1 1 auto; min-width: 0; }"],
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

// 9b) phone nav drawer: toggle in the bar, slide-in panel, desktop guard
check("phone shows hamburger toggle", !!phone && phone.includes(".nav-toggle { display: inline-flex; }"));
check("phone hides inline nav pills", !!phone && phone.includes(".topbar .nav-pills { display: none; }"));
const desktopGuard = extractMedia(css, "min-width: 641px");
check(
  "desktop guard hides drawer/toggle/overlay",
  !!desktopGuard && desktopGuard.includes(".nav-toggle, .nav-drawer, .nav-drawer-overlay { display: none; }"),
);
check(
  "drawer panel + open state styled",
  css.includes(".nav-drawer {") && css.includes(".nav-drawer.open { transform: none; visibility: visible; }"),
);
check("drawer overlay + hamburger styled", css.includes(".nav-drawer-overlay {") && css.includes(".nav-toggle {"));

const navSrc = read("../components/Nav.tsx");
check(
  "Nav toggle has aria wiring",
  navSrc.includes('className="nav-toggle"') && navSrc.includes("aria-expanded") && navSrc.includes('aria-controls="nav-drawer"'),
);
check(
  "drawer closes on Escape and route change",
  navSrc.includes('"Escape"') && navSrc.includes("setOpen(false), [pathname]"),
);
check("drawer locks body scroll while open", navSrc.includes('document.body.style.overflow = "hidden"'));
check(
  "Nav renders both pills and drawer links",
  navSrc.includes('className="nav-pills"') && navSrc.includes('className="nav-drawer-links"'),
);
check(
  "drawer + overlay portal past the topbar stacking context",
  navSrc.includes("createPortal(panel, document.body)"),
);
check(
  "portal mounts only after hydration",
  navSrc.includes("setMounted(true)") && navSrc.includes("mounted ? createPortal"),
);

// 9c) Slips dropdown (desktop pill + portaled menu + drawer accordion)
check(
  "Report pill renamed to Slip Report",
  navSrc.includes('label: "Slip Report"') && !navSrc.includes('label: "Report"'),
);
check(
  "Slips group carries the five list pages",
  ['href: "/one-to-ones"', 'href: "/referrals"', 'href: "/visitors"', 'href: "/tyfcb"', 'href: "/ceus"']
    .every((h) => navSrc.includes(h)) && navSrc.includes('label: "Slips"'),
);
check(
  "flat slip pills removed",
  !navSrc.includes('label: "Slip Referrals"') && !navSrc.includes('label: "Slip Visitors"') &&
  !navSrc.includes('label: "Slip TYFCB"'),
);
check(
  "desktop menu portals past the pill row's overflow",
  navSrc.includes('aria-haspopup="menu"') && navSrc.includes('aria-controls="nav-slips-menu"') &&
  navSrc.includes("nav-drop-menu-float"),
);
check(
  "drawer accordion for the Slips group",
  navSrc.includes('aria-controls="nav-slips-drawer-menu"') && navSrc.includes("nav-drop-in-drawer"),
);
for (const [name, needle] of [
  ["dropdown menu styled", ".nav-drop-menu {"],
  ["portaled menu fixed + above the topbar", ".nav-drop-menu-float { position: fixed; z-index: 200;"],
  ["hidden menu collapses", ".nav-drop-menu[hidden] { display: none; }"],
  ["drawer accordion styled", ".nav-drop-in-drawer {"],
  ["breakdown card styled", ".palms-stats-groups {"],
  ["breakdown groups stack on phone", ".palms-stats-groups { grid-template-columns: 1fr; gap: 14px; }"],
]) check(name, css.includes(needle), needle);

// 10) every table source sits inside a table-scroll wrapper
for (const f of ["../components/SlipsTable.tsx", "../components/ImportPage.tsx", "../app/palms/page.tsx"]) {
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
  check("built CSS ships the card-grid gap", flat.includes(".card+.cards") && flat.includes("margin-top:18px"));
  check("built CSS ships the slips dropdown", flat.includes(".nav-drop-menu") && flat.includes(".nav-drop-menu-float"));
  check("built CSS ships the breakdown card", flat.includes(".palms-stats-groups"));
}

// 12) stacked cards never touch + the week box can deselect all weeks
check(".card + .cards gap (report: upload panel -> stat cards)", css.includes(".card + .cards { margin-top: 18px; }"));
const filterSrc = read("../components/FilterBar.tsx");
check(
  "week box shows its clear (✕) button only for a real selection",
  filterSrc.includes('showClear={!!weekId && weekId !== "all"}'),
);

// 13) week + chapter dropdowns are single-select (report, palms, import, tables)
{
  const countOcc = (src, needle) => src.split(needle).length - 1;
  const reportSrc = read("../app/report/page.tsx");
  const palmsSrc = read("../app/palms/page.tsx");
  const impSrc = read("../components/ImportPage.tsx");
  const slipsSrc = read("../components/SlipsTable.tsx");
  check(
    "report: only the From/To/Detail header filter keeps multiSelect (Detail single)",
    countOcc(reportSrc, "multiSelect") === 1 && reportSrc.includes("multiSelect={key !== \"detail\"}"),
    `${countOcc(reportSrc, "multiSelect")} occurrence(s)`,
  );
  check("report: BNI Week cell present and single-select (the one conditional above)", reportSrc.includes('label="BNI Week"') && reportSrc.includes('allLabel="Universal"'));
  check("report: the week FilterBar no longer passes multiSelect", !reportSrc.includes("includeAllOption\n            hideSearch\n            multiSelect"));
  check("palms: week box is single-select", !palmsSrc.includes("multiSelect"));
  check("import history: Week column filter is single-select", !impSrc.includes("multiSelect"));
  check(
    "slips tables: week + chapter columns single, names still multi",
    slipsSrc.includes('multiSelect={c.key !== "bni_week" && c.key !== "chapter" && c.key !== "other_chapter_member"}'),
  );
  check("FilterBar week box is single-select (no multiple prop at all)", !filterSrc.includes("multiSelect"));
}

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
