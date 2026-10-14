import type { SubTab } from "@/features/scheduling/setup/types/sub-tab";

export const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "departments", label: "Departments" },
  { key: "roles", label: "Roles & Eligibility" },
  { key: "shifts", label: "Dept/Shift Template" },
  { key: "week-template", label: "Week Template" },
  { key: "planning-guide", label: "Planning Guide Setup" },
  { key: "employees", label: "Employees" },
  { key: "locations", label: "Locations" },
];
