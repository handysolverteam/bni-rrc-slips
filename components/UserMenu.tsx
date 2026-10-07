"use client";

import { useAuth } from "@/context/AuthContext";

export default function UserMenu() {
  const { user, logout } = useAuth();

  if (!user) return null;

  const label = user.displayName || user.email || user.phoneNumber || "Member";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
      <span className="muted user-label" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
        {label}
      </span>
      <button type="button" onClick={() => void logout()} style={{ fontSize: 13, padding: "6px 12px" }}>
        Sign out
      </button>
    </div>
  );
}
