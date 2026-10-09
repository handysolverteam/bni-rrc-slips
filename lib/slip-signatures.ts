import { classifySlipType, isCountLikeName, mapInsideOutside, normalizeName, parseAmount } from "@/lib/report-import";
import type { SlipTable } from "@/lib/import-dedup";
import type { ReportRow } from "@/lib/types";

/**
 * The identity fields of every VALID report row, keyed like the slip tables
 * (`SIG_FIELDS` in lib/import-dedup.ts), so the import PREVIEW can tell how
 * many rows are already in the database without writing anything. Mirrors
 * the row rules of app/api/import/report/route.ts (rows the import would
 * reject — unknown type, missing names, numeric "names" — are left out here
 * too). Keep both in step; tests/e2e-import-members.mjs checks that the
 * preview's duplicate count equals a re-import's skip count.
 */
export function signatureRows(rows: ReportRow[]): Record<SlipTable, Record<string, unknown>[]> {
  const out: Record<SlipTable, Record<string, unknown>[]> = {
    slip_referrals: [],
    slip_one_to_ones: [],
    slip_tyfcb: [],
    slip_visitors: [],
    slip_ceus: [],
  };
  for (const r of rows) {
    const kind = classifySlipType(r.slipType);
    if (!kind) continue;
    const detail = r.detail.trim() || null;
    const fromName = normalizeName(r.from);
    const toName = normalizeName(r.to);
    if (kind === "referral" || kind === "one-to-one") {
      if (!fromName || !toName || isCountLikeName(fromName) || isCountLikeName(toName)) continue;
      if (kind === "referral") {
        out.slip_referrals.push({
          from_name: fromName,
          to_name: toName,
          other_chapter_member: detail,
          inside_outside: mapInsideOutside(r.insideOutside),
          from_is_other_chapter: r.fromBold === true,
          to_is_other_chapter: r.toBold === true,
        });
      } else {
        out.slip_one_to_ones.push({
          initiated_by_name: fromName,
          met_with_name: toName,
          other_chapter_member: detail,
          initiated_by_is_other_chapter: r.fromBold === true,
          met_with_is_other_chapter: r.toBold === true,
        });
      }
    } else if (kind === "tyfcb") {
      const name = toName || fromName;
      if (!name || isCountLikeName(name)) continue;
      const thankerRaw = isCountLikeName(fromName) ? "" : fromName;
      out.slip_tyfcb.push({
        member_name: name,
        amount: parseAmount(r.tyfcb),
        other_chapter_member: detail,
        thanker_name: thankerRaw || null,
        thanker_is_other_chapter: thankerRaw ? r.fromBold === true : detail !== null,
      });
    } else if (kind === "visitor") {
      const fullName = toName || fromName;
      if (!fullName || isCountLikeName(fullName)) continue;
      out.slip_visitors.push({
        full_name: fullName,
        invited_by_name: r.from && r.to && !isCountLikeName(fromName) ? fromName : null,
      });
    } else {
      const name = fromName || toName;
      if (!name || isCountLikeName(name)) continue;
      out.slip_ceus.push({ member_name: name, credits: parseAmount(r.ceuCredits) });
    }
  }
  return out;
}
