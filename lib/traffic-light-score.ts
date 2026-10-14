/**
 * BNI "Member Traffic Light" scoring (100 points). Thresholds are the ones in bni-go-green-app
 * `scoringEngine.ts` (DEFAULTS) and reproduce every score in BNI's September '26 Excel
 * (538 of 539 component scores, 76 of 77 totals when fed the Excel's own rates).
 *
 * A metric earns the points of the HIGHEST tier whose threshold its value reaches.
 */
export type Tier = { t: number; pts: number };

export const TIERS = {
  attendance: [
    { t: 0.88, pts: 5 },
    { t: 0.96, pts: 10 },
  ],
  ceu: [
    { t: 0.000001, pts: 5 },
    { t: 0.500001, pts: 10 },
  ],
  oneToOne: [
    { t: 0.25, pts: 5 },
    { t: 0.5, pts: 10 },
    { t: 0.75, pts: 15 },
    { t: 1, pts: 20 },
  ],
  referrals: [
    { t: 0.25, pts: 5 },
    { t: 0.5, pts: 10 },
    { t: 0.75, pts: 15 },
    { t: 1, pts: 20 },
    { t: 1.25, pts: 25 },
  ],
  tyfcb: [
    { t: 1, pts: 1 },
    { t: 85000, pts: 2 },
    { t: 210000, pts: 3 },
    { t: 625000, pts: 4 },
    { t: 1250000, pts: 5 },
  ],
  visitors: [
    { t: 1, pts: 5 },
    { t: 2, pts: 10 },
    { t: 3, pts: 15 },
    { t: 4, pts: 20 },
    { t: 5, pts: 25 },
  ],
  sponsors: [{ t: 1, pts: 5 }],
} satisfies Record<string, Tier[]>;

export type MetricKey = keyof typeof TIERS;

/** Maximum points per metric (they add up to 100). */
export const MAX_POINTS: Record<MetricKey, number> = {
  attendance: 10,
  ceu: 10,
  oneToOne: 20,
  referrals: 25,
  tyfcb: 5,
  visitors: 25,
  sponsors: 5,
};

export function pointsFor(metric: MetricKey, value: number): number {
  let pts = 0;
  if (!Number.isFinite(value)) return 0;
  for (const tier of TIERS[metric]) if (value >= tier.t) pts = tier.pts;
  return pts;
}

export type LightColor = "green" | "amber" | "red" | "grey";

export const LIGHT_LABEL: Record<LightColor, string> = { green: "Green", amber: "Amber", red: "Red", grey: "Grey" };

/** Green ≥ 70, Amber 50–69, Red 30–49, Grey < 30. */
export function lightFor(total: number): LightColor {
  if (total >= 70) return "green";
  if (total >= 50) return "amber";
  if (total >= 30) return "red";
  return "grey";
}
