"use client";

import CopyButton from "@/components/CopyButton";
import { rankingShareUrl } from "@/lib/visitor-ranking-share";

/** One-click WhatsApp share of the ranking: opens wa.me with the text prefilled — the member picks the
    recipient and presses send (nothing is sent by the app). */
export default function VisitorRankShare({ text }: { text: string }) {
  return (
    <span className="share-actions">
      <button
        type="button"
        className="wa-btn"
        onClick={() => window.open(rankingShareUrl(text), "_blank", "noopener,noreferrer")}
      >
        Share on WhatsApp
      </button>
      <CopyButton text={text} />
    </span>
  );
}
