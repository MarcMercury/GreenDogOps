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
  // 3rd-party event intake details (Event Details template)
  arrival_time: string | null;
  departure_time: string | null;
  venue_type: string | null;
  event_url: string | null;
  host_company: string | null;
  host_website: string | null;
  expected_foot_traffic: string | null;
  involvement: string | null;
  setup_needs: string | null;
  parking_info: string | null;
  food_onsite: string | null;
  // Planning / promotion (events-management workflow)
  planning_phase: string | null;
  staff: string | null;
  supplies: string | null;
  promo_channels: string | null;
  landing_url: string | null;
  rsvp_url: string | null;
  checklist: ChecklistItem[];
  /** Editable Packing / Material list (defaults to the GD master template). */
  packing_list: PackingListGroup[];
  source_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  label: string;
  done: boolean;
}

// ---------------------------------------------------------------------------
// Packing / Material list (per-event, defaults to the GD master template)
// ---------------------------------------------------------------------------
/**
 * A single line on an event Packing / Material list. `status` tracks the item
 * through the procurement → pack pipeline (see PACKING_STATUSES): every item
 * starts at "need" and advances as it is decided on, ordered, received and
 * finally packed for the event.
 */
export interface PackingListItem {
  label: string;
  /** Free-form quantity ("x1", "5", "all we have", …) mirroring the master PDF. */
  qty: string | null;
  status: string;
  note: string | null;
}

