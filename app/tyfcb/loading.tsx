import { ListSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return (
    <ListSkeleton
      title="Slip TYFCB"
      kind="tyfcb"
      week
      rows={94}
      totalPages={1}
      badgeW={44}
      columns={[
        { key: "bni_week", label: "BNI Week" },
        { key: "member_name", label: "BNI Member" },
        { key: "amount", label: "Amount" },
        { key: "other_chapter_member", label: "Other Member's Chapter" },
      ]}
      filterable={["member_name", "other_chapter_member"]}
    />
  );
}
