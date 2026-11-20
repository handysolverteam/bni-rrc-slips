/**
 * Generic grounding check for chat answers (pure, no imports so tests can compile it alone).
 *
 * The model must only COPY what the tools returned. After it answers, every numbered list line, heading count and
 * TOTAL line is checked against the tool results of the same turn:
 *   - a name on a list line must be a name the tools returned (no invented / filler members),
 *   - every number on a list or TOTAL line must be a number the tools returned,
 *   - a heading like "Group (N Members)" must be followed by exactly N lines,
 *   - when the tools returned a group (a band / a power team) with a matching label, the block's names must all belong
 *     to that group (catches members moved between groups).
 * Anything else in the answer (prose, filters line, follow-up question) is not checked.
 */

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

export type Facts = {
  strings: Set<string>;
  numbers: Set<number>;
  /** Groups the tools returned: a label plus the member names inside (bands[], teams[]). */
  groups: { label: string; names: Set<string> }[];
};

const toNum = (raw: string): number => Number(raw.replace(/,/g, ""));

/** Everything the tool results contain: every string, every number (also digits inside strings, e.g. dates) and groups. */
export function collectFacts(results: unknown[]): Facts {
  const facts: Facts = { strings: new Set(), numbers: new Set(), groups: [] };
  const addDigits = (s: string) => {
    for (const m of s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
      const n = toNum(m);
      if (Number.isFinite(n)) facts.numbers.add(n);
    }
  };
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      facts.strings.add(norm(v));
      addDigits(v);
    } else if (typeof v === "number") {
      if (Number.isFinite(v)) facts.numbers.add(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const label = typeof o.band === "string" ? o.band : typeof o.team === "string" ? o.team : null;
      if (label !== null && Array.isArray(o.members)) {
        const names = new Set<string>();
        for (const m of o.members) {
          const n = typeof m === "string" ? m : m && typeof m === "object" ? (m as Record<string, unknown>).name : null;
          if (typeof n === "string") names.add(norm(n));
        }
        facts.groups.push({ label: norm(label), names });
      }
      for (const x of Object.values(o)) walk(x);
    }
  };
  for (const r of results) walk(r);
  return facts;
}

const LINE = /^\s*(\d{1,3})\.\s+(.+?)\s*$/;
const HEADING = /^(.*?)\s*\((\d[\d,]*)\s+(?:members?|member\(s\))\)\s*$/i;

function cleanName(raw: string): { name: string; rest: string } {
  // "Name – value" / "Name - value" / "Name: value"; trailing "(inactive)" style notes are dropped.
  const m = raw.match(/^(.*?)(?:\s+[–—-]\s+|:\s+)(.+)$/);
  const name = (m ? m[1] : raw).replace(/\s*\([^)]*\)\s*$/, "");
  return { name: norm(name), rest: m ? m[2] : "" };
}

/** Human-readable problems found in `answer` (empty = it is consistent with the tool results). */
export function findProblems(answer: string, facts: Facts): string[] {
  const problems: string[] = [];
  const lines = answer.split("\n");
  const known = (name: string): boolean => {
    if (facts.strings.has(name)) return true;
    for (const s of facts.strings) if ((s.startsWith(name) || name.startsWith(s)) && name.length >= 4 && s.length >= 4) return true;
    return false;
  };

  let heading: { text: string; count: number; label: string } | null = null;
  let block: string[] = [];
  const closeBlock = () => {
    if (heading) {
      if (block.length !== heading.count) {
        problems.push(`"${heading.text}" says ${heading.count} but lists ${block.length} lines`);
      }
      // A block must be exactly one group the tools returned (a band / a power team): members moved in from another
      // group, or several groups merged into one block, are caught by comparing with the group it overlaps most.
      if (facts.groups.length > 0 && block.length > 0) {
        let best: { names: Set<string> } | null = null;
        let bestHit = 0;
        for (const g of facts.groups) {
          const hit = block.filter((n) => g.names.has(n)).length;
          if (hit > bestHit) {
            best = g;
            bestHit = hit;
          }
        }
        if (best && bestHit >= 1) {
          const stray = block.filter((n) => !best!.names.has(n));
          if (stray.length) problems.push(`"${heading.text}" mixes members of different groups (${stray.slice(0, 4).join(", ")} belong elsewhere)`);
          else if (best.names.size !== block.length) problems.push(`"${heading.text}" lists ${block.length} of the ${best.names.size} members of that group`);
        }
      }
    }
    heading = null;
    block = [];
  };

  for (const raw of lines) {
    const h = raw.match(HEADING);
    if (h && !LINE.test(raw)) {
      closeBlock();
      heading = { text: raw.trim(), count: toNum(h[2]), label: norm(h[1]) };
      continue;
    }
    const l = raw.match(LINE);
    if (l) {
      const { name, rest } = cleanName(l[2]);
      // Outside a headed block only "Name – number" lines are list lines; other numbered text (steps, advice) is prose.
      if (!heading && !/d/.test(rest)) continue;
      if (!known(name)) problems.push(`"${l[2].slice(0, 60)}" is not a name the data returned`);
      for (const m of rest.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
        const n = toNum(m);
        if (!facts.numbers.has(n)) problems.push(`the number ${m} on "${l[2].slice(0, 50)}" is not in the data`);
      }
      if (heading) block.push(name);
      continue;
    }
    if (/^\s*total\b/i.test(raw)) {
      for (const m of raw.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
        const n = toNum(m);
        if (!facts.numbers.has(n)) problems.push(`the total figure ${m} in "${raw.trim().slice(0, 60)}" is not in the data`);
      }
    }
    if (raw.trim() === "" || /^filters applied/i.test(raw.trim())) closeBlock();
    else if (heading && !LINE.test(raw) && !HEADING.test(raw)) closeBlock();
  }
  closeBlock();
  // De-duplicate, keep the message short enough to send back to the model.
  return [...new Set(problems)].slice(0, 8);
}
