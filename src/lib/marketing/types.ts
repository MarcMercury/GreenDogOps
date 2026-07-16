// Types & option constants for the Marketing Management hub (/marketing).
// Status / category values are enforced here in the app layer (the DB columns
// are free text) so we never hit CHECK-constraint case-mismatch issues.

export interface MarketingGoal {
  id: string;
  title: string;
  category: string | null;
  metric_unit: string | null;
  target_value: number | null;
  current_value: number | null;
  period: string | null;
  notes: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface InitiativeLink {
  label: string;
  url: string;
}

export interface MarketingInitiative {
  id: string;
  title: string;
  category: string;
  status: string;
  priority: string;
  owner_name: string | null;
  partner_name: string | null;
  next_action: string | null;
  due_date: string | null;
  notes: string | null;
  links: InitiativeLink[];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MarketingEvent {
  id: string;
  name: string;
  event_type: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  location: string | null;
  clinic_served: string | null;
  owner_name: string | null;
  cost: number | null;
  staff_needed: string | null;
  description: string | null;
  calendar_event_id: string | null;
  attendees: number | null;
  signups: number | null;
  appointments: number | null;
  products_sold: string | null;
  redemption_codes: string | null;
  coupons_redeemed: number | null;
  client_spend: number | null;
  feedback: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MarketingBudgetPeriod {
  id: string;
  year: number;
  total_budget: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketingBudgetEntry {
  id: string;
  entry_date: string;
  category: string | null;
  business: string | null;
  description: string | null;
  amount: number;
  paid_by: string | null;
  payment_method: string | null;
  status: string;
  receipt_submitted: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketingResource {
  id: string;
  name: string;
  category: string;
  url: string | null;
  description: string | null;
  owner_name: string | null;
  credential_note: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MarketingTreeNode {
  id: string;
  label: string;
  zone: string;
  parent_id: string | null;
  status: string;
  owner_name: string | null;
  due_date: string | null;
  links: InitiativeLink[];
  summary: string | null;
  metrics: Record<string, number | string>;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Option lists (value + label)
// ---------------------------------------------------------------------------
export interface Option {
  value: string;
  label: string;
}

export const INITIATIVE_CATEGORIES: Option[] = [
  { value: "events", label: "Events" },
  { value: "social", label: "Social & Content" },
  { value: "partnerships", label: "Partnerships" },
  { value: "referrals", label: "Referrals" },
  { value: "products", label: "Products & Merch" },
  { value: "pr", label: "PR & Media" },
  { value: "engagement", label: "Employee Engagement" },
  { value: "other", label: "Other" },
];

export const INITIATIVE_STATUSES: Option[] = [
  { value: "idea", label: "Idea" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

export const PRIORITIES: Option[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const EVENT_TYPES: Option[] = [
  { value: "hosted", label: "GD Hosted" },
  { value: "third_party", label: "3rd Party (GDD Hosted)" },
  { value: "tent", label: "Tent Set-up" },
  { value: "street_team", label: "Street Team / Flyering" },
  { value: "sponsorship", label: "Sponsorship / Donation" },
  { value: "city", label: "City Event" },
  { value: "vet_conference", label: "Vet Conference (CE)" },
  { value: "internal", label: "Internal / Staff" },
  { value: "awareness", label: "Awareness" },
];

export const EVENT_STATUSES: Option[] = [
  { value: "researching", label: "Researching" },
  { value: "tentative", label: "Tentative" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export const BUDGET_ENTRY_STATUSES: Option[] = [
  { value: "planned", label: "Planned" },
  { value: "paid", label: "Paid" },
  { value: "reimbursed", label: "Reimbursed" },
];

export const RESOURCE_CATEGORIES: Option[] = [
  { value: "tool", label: "Tool / Software" },
  { value: "portal", label: "Portal" },
  { value: "social", label: "Social Account" },
  { value: "document", label: "Document" },
  { value: "vendor", label: "Vendor" },
  { value: "membership", label: "Membership" },
];

// ---------------------------------------------------------------------------
// Marketing Tree
// ---------------------------------------------------------------------------
export type TreeZone =
  | "canopy"
  | "branch"
  | "trunk"
  | "root_primary"
  | "root_fine";

export const TREE_ZONES: {
  value: TreeZone;
  label: string;
  group: "acquisition" | "retention";
  hint: string;
}[] = [
  { value: "canopy", label: "Canopy", group: "acquisition", hint: "One-off / seasonal draws" },
  { value: "branch", label: "Branches", group: "acquisition", hint: "Core acquisition channels" },
  { value: "trunk", label: "Trunk", group: "acquisition", hint: "Daily essentials" },
  { value: "root_primary", label: "Primary roots", group: "retention", hint: "Core retention programs" },
  { value: "root_fine", label: "Fine roots", group: "retention", hint: "Individual retention tactics" },
];

export const NODE_STATUSES: Option[] = [
  { value: "active", label: "Active" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "planning", label: "Planning" },
  { value: "dormant", label: "Dormant" },
  { value: "archived", label: "Archived" },
];

/** Marketing-related CRM channels, linking to the existing modules. */
export const MARKETING_CHANNELS: {
  slug: string;
  label: string;
  icon: string;
  href: string;
  description: string;
}[] = [
  { slug: "referral", label: "Referral CRM", icon: "🏥", href: "/crm/referral", description: "Referring clinics & hospitals" },
  { slug: "vendor", label: "Vendor & Partner", icon: "🤝", href: "/crm/vendor", description: "Vendors, chambers & partners" },
  { slug: "rescue", label: "Rescue / Shelter", icon: "🐕", href: "/crm/rescue", description: "Rescue & shelter partners" },
  { slug: "influencer", label: "Influencers", icon: "⭐", href: "/crm/influencer", description: "Influencer partnerships" },
  { slug: "ce", label: "CE Leads/Events", icon: "📋", href: "/crm/ce", description: "Continuing-education outreach" },
  { slug: "calendar", label: "Calendar", icon: "📅", href: "/calendar", description: "Company & event calendar" },
];

function labelFor(options: Option[], value: string | null | undefined): string {
  if (!value) return "—";
  return options.find((o) => o.value === value)?.label ?? value;
}

export const initiativeCategoryLabel = (v: string | null) =>
  labelFor(INITIATIVE_CATEGORIES, v);
export const initiativeStatusLabel = (v: string | null) =>
  labelFor(INITIATIVE_STATUSES, v);
export const priorityLabel = (v: string | null) => labelFor(PRIORITIES, v);
export const eventTypeLabel = (v: string | null) => labelFor(EVENT_TYPES, v);
export const eventStatusLabel = (v: string | null) => labelFor(EVENT_STATUSES, v);
export const budgetStatusLabel = (v: string | null) =>
  labelFor(BUDGET_ENTRY_STATUSES, v);
export const resourceCategoryLabel = (v: string | null) =>
  labelFor(RESOURCE_CATEGORIES, v);
export const nodeStatusLabel = (v: string | null) => labelFor(NODE_STATUSES, v);
export const treeZoneLabel = (v: string | null) => {
  if (!v) return "—";
  return TREE_ZONES.find((z) => z.value === v)?.label ?? v;
};
