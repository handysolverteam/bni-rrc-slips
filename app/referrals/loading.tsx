import { ListSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return (
    <ListSkeleton
      title="Slip Referrals"
      kind="referral"
      week
      rows={100}
      totalPages={2}
      badgeW={57}
      columns={[
        { key: "bni_week", label: "BNI Week" },
        { key: "from_name", label: "Referral From" },
        { key: "to_name", label: "Referral To" },
        { key: "other_chapter_member", label: "Other Member's Chapter" },
        { key: "inside_outside", label: "Inside Or Outside" },
      ]}
      filterable={[
        "from_name",
        "to_name",
        "other_chapter_member",
        "inside_outside",
      ]}
    />
  );
}
