"use client";

type TenantOption = { id: string; name: string };

/**
 * Chapter switcher in the top bar. Picking a tenant validates the
 * membership server-side (POST /api/tenant sets the cookie) and reloads so
 * every server render re-scopes lists, weeks, report, import and chat.
 */
export default function TenantSwitcher({
  tenants,
  activeId,
}: {
  tenants: TenantOption[];
  activeId: string | null;
}) {
  if (tenants.length === 0) return null;

  async function switchTo(tenantId: string) {
    if (tenantId === activeId) return;
    const res = await fetch("/api/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId }),
    });
    if (res.ok) {
      try {
        sessionStorage.removeItem("bni-shell-v1"); // cached shell names the old chapter
      } catch {}
      window.location.reload();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    window.alert(data.error ?? "Could not switch chapter.");
  }

  if (tenants.length === 1) {
    return (
      <span className="tenant-switcher single" title="Active chapter">
        {tenants[0].name}
      </span>
    );
  }

  return (
    <select
      className="tenant-switcher"
      aria-label="Switch chapter"
      value={activeId ?? tenants[0].id}
      onChange={(e) => void switchTo(e.target.value)}
    >
      {tenants.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
