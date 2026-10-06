import * as XLSX from "xlsx";

/**
 * Chat attachment support: spreadsheets cannot be sent to Gemini as files, so
 * they are converted to capped plain text server-side (the model reads it as a
 * regular text part). Caps keep a full weekly report inside the prompt budget.
 */
const MAX_ROWS = 200;
const MAX_CHARS = 20_000;

/** Base64 spreadsheet bytes (xls/xlsx/csv) → capped text for the model. */
export function spreadsheetToText(fileName: string, base64: string): string {
  const wb = XLSX.read(base64, { type: "base64" });
  const parts: string[] = [];
  let budget = MAX_CHARS;
  let truncated = false;

  for (const sheetName of wb.SheetNames) {
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const csv = XLSX.utils.sheet_to_csv(ws);
    const lines = csv.split("\n");
    if (lines.length > MAX_ROWS) truncated = true;
    let chunk = lines.slice(0, MAX_ROWS).join("\n");
    if (chunk.length > budget) {
      chunk = chunk.slice(0, budget);
      truncated = true;
    }
    budget -= chunk.length;
    parts.push(`--- Sheet: ${sheetName} ---\n${chunk}`);
  }

  if (parts.length === 0) throw new Error("workbook has no sheets");
  return (
    parts.join("\n\n") +
    (truncated ? "\n\n[attachment text truncated to fit the prompt]" : "")
  );
}
