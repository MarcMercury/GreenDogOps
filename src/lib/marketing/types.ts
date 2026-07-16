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
  // Planning / promotion (events-management workflow)
  planning_phase: string | null;
  staff: string | null;
  supplies: string | null;
  promo_channels: string | null;
  landing_url: string | null;
  rsvp_url: string | null;
  checklist: ChecklistItem[];
  source_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  label: string;
  done: boolean;
}

export interface MarketingEventSource {
  id: string;
  name: string;
  url: string | null;
  region: string | null;
  membership_cost: string | null;
  cadence: string | null;
  last_checked_on: string | null;
  active: boolean;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MarketingEventAttendee {
  id: string;
  event_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  attendee_type: string;
  is_new_client: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketingPromotion {
  id: string;
  name: string;
  placement: string | null;
  status: string;
  promo_type: string;
  duration_text: string | null;
  discount_text: string | null;
  discount_amount: number | null;
  product_code: string | null;
  ezyvet_line_item: string | null;
  how_to_redeem: string | null;
  promo_url: string | null;
  booking_url: string | null;
  rules: string | null;
  appointments: number | null;
  notes: string | null;
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
  owner_person_id: string | null;
  priority: string;
  budget_amount: number | null;
  budget_spent: number | null;
  budget_notes: string | null;
  last_handled_at: string | null;
  due_date: string | null;
  links: InitiativeLink[];
  summary: string | null;
  metrics: Record<string, number | string>;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** Minimal roster person for owner pickers. */
export interface PersonOption {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

export function personLabel(p: PersonOption): string {
  return (
    p.full_name ||
    [p.first_name, p.last_name].filter(Boolean).join(" ") ||
    "Unnamed"
  );
}

export interface MarketingActivity {
  id: string;
  kind: string;
  entity_type: string;
  entity_id: string | null;
  title: string;
  detail: string | null;
  actor: string | null;
  created_at: string;
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

export const PLANNING_PHASES: Option[] = [
  { value: "idea", label: "Idea" },
  { value: "researching", label: "Researching" },
  { value: "planning", label: "Planning" },
  { value: "prepping", label: "Prepping" },
  { value: "ready", label: "Ready" },
  { value: "wrapped", label: "Wrapped" },
];

export const ATTENDEE_TYPES: Option[] = [
  { value: "new_client", label: "New client" },
  { value: "returning", label: "Returning client" },
  { value: "lead", label: "Lead / contact" },
  { value: "vendor", label: "Vendor" },
  { value: "rescue", label: "Rescue" },
];

export const PROMO_STATUSES: Option[] = [
  { value: "active", label: "Active" },
  { value: "upcoming", label: "Upcoming" },
  { value: "expired", label: "Expired" },
];

export const PROMO_TYPES: Option[] = [
  { value: "standard", label: "Standard" },
  { value: "influencer", label: "Influencer code" },
  { value: "gift_certificate", label: "Gift certificate" },
  { value: "widget", label: "Booking widget" },
  { value: "event", label: "Event coupon" },
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
export const planningPhaseLabel = (v: string | null) =>
  labelFor(PLANNING_PHASES, v);
export const attendeeTypeLabel = (v: string | null) =>
  labelFor(ATTENDEE_TYPES, v);
export const resourceCategoryLabel = (v: string | null) =>
  labelFor(RESOURCE_CATEGORIES, v);
export const nodeStatusLabel = (v: string | null) => labelFor(NODE_STATUSES, v);
export const promoStatusLabel = (v: string | null) => labelFor(PROMO_STATUSES, v);
export const promoTypeLabel = (v: string | null) => labelFor(PROMO_TYPES, v);
export const treeZoneLabel = (v: string | null) => {
  if (!v) return "—";
  return TREE_ZONES.find((z) => z.value === v)?.label ?? v;
};