/** A named section of a Packing / Material list (e.g. "Tents & Structure"). */
export interface PackingListGroup {
  group: string;
  items: PackingListItem[];
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
  /** Linked Vendor & Partner CRM record (crm_organization.id). */
  crm_organization_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Minimal CRM organization reference for linking Events Scout sources. */
export interface CrmOrgRef {
  id: string;
  name: string;
  org_type: string;
  subtype: string | null;
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
  username: string | null;
  password: string | null;
  credential_note: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * A single row inside a node's in-node list. This is where the granular reality
 * lives (e.g. "Adoptapalooza — Jun 13") so the tree itself stays a high-level
 * map of categories. Each item optionally links to a Calendar/CRM/Reporting
 * page or an external URL so contributors have everything a click away.
 */
export interface TreeItem {
  label: string;
  date: string | null;
  status: string | null;
  owner: string | null;
  url: string | null;
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
  items: TreeItem[];
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

export const VENUE_TYPES: Option[] = [
  { value: "indoor", label: "Indoor" },
  { value: "outdoor", label: "Outdoor" },
  { value: "mixed", label: "Indoor + Outdoor" },
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
// Packing / Material list status pipeline + master template
// ---------------------------------------------------------------------------
export const PACKING_STATUSES: Option[] = [
  { value: "need", label: "Need" },
  { value: "decided", label: "Decided" },
  { value: "ordered", label: "Ordered" },
  { value: "received", label: "Received" },
  { value: "packed", label: "Packed" },
];

/** Tailwind classes per packing status (pill / dot styling). */
export const PACKING_STATUS_STYLES: Record<string, string> = {
  need: "bg-slate-100 text-slate-600 border-slate-200",
  decided: "bg-amber-50 text-amber-700 border-amber-200",
  ordered: "bg-sky-50 text-sky-700 border-sky-200",
  received: "bg-violet-50 text-violet-700 border-violet-200",
  packed: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

/**
 * GD Event Master Packing List — the default, editable template every event
 * starts from. Derived and consolidated from `public/GD Event Master Packing
 * List.pdf`: the recurring per-event sections were deduped and organized into
 * a logical master any event can be trimmed down from. Every item defaults to
 * status "need"; `defaultPackingList()` returns a fresh deep copy.
 */
export const MASTER_PACKING_LIST: PackingListGroup[] = [
  {
    group: "Pre-Event Prep",
    items: [
      { label: "Update code on ezyVet", qty: null, status: "need", note: "Ongoing" },
      { label: "Update promotions list (home)", qty: null, status: "need", note: null },
      { label: "Update spin wheel offers / triangles", qty: null, status: "need", note: null },
      { label: "Print materials: Membership, UC, First Aid", qty: null, status: "need", note: null },
      { label: "Prep folders", qty: null, status: "need", note: null },
      { label: "Create & print coupons", qty: "20 → 5 pages", status: "need", note: "Cut before event" },
      { label: "Create landing page + Google questionnaire", qty: null, status: "need", note: "Connect spreadsheet" },
      { label: "Send logistics", qty: null, status: "need", note: null },
      { label: "Pharmacy code", qty: null, status: "need", note: null },
    ],
  },
  {
    group: "Tents & Structure",
    items: [
      { label: "Tents", qty: "x1", status: "need", note: "Check 2nd tent cover" },
      { label: "Sand / water bags", qty: "all we have", status: "need", note: null },
      { label: "10x10 GD promo sign", qty: "x1", status: "need", note: null },
      { label: "Half-size green tent side promo sign", qty: "x1", status: "need", note: null },
      { label: "Big Green PPPS structure (+ parts)", qty: "x1", status: "need", note: null },
      { label: "Black fabric 10x10 side cover", qty: "x1", status: "need", note: null },
      { label: "Curtains for first aid tent", qty: "x2", status: "need", note: null },
      { label: '"Ask me about my dog" photo backdrop canvas', qty: "x1", status: "need", note: null },
      { label: "A-frames (main GD services)", qty: null, status: "need", note: "Get in morning" },
      { label: "Membership banner", qty: "x1", status: "need", note: null },
      { label: "Chalkboard — First Aid / PPPS", qty: "x1", status: "need", note: null },
    ],
  },
  {
    group: "Tables & Seating",
    items: [
      { label: "Six-foot folding tables", qty: "x1", status: "need", note: null },
      { label: "Table covers — dark green", qty: "x1", status: "need", note: "Lime green backup" },
      { label: "First aid table (non-folding, for safety)", qty: "x1", status: "need", note: null },
      { label: "Stanchions & chains", qty: "x4 sets", status: "need", note: null },
      { label: "Folding chairs", qty: "x2", status: "need", note: null },
      { label: "Outdoor furniture — love seat + chairs", qty: null, status: "need", note: null },
      { label: "Clothing rack + hangers", qty: "10–15", status: "need", note: null },
    ],
  },
  {
    group: "Print Material",
    items: [
      { label: "Dental report cards", qty: null, status: "need", note: null },
      { label: "Internal medicine flyers", qty: null, status: "need", note: null },
      { label: "SO / VEN flyers", qty: null, status: "need", note: null },
      { label: "First aid pamphlets", qty: null, status: "need", note: null },
      { label: "Coupons for spin wheel — Free Exam", qty: null, status: "need", note: null },
      { label: "Coupons for spin wheel — $20 off services", qty: null, status: "need", note: null },
      { label: "Coupons for PPPS purchase", qty: null, status: "need", note: null },
      { label: "Sign-up QR codes", qty: null, status: "need", note: null },
      { label: "Referral program sign-ups", qty: "x1", status: "need", note: null },
      { label: "Acrylic displays 8x11", qty: null, status: "need", note: null },
      { label: "Acrylic displays 5x7", qty: null, status: "need", note: null },
      { label: "Prices for products / proud pet parents", qty: null, status: "need", note: null },
    ],
  },
  {
    group: "Promotional Items",
    items: [
      { label: "Spin wheel", qty: "x1", status: "need", note: "Check triangles for offers" },
      { label: "Spin to Win", qty: "x1", status: "need", note: null },
      { label: "Tote bags", qty: "1 box (~100)", status: "need", note: null },
      { label: "First aid kits", qty: "1 box", status: "need", note: null },
      { label: "Branded water bottles (stickered)", qty: "as many as ready", status: "need", note: null },
      { label: "Cooler with ice", qty: "x1", status: "need", note: "Buy ice" },
    ],
  },
  {
    group: "Merchandise / Products for Sale",
    items: [
      { label: "Dental Dust", qty: "x5", status: "need", note: null },
      { label: "Cat Smile", qty: "x5", status: "need", note: null },
      { label: "Smile Spray", qty: "x5", status: "need", note: null },
      { label: "Smile Wipes + bags", qty: null, status: "need", note: null },
      { label: "Quiet Time cards", qty: "x5", status: "need", note: null },
      { label: "PPPS merch — hats, bandanas", qty: null, status: "need", note: null },
      { label: "PPPS clothing — hoodies, t-shirts, hats, bandanas", qty: null, status: "need", note: null },
      { label: "GD product bags / PPPS bags", qty: null, status: "need", note: null },
      { label: "Square line items for all sale items", qty: null, status: "need", note: "Hoodies, shirts, hats, bandanas" },
    ],
  },
  {
    group: "Electronics",
    items: [
      { label: "Laptops", qty: "x1", status: "need", note: null },
      { label: "iPad", qty: "x1", status: "need", note: null },
      { label: "Charger blocks", qty: "x3", status: "need", note: "Charge the night before" },
      { label: "SquarePay", qty: "x1", status: "need", note: null },
    ],
  },
  {
    group: "First Aid Items",
    items: [
      { label: "Crash cart / box", qty: "x1", status: "need", note: null },
      { label: "Cooler with ice packs", qty: "x1", status: "need", note: null },
      { label: "Stethoscope", qty: "x1", status: "need", note: null },
      { label: "Thermometers", qty: null, status: "need", note: null },
      { label: "Towels", qty: null, status: "need", note: null },
      { label: "Fan", qty: "x1", status: "need", note: null },
      { label: "Spray bottles w/ water", qty: "x2 min", status: "need", note: null },
      { label: "IV fluids", qty: null, status: "need", note: null },
    ],
  },
  {
    group: "Misc",
    items: [
      { label: "Zip ties", qty: "x10", status: "need", note: null },
      { label: "Garbage bags", qty: "x4", status: "need", note: null },
      { label: "Garbage bins (small)", qty: "x2", status: "need", note: null },
      { label: "Scissors", qty: "x1", status: "need", note: null },
      { label: "Tape", qty: "x1", status: "need", note: null },
      { label: "Pens", qty: "a lot", status: "need", note: null },
      { label: "Paper towel roll", qty: "x1", status: "need", note: null },
      { label: "Pins", qty: null, status: "need", note: null },
      { label: "Dog treats + treat jar", qty: null, status: "need", note: null },
    ],
  },
  {
    group: "Still to Order",
    items: [
      { label: "Table cloths — dark green", qty: "x2", status: "need", note: null },
      { label: "Materials for inside first aid kits", qty: null, status: "need", note: null },
    ],
  },
];

/** Fresh deep copy of the master template (safe to mutate in component state). */
export function defaultPackingList(): PackingListGroup[] {
  return MASTER_PACKING_LIST.map((g) => ({
    group: g.group,
    items: g.items.map((i) => ({ ...i })),
  }));
}

// ---------------------------------------------------------------------------
// Marketing Tree
// ---------------------------------------------------------------------------
export type TreeZone =
  | "canopy"
  | "branch"
  | "trunk"
  | "root_primary"
  | "root_fine";

/**
 * Catalog of in-app destinations a node can be "connected" to. Powers the
 * smart connect picker in the node editor (suggestions come from keyword hits
 * against the node's label / zone / summary) and the icon shown on links.
 */
export interface AppDestination {
  label: string;
  url: string;
  icon: string;
  keywords: string[];
}

export const APP_DESTINATIONS: AppDestination[] = [
  { label: "Referral CRM", url: "/crm/referral", icon: "🏥", keywords: ["referral", "clinic", "hospital", "medical"] },
  { label: "Vendor & Partner CRM", url: "/crm/vendor", icon: "🤝", keywords: ["vendor", "partner", "chamber", "business", "grooming", "media", "dog ppl", "sponsor"] },
  { label: "Rescue / Shelter CRM", url: "/crm/rescue", icon: "🐕", keywords: ["rescue", "shelter", "adopt", "adoption"] },
  { label: "Influencer CRM", url: "/crm/influencer", icon: "⭐", keywords: ["influencer", "social", "content", "collab", "tiktok", "instagram"] },
  { label: "CE Leads / Events", url: "/crm/ce", icon: "📋", keywords: ["ce", "continuing education", "outreach", "dvm", "conference", "wet lab"] },
  { label: "Student CRM", url: "/crm/student", icon: "🎓", keywords: ["student", "extern", "school", "university"] },
  { label: "Calendar", url: "/calendar", icon: "📅", keywords: ["event", "calendar", "schedule", "date"] },
  { label: "Reporting", url: "/reporting", icon: "📈", keywords: ["report", "revenue", "production", "roi", "sales"] },
  { label: "Resources library", url: "/resources", icon: "📚", keywords: ["resource", "tool", "document", "policy", "flyer", "brochure", "signage", "print"] },
  { label: "HR / Roster", url: "/hr", icon: "👥", keywords: ["staff", "uniform", "employee", "onboarding", "appreciation", "engagement", "swag", "party"] },
  { label: "Scheduling", url: "/schedule", icon: "🗓️", keywords: ["schedule", "staffing", "shift"] },
  { label: "Marketing hub", url: "/marketing", icon: "📣", keywords: ["marketing", "promo", "campaign", "email", "sms", "mailchimp"] },
];

export function destinationForUrl(url: string): AppDestination | undefined {
  return APP_DESTINATIONS.find((d) => d.url === url);
}

/** Suggested destinations for a node, ranked by keyword hits (already-linked excluded). */
export function suggestDestinations(
  text: string,
  linkedUrls: string[],
): AppDestination[] {
  const hay = text.toLowerCase();
  const linked = new Set(linkedUrls);
  return APP_DESTINATIONS.map((d) => ({
    d,
    score: d.keywords.reduce((n, k) => (hay.includes(k) ? n + 1 : n), 0),
  }))
    .filter((x) => x.score > 0 && !linked.has(x.d.url))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.d);
}

export const TREE_ZONES: {
  value: TreeZone;
  label: string;
  group: "acquisition" | "retention";
  hint: string;
}[] = [
  { value: "canopy", label: "Categories", group: "acquisition", hint: "Attract categories — hold the item lists" },
  { value: "branch", label: "Attract pillars", group: "acquisition", hint: "Events · Campaigns · Social · Partnerships" },
  { value: "trunk", label: "Trunk", group: "acquisition", hint: "Brand core / daily essentials" },
  { value: "root_primary", label: "Retain pillars", group: "retention", hint: "Programs · Materials · Team & Ops" },
  { value: "root_fine", label: "Retain categories", group: "retention", hint: "Retention categories — hold the item lists" },
];

export const NODE_STATUSES: Option[] = [
  { value: "active", label: "Active" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "planning", label: "Planning" },
  { value: "dormant", label: "Dormant" },
  { value: "archived", label: "Archived" },
];

/** Status of an individual in-node list item (see TreeItem). */
export const ITEM_STATUSES: Option[] = [
  { value: "idea", label: "Idea" },
  { value: "planned", label: "Planned" },
  { value: "confirmed", label: "Confirmed" },
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
  { value: "hold", label: "On hold" },
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
export const venueTypeLabel = (v: string | null) => labelFor(VENUE_TYPES, v);
export const resourceCategoryLabel = (v: string | null) =>
  labelFor(RESOURCE_CATEGORIES, v);
export const nodeStatusLabel = (v: string | null) => labelFor(NODE_STATUSES, v);
export const itemStatusLabel = (v: string | null) => labelFor(ITEM_STATUSES, v);
export const promoStatusLabel = (v: string | null) => labelFor(PROMO_STATUSES, v);
export const promoTypeLabel = (v: string | null) => labelFor(PROMO_TYPES, v);
export const packingStatusLabel = (v: string | null) =>
  labelFor(PACKING_STATUSES, v);
export const treeZoneLabel = (v: string | null) => {
  if (!v) return "—";
  return TREE_ZONES.find((z) => z.value === v)?.label ?? v;
};
