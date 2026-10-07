// Unit: dark/light theme — source-level checks on the pre-paint script, the
// toggle component(s), the light/dark palettes in app/globals.css, the
// surface-variable conversions, and the CSS Next.js actually emitted into
// .next/static (so the dark block really ships with the build).
//
// Run:  node tests/unit-theme.mjs   (from the repo root; run after `npm run build`)
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);

/** Extract a block (with balanced braces) that starts at `from` index. */
function extractBlock(css, startIndex) {
  if (startIndex === -1) return null;
  let depth = 0;
  for (let i = css.indexOf("{", startIndex); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(startIndex, i + 1);
    }
  }
  return null;
}

const css = read("../app/globals.css");

// 1) pre-paint script in the layout: stored choice -> OS preference -> applied
const layoutSrc = read("../app/layout.tsx");
for (const [name, needle] of [
  ["layout reads the stored theme", 'localStorage.getItem("bni-theme")'],
  ["layout falls back to the OS preference", 'prefers-color-scheme: dark'],
  ["layout sets data-theme", 'setAttribute("data-theme"'],
]) check(name, layoutSrc.includes(needle), needle);
check(
  "theme script renders before the app shell",
  layoutSrc.indexOf("themeInit") < layoutSrc.indexOf("<AuthProvider>") &&
    layoutSrc.indexOf("<script dangerouslySetInnerHTML") < layoutSrc.indexOf("<AuthProvider>"),
);

// 2) ThemeToggle component: persists, flips the attribute, syncs instances
const toggleSrc = read("../components/ThemeToggle.tsx");
for (const [name, needle] of [
  ["ThemeToggle is a client component", '"use client"'],
  ["ThemeToggle persists under bni-theme", 'localStorage.setItem(STORAGE_KEY, next)'],
  ["ThemeToggle flips the html attribute", 'setAttribute("data-theme", next)'],
  ["ThemeToggle broadcasts to sibling toggles", "bni-theme-change"],
  ["ThemeToggle labels the action", "`Switch to ${next} theme`"],
  ["ThemeToggle syncs from the DOM on mount", "document.documentElement.getAttribute(\"data-theme\")"],
]) check(name, toggleSrc.includes(needle), String(needle));
check(
  "ThemeToggle renders sun + moon glyphs",
  toggleSrc.includes('"☀"') && toggleSrc.includes('"☾"'),
);

// 3) both placements: top bar (desktop) + phone drawer
const shellSrc = read("../components/AppShell.tsx");
check(
  "AppShell imports and renders ThemeToggle in the top bar",
  shellSrc.includes('import ThemeToggle from "@/components/ThemeToggle"') &&
    shellSrc.indexOf("<TenantSwitcher") < shellSrc.indexOf("<ThemeToggle />") &&
    shellSrc.indexOf("<ThemeToggle />") < shellSrc.indexOf("<UserMenu />"),
);
const navSrc = read("../components/Nav.tsx");
check(
  "phone drawer carries its own ThemeToggle",
  navSrc.includes('import ThemeToggle from "@/components/ThemeToggle"') &&
    navSrc.includes('className="nav-drawer-foot"') &&
    navSrc.indexOf('className="nav-drawer-foot"') < navSrc.indexOf("<ThemeToggle />"),
);

// 4) light palette untouched + surface variables introduced
for (const [name, needle] of [
  ["light bg unchanged", "--bg: #f4f1ea;"],
  ["light card unchanged", "--card: #ffffff;"],
  ["light color-scheme declared", "color-scheme: light;"],
  ["panel var (was hardcoded #fff)", "--panel: #ffffff;"],
  ["surface var (was hardcoded #fffdf9)", "--surface: #fffdf9;"],
  ["field var (was hardcoded #d8d0bd)", "--field: #d8d0bd;"],
  ["chip var (was hardcoded #f3eee2)", "--chip: #f3eee2;"],
  ["chat log var (was hardcoded #faf7f1)", "--chat-log-bg: #faf7f1;"],
  ["topbar var (was hardcoded rgba white)", "--topbar-bg: rgba(255, 255, 255, 0.92);"],
  ["skeleton vars (were hardcoded grays)", "--skel-a: #e8e2d8;" ],
  ["ink var for danger red (was #8f2b1f)", "--ink-danger: #8f2b1f;"],
  ["per-hue ink var", "--accent-ink: #d6542c;"],
  ["sec-ink wired to the accent ink", "--sec-ink: var(--accent-ink);"],
]) check(name, css.includes(needle), needle);
for (const [name, needle] of [
  ["one-to-one sec-ink", '--sec-ink: var(--orange-ink);'],
  ["referral sec-ink", '--sec-ink: var(--green-ink);'],
  ["tyfcb sec-ink", '--sec-ink: var(--gold-ink);'],
  ["visitor sec-ink", '--sec-ink: var(--blue-ink);'],
  ["ceu sec-ink", '--sec-ink: var(--purple-ink);'],
]) check(name, css.includes(needle), needle);

