import { classifySlipType, isCountLikeName, normalizeName } from "./report-import";
import type { ReportRow } from "./types";

/** Home chapter for blank-Detail / non-bold names. */
export function resolveHomeChapter(): string {
  return (
    normalizeName(process.env.NEXT_PUBLIC_CHAPTER_NAME || "BNI Influencer") ||
    "BNI Influencer"
  );
}

const detailChapter = (detail: string | null, home: string): string =>
  normalizeName(detail ?? "") || home;

export type DesiredChapters = Map<
  string,
  { name: string; chapter: string; strong: boolean }
>;

/**
 * Chapter each distinct name SHOULD live in, per the file:
 * bold + Detail -> that Detail chapter; everything else -> home.
 * Exception: TYFCB thanked members are always home (the Detail-chapter
 * person is the anonymous thanker); only a non-bold TYFCB thanker files
 * home, a bold one is skipped. A bold Detail signal upgrades
 * (strong=true); home never overwrites.
 * Pure function — shared by import and preview so both agree.
 */
export function computeDesiredChapters(
  rows: ReportRow[],
  home: string = resolveHomeChapter(),
): DesiredChapters {
  const desired: DesiredChapters = new Map();
  const want = (raw: string, chapter: string, strong: boolean): void => {
    const clean = normalizeName(raw);
    if (!clean || isCountLikeName(clean)) return;
    const k = clean.toLowerCase();
    const prev = desired.get(k);
    if (!prev) desired.set(k, { name: clean, chapter, strong });
    else if (strong && !prev.strong)
      desired.set(k, { name: prev.name, chapter, strong: true });
  };
  // Bold names resolve to their Detail chapter (or home when Detail is
  // blank); non-bold names always resolve to home.
  const wantName = (raw: string, isOther: boolean, detail: string | null): void =>
    want(
      raw,
      isOther ? detailChapter(detail, home) : home,
      isOther && detail !== null,
    );

  for (const r of rows) {
    const kind = classifySlipType(r.slipType);
    if (!kind) continue;
    const fromName = normalizeName(r.from);
    const toName = normalizeName(r.to);
    const detail = r.detail.trim() || null;
    if (kind === "referral" || kind === "one-to-one") {
      if (!fromName || !toName) continue;
      if (isCountLikeName(fromName) || isCountLikeName(toName)) continue;
      wantName(r.from, r.fromBold === true, detail);
      wantName(r.to, r.toBold === true, detail);
    } else if (kind === "tyfcb") {
      // TYFCB names file NO members at all (per owner instruction):
      // the thanked member's chapter is undecided and the thanker is
      // anonymous. Slips still store the raw names + flags for display.
      continue;
    } else if (kind === "visitor") {
      // Visitor guests never become members; only a non-bold inviter does.
      if (r.from && r.to && !isCountLikeName(fromName))
        wantName(r.from, r.fromBold === true, detail);
    } else {
      const name = fromName || toName;
      if (!name || isCountLikeName(name)) continue;
      wantName(
        r.from || r.to,
        fromName ? r.fromBold === true : r.toBold === true,
        detail,
      );
    }
  }
  return desired;
}
