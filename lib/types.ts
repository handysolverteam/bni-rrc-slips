export type InsideOutside = "Inside" | "Outside";

export type ReportRow = {
  from: string;
  to: string;
  slipType: string;
  insideOutside: string;
  tyfcb: string;
  ceuCredits: string;
  detail: string;
  rowNumber: number;
  /** Bold in the source file = other-chapter person (xlsx imports only). */
  fromBold?: boolean;
  toBold?: boolean;
};

export type SlipKind = "referral" | "one-to-one" | "tyfcb" | "visitor" | "ceu";
