"use client";

/**
 * "Add these people to the Home Chapter?" list shown in an import preview.
 * Every new member starts ticked; un-tick the ones that should not be added.
 * A name that looks like an existing member (middle initial, first initial,
 * a typo…) offers "Same person as …": picking it merges the spelling into
 * that member and the app remembers it, so the next import maps it silently.
 *
 * `skipped` = un-ticked names (sent as `skipMembers`); `merges` = { name:
 * existing member } (sent as `mergeMembers`).
 */
export default function NewMembersPicker({
  names,
  homeChapter,
  skipped,
  merges = {},
  similar = {},
  disabled,
  onChange,
  onMerge,
}: {
  names: string[];
  homeChapter: string;
  skipped: string[];
  merges?: Record<string, string>;
  similar?: Record<string, string[]>;
  disabled?: boolean;
  onChange: (skipped: string[]) => void;
  onMerge?: (name: string, into: string) => void;
}) {
  if (names.length === 0) return null;
  const off = new Set(skipped);
  const toggle = (n: string) => {
    const next = new Set(off);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    onChange([...next]);
  };
  const merged = names.filter((n) => merges[n]).length;
  const added = names.filter((n) => !off.has(n) && !merges[n]).length;
  return (
    <div className="new-members">
      <div className="new-members-head">
        <strong>
          {added} of {names.length} new member(s) will be added to {homeChapter}
          {merged > 0 ? ` · ${merged} merged into existing members` : ""}
        </strong>
        <span className="new-members-actions">
          <button type="button" className="mini-link" disabled={disabled} onClick={() => onChange([])}>
            Select all
          </button>
          <button type="button" className="mini-link" disabled={disabled} onClick={() => onChange([...names])}>
            Select none
          </button>
        </span>
      </div>
      <ul className="new-members-list">
        {names.map((n) => (
          <li key={n}>
            <label>
              <input
                type="checkbox"
                checked={!off.has(n) && !merges[n]}
                disabled={disabled || !!merges[n]}
                onChange={() => toggle(n)}
              />
              {n}
            </label>
            {onMerge && similar[n]?.length ? (
              <select
                className="merge-select"
                aria-label={`Is ${n} the same person as…`}
                value={merges[n] ?? ""}
                disabled={disabled}
                onChange={(e) => onMerge(n, e.target.value)}
              >
                <option value="">Add as a new member</option>
                {similar[n].map((s) => (
                  <option key={s} value={s}>
                    Same person as {s}
                  </option>
                ))}
              </select>
            ) : null}
          </li>
        ))}
      </ul>
      {onMerge && Object.keys(similar).length > 0 ? (
        <p className="muted new-members-hint">Merged names are remembered — future imports merge them automatically.</p>
      ) : null}
    </div>
  );
}