// 5) dark block: attribute selector, full palette flip
const dark = extractBlock(css, css.indexOf('[data-theme="dark"]'));
check("dark block exists and is a real palette", !!dark && dark.length > 1500, `${dark?.length ?? 0} chars`);
for (const [name, needle] of [
  ["dark color-scheme", "color-scheme: dark;"],
  ["dark bg", "--bg: #16140f;"],
  ["dark card", "--card: #201d15;"],
  ["dark panel", "--panel: #27231a;"],
  ["dark ink", "--ink: #ece6d9;"],
  ["dark line", "--line: #3a352a;"],
  ["dark accent-soft tint", "--accent-soft: #3a2317;"],
  ["dark bright accent ink", "--accent-ink: #f08a5f;"],
  ["dark danger ink", "--ink-danger: #ff9c8a;"],
  ["dark scrollbar", "--scrollbar-thumb: #57503f;"],
  ["dark shadows", "--shadow: 0 1px 2px rgba(0, 0, 0, 0.35)"],
]) check(name, !!dark && dark.includes(needle), needle);

// 6) the hardcoded colours were actually converted to vars
for (const [name, needle] of [
  ["topbar background is a var", "background: var(--topbar-bg);"],
  ["table stripes are a var", "table.grid tbody tr:nth-child(even) { background: var(--surface-2); }"],
  ["chat log is a var", "background: var(--chat-log-bg);"],
  ["dialog panel is a var", "background: var(--panel); border-radius: 16px;"],
  ["skeleton shimmer is vars", "linear-gradient(90deg, var(--skel-a) 25%, var(--skel-b) 50%, var(--skel-a) 75%)"],
  ["empty-state pattern is a var", "var(--pattern) 14px 28px"],
  ["danger zone tint is a var", "background: var(--tint-danger);"],
  ["data-alert inks are vars", "border-color: var(--alert-warn-border); color: var(--ink-warn);"],
  ["pill text uses hue ink", "color: var(--green-ink); border-color: rgba(31, 138, 76, 0.25);"],
]) check(name, css.includes(needle), needle);

// 7) toggle button + placement styles
for (const [name, needle] of [
  ["theme-toggle button styled", ".theme-toggle {"],
  ["drawer foot styled", ".nav-drawer-foot {"],
]) check(name, css.includes(needle), needle);
const phone = extractBlock(css, css.indexOf("@media (max-width: 640px) {"));
check(
  "phone block hides the top-bar toggle",
  !!phone && phone.includes(".topbar .theme-toggle { display: none; }"),
);

// 8) trend chart reads the theme vars (flips live, no re-render)
const chartSrc = read("../components/TrendChart.tsx");
check(
  "TrendChart colours are CSS vars, not hexes",
  chartSrc.includes('"var(--orange-ink)"') &&
    !chartSrc.includes("#d35400") &&
    chartSrc.includes("style={{ stroke: color }}") &&
    chartSrc.includes("style={{ fill: color }}"),
);

// 9) NoAccess inline chip backgrounds themed
const noAccessSrc = read("../components/NoAccess.tsx");
check(
  "NoAccess code blocks use the chip var",
  noAccessSrc.includes('background: "var(--chip)"') && !noAccessSrc.includes("#f3eee2"),
);

// 10) the build actually shipped the theme CSS
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
  const flat = built.replace(/\s+/g, " ");
  const nospace = built.replace(/\s+/g, ""); // minifier drops " --bg: x" spacing
  check(".next static CSS found (run npm run build)", files.length > 0, `${files.length} file(s)`);
  check("built CSS ships the dark attribute block", /data-theme=(["']?)dark\1\]/.test(flat));
  check("built CSS ships the dark palette", nospace.includes("--bg:#16140f"));
  check("built CSS ships the theme toggle", flat.includes(".theme-toggle"));
  check("built CSS ships the surface vars", nospace.includes("--panel:#fff"));
}

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
