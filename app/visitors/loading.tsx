import { ListSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return (
    <ListSkeleton
      title="Slip Visitors"
      kind="visitor"
      week
      rows={6}
      totalPages={1}
      badgeW={30}
      columns={[
        { key: "full_name", label: "Full Name" },
        { key: "company", label: "Company" },
        { key: "invited_by_name", label: "Invited By" },
        { key: "bni_week", label: "BNI Week" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Phone" },
      ]}
      filterable={[
        "full_name",
        "company",
        "invited_by_name",
        "email",
        "phone",
      ]}
    />
  );
}
