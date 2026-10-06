import { ListSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return (
    <ListSkeleton
      title="Slip CEU"
      kind="ceu"
      week
      rows={12}
      totalPages={1}
      badgeW={44}
      columns={[
        { key: "bni_week", label: "BNI Week" },
        { key: "member_name", label: "BNI Member" },
        { key: "credits", label: "CEU Credits" },
      ]}
      filterable={["member_name"]}
    />
  );
}
