import { redirect } from "next/navigation";
import { requirePageTenant } from "@/lib/server-auth";
import NoAccess from "@/components/NoAccess";
import ImportPage from "@/components/ImportPage";

export const dynamic = "force-dynamic";

/** Admin-only screen: members are sent home (the import APIs 403 too). */
export default async function ImportRoute() {
  const guard = await requirePageTenant();
  if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;
  if (guard.role !== "admin") redirect("/");
  return <ImportPage />;
}
