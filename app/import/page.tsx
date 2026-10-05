import { requirePageTenant } from "@/lib/server-auth";
import NoAccess from "@/components/NoAccess";
import ImportPage from "@/components/ImportPage";

export const dynamic = "force-dynamic";

/** Every member of the chapter can import (roles were removed). */
export default async function ImportRoute() {
  const guard = await requirePageTenant();
  if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;
  return <ImportPage />;
}
