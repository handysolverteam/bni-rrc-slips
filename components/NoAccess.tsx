"use client";

/**
 * Signed in, but the Home Chapter auto-grant failed (its tenants row is
 * missing) or the operator only wants to add this uid to another chapter.
 * Prints the uid and the exact insert an operator runs in the Supabase SQL
 * editor. Normal first-time sign-ins never reach this screen.
 */
export default function NoAccess({ uid }: { uid: string }) {
  const sql = `insert into public.tenant_members (tenant_id, uid)
values ('d1000000-0000-4000-8000-000000000001', '${uid}')
on conflict do nothing;`;

  return (
    <main className="wrap">
      <div className="card" style={{ maxWidth: 680, margin: "48px auto", padding: 24 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>No chapter access yet</h1>
        <p className="muted" style={{ marginBottom: 16 }}>
          This account could not be granted a chapter automatically, and no chapter membership was
          found for it. Run the statement below in the Supabase SQL editor (edit the tenant id to
          the chapter you should belong to), then reload this page.
        </p>
        <p style={{ fontSize: 13, marginBottom: 4 }}>
          <strong>Your user id</strong>
        </p>
        <code style={{ display: "block", background: "#f3eee2", padding: "8px 10px", borderRadius: 6, marginBottom: 16, wordBreak: "break-all" }}>
          {uid}
        </code>
        <p style={{ fontSize: 13, marginBottom: 4 }}>
          <strong>Provisioning SQL</strong>
        </p>
        <pre
          style={{
            background: "#f3eee2",
            padding: "10px 12px",
            borderRadius: 6,
            fontSize: 13,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {sql}
        </pre>
        <button
          type="button"
          style={{ marginTop: 12, fontSize: 13, padding: "7px 14px" }}
          onClick={() => void navigator.clipboard.writeText(sql)}
        >
          Copy SQL
        </button>
      </div>
    </main>
  );
}
