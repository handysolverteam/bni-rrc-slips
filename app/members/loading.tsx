import { ListSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return (
    <ListSkeleton
      title="Bni Member"
      week={false}
      rows={100}
      totalPages={7}
      badgeW={57}
      columns={[
        { key: "active", label: "Active" },
        { key: "name", label: "Name" },
        { key: "chapter", label: "Chapter" },
        { key: "category", label: "Category" },
        { key: "company", label: "Company" },
        { key: "phone", label: "Phone" },
      ]}
      filterable={["name", "category", "company", "phone"]}
    />
  );
}
