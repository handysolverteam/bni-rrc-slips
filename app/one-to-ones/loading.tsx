import { ListSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return (
    <ListSkeleton
      title="Slip 121"
      kind="one-to-one"
      week
      rows={62}
      totalPages={1}
      badgeW={44}
      columns={[
        { key: "bni_week", label: "BNI Week" },
        { key: "initiated_by_name", label: "Initiated By" },
        { key: "met_with_name", label: "Met With" },
        { key: "other_chapter_member", label: "Other Member's Chapter" },
      ]}
      filterable={[
        "initiated_by_name",
        "met_with_name",
        "other_chapter_member",
      ]}
    />
  );
}
