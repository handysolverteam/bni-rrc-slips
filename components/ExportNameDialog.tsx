"use client";

import { useEffect, useRef, useState } from "react";
import { cleanFileName } from "@/lib/export-name";

/**
 * Asks for the file name before an export downloads. Starts on a name built
 * from the current filters (see lib/export-name.ts); the extension is fixed
 * and shown next to the box. Enter downloads, Escape / outside click cancels.
 */
export default function ExportNameDialog({
  defaultName,
  ext,
  onConfirm,
  onCancel,
}: {
  defaultName: string;
  /** "xlsx" | "csv" | "pdf" */
  ext: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);
  const clean = cleanFileName(value, ext);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="dialog-overlay" onClick={onCancel} role="presentation">
      <form
        className="dialog export-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Name the file"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) onConfirm(clean);
        }}
      >
        <h2>Name your {ext.toUpperCase()} file</h2>
        <p className="muted">It starts from the filters on screen — change it to anything you like.</p>
        <div className="export-name-row">
          <input
            ref={inputRef}
            aria-label="File name"
            value={value}
            maxLength={150}
            onChange={(e) => setValue(e.target.value)}
          />
          <span className="export-name-ext">.{ext}</span>
        </div>
        {!clean ? <p className="preview-warn">Type a file name.</p> : null}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!clean}>
            Download
          </button>
        </div>
      </form>
    </div>
  );
}
