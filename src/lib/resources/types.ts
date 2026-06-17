// Resource library types + the policy quick-links ported from the EmployeeGMGDD
// wiki "Company Policies & Important Links" page (app/pages/wiki.vue).

export interface ResourceDocument {
  id: string;
  title: string;
  category: string;
  description: string | null;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  source_url: string | null;
  staff_only: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResourceDocumentWithUrl extends ResourceDocument {
  signed_url: string | null;
}

/** Display label + icon per document category. */
export const RESOURCE_CATEGORY_META: Record<
  string,
  { label: string; icon: string }
> = {
  hr: { label: "HR", icon: "👥" },
  safety: { label: "Safety", icon: "🦺" },
  operations: { label: "Operations", icon: "⚙️" },
  marketing: { label: "Marketing & Events", icon: "📣" },
  medical: { label: "Medical & Compliance", icon: "🩺" },
  recruiting: { label: "Recruiting", icon: "🎯" },
  training: { label: "Training", icon: "🎓" },
  forms: { label: "Forms", icon: "📝" },
  general: { label: "General", icon: "📄" },
};

export function resourceCategoryMeta(category: string): {
  label: string;
  icon: string;
} {
  return (
    RESOURCE_CATEGORY_META[category] ?? {
      label: category.charAt(0).toUpperCase() + category.slice(1),
      icon: "📄",
    }
  );
}

export function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Policy quick-links (external Google Docs) — mirrored from the GDD wiki.
// ---------------------------------------------------------------------------

export interface PolicyLink {
  name: string;
  url: string;
}

export interface PolicyCategory {
  title: string;
  icon: string;
  accent: string; // tailwind text color class
  links: PolicyLink[];
}

export const POLICY_CATEGORIES: PolicyCategory[] = [
  {
    title: "Employee Development",
    icon: "📈",
    accent: "text-emerald-700",
    links: [
      {
        name: "Roles & Responsibilities Lists",
        url: "https://docs.google.com/document/d/1OeZxk5pEDc4oHQxW0-QcCm41h2E-t9AWA4G_OQIV5pA/edit",
      },
      {
        name: "Core Attributes",
        url: "https://docs.google.com/document/d/12QrK1R-9QXiAx-nhuITHY-G6nmphEbbf1k6XarXYGX8/edit",
      },
      {
        name: "Compensation Overview",
        url: "https://docs.google.com/document/d/1p9t2Pzpp7CkeayTM8H9FS5CBE-LoJ7s8c2U8KgrLOlU/edit",
      },
      {
        name: "Employee Wellness",
        url: "https://docs.google.com/document/d/1cU2bH6OM0AlWb-w-tb-6-HXih2U9ZpiuDPHAV4LVzT8/edit",
      },
    ],
  },
  {
    title: "HR / Protocols / Policies",
    icon: "📋",
    accent: "text-teal-700",
    links: [
      {
        name: "GDD Master Protocols Sheet",
        url: "https://docs.google.com/document/d/1m_b6JW0ORuDbWrD_3i9jdLKGKpw1Lt02Odyan3fX5tI/edit",
      },
      {
        name: "GDD Continuing Education Policy",
        url: "https://docs.google.com/document/d/1RnIB7gLo_BdHgAj-79r8W1DFSF5jMdGEaCxcx8PfYW8/edit",
      },
      {
        name: "GDD Respectful Workplace Policy",
        url: "https://docs.google.com/document/d/1q9JjdcQnsA8lHQlWGjQyg0I2z7TqWw5h/edit",
      },
      {
        name: "GDD Employee Pet Policy",
        url: "https://docs.google.com/document/d/1QoMgpOhzGwVCjM6NiC4E1MaahDGhyORmHzCYX5Rd-Ps/edit",
      },
      {
        name: "GDD PTO/Sick Time/Unpaid Time Off Policy",
        url: "https://docs.google.com/document/d/1J8nq-cy3eWrOuixB8dMRJzxa7xiWrIKXu39Rgc7yuJM/edit",
      },
      {
        name: "Safety Manual",
        url: "https://docs.google.com/document/d/10WHDG-7kplVDYcQa4MDfLLZqsJHeyQF1/edit",
      },
      {
        name: "Pregnancy Safety",
        url: "https://docs.google.com/document/d/1G-rfxGC2zsEFShFeSen7CsbqjUAAy_Cn/edit",
      },
      {
        name: "GDD Urgent Care Locations and Injury Protocol",
        url: "https://docs.google.com/document/d/1_pqe4NlBTIy3ZYS1Y5obP_vAZfu-oWjnIJEnS9v8OKQ/edit",
      },
      {
        name: "Hazard Reporting Form",
        url: "https://docs.google.com/document/d/1qbre_4ymIMle3lf7pg1Tr87r3ULZ8ZN9/edit",
      },
      {
        name: "Review Process Policy",
        url: "https://docs.google.com/document/d/1brfUtwLOMU14MFx_25-sfrgbGvVOX2X27D9-ZnJuxTE/edit",
      },
      {
        name: "GDD Harassment Policy",
        url: "https://docs.google.com/document/d/1LxdmlY1mS4e8xzzO0KOtnieOYqJt4BbAJcZTC34JQ7Y/edit",
      },
      {
        name: "GDD Workplace Relationships Policy",
        url: "https://docs.google.com/document/d/1-WESyPVBW8Jt-oZCR7-qpdKtdVl-9oz31uynSC_w8KQ/edit",
      },
      {
        name: "Employee Covid Protocol",
        url: "https://docs.google.com/document/d/1oVnI1U_sgFZ9Y54TzQevoLLliuK8TCzGQsAjCPyzgxc/edit",
      },
      {
        name: "GDD Non-Employee Discounts",
        url: "https://docs.google.com/document/d/19CZDbS73rDokbLlu2iGc1-VfAm4cYzcK/edit",
      },
    ],
  },
  {
    title: "Disciplinary",
    icon: "⚠️",
    accent: "text-rose-700",
    links: [
      {
        name: "Call Outs and Tardiness Policy",
        url: "https://docs.google.com/document/d/1OERyRhaB-_e70jWw4pYGsUrbeje1GP1m/edit",
      },
      {
        name: "GDD Disciplinary Policy",
        url: "https://docs.google.com/document/d/1q9JjdcQnsA8lHQlWGjQyg0I2z7TqWw5h/edit",
      },
    ],
  },
];
