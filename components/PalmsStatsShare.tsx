"use client";

import { palmsStatsShareUrl } from "@/lib/palms-share";

/** Opens WhatsApp with the rolling-period summary prefilled; the member picks
    the recipient and presses send (nothing is transmitted by the app). */
export default function PalmsStatsShare({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="wa-btn"
      onClick={() => window.open(palmsStatsShareUrl(text), "_blank", "noopener,noreferrer")}
    >
      Send on WhatsApp
    </button>
  );
}
