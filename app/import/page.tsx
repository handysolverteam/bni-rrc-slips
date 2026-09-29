"use client";

import { useEffect, useState } from "react";
import ImportPanel from "@/components/ImportPanel";

type Batch = {
  id: string;
  filename: string;
  imported_count: number;
  skipped_count: number;
  status: string;
  created_at: string;
  bni_weeks: { label: string; meeting_date: string | null } | null;
};

export default function ImportPage() {
  const [batches, setBatches] = useState<Batch[]>([]);

  async function refreshHistory() {
    try {
      const res = await fetch("/api/import/batches");
      const data = await res.json();
      if (Array.isArray(data.batches)) setBatches(data.batches);
    } catch {
      // history simply stays as-is
    }
  }

  useEffect(() => {
    refreshHistory();
  }, []);

  return (
    <div>
      <ImportPanel onImported={refreshHistory} />

      <div className="card history-card">
        <h2>Imported weeks</h2>
        {batches.length === 0 ? (
          <p className="muted">No imports yet.</p>
        ) : (
          <div className="table-card">
            <div className="table-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Imported On</th>
                    <th>File</th>
                    <th>Week</th>
                    <th>Imported</th>
                    <th>Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td>{new Date(b.created_at).toLocaleString()}</td>
                      <td>{b.filename}</td>
                      <td>{b.bni_weeks?.label ?? "—"}</td>
                      <td>{b.imported_count}</td>
                      <td>{b.skipped_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
