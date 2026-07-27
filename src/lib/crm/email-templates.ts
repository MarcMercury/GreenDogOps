// =====================================================
// Email templates — shared types, variable catalog, and renderer.
//
// Used by:
//   * Admin > Templates (CRUD + variable reference)
//   * Referral CRM "Send Email" (fills a template from an account)
//
// This module is framework-agnostic (no server-only import) so the client
// compose dialog can render a live preview with the same logic the server
// uses when it actually sends.
// =====================================================

import {
  formatCurrency,
  formatDate,
  partnerName,
  getZoneDisplay,
  type ReferralPartner,
} from "./referral-types";
import type { CrmOrganization } from "./types";

export interface EmailTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  subject: string;
  body: string;
  is_active: boolean;
  created_by: string | null;
  created_by_email: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string | null;
}

/**
 * Template categories — which type of partner a template is written for. Admin
 * groups/labels templates by these, and each "Send Email" surface shows only
 * its own category (plus General).
 */
export const TEMPLATE_CATEGORIES: { value: string; label: string }[] = [
  { value: "referral", label: "Referral Partners" },
  { value: "rescue", label: "Rescues & Shelters" },
  { value: "general", label: "General" },
];

export function templateCategoryLabel(value: string): string {
  return TEMPLATE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** A placeholder that can appear in a template subject/body as {{token}}. */
export interface TemplateVariable {
  token: string; // without braces, e.g. "contact_first_name"
  label: string;
  description: string;
}

/**
 * Variables available to referral-account templates. Shown in the Admin
 * template editor as a reference and used to fill templates at send time.
 */
export const REFERRAL_TEMPLATE_VARIABLES: TemplateVariable[] = [
  { token: "account_name", label: "Account name", description: "The clinic / hospital name." },
  { token: "contact_name", label: "Contact name", description: "Primary contact's full name (falls back to “there”)." },
  { token: "contact_first_name", label: "Contact first name", description: "Primary contact's first name (falls back to “there”)." },
  { token: "contact_email", label: "Contact email", description: "Primary contact email on file." },
  { token: "phone", label: "Phone", description: "Account phone number." },
  { token: "website", label: "Website", description: "Account website." },
  { token: "address", label: "Address", description: "Account address." },
  { token: "tier", label: "Tier", description: "Partner tier (Platinum…Coal)." },
  { token: "zone", label: "Zone", description: "Geographic zone." },
  { token: "last_visit_date", label: "Last visit date", description: "Date of the most recent logged visit." },
  { token: "last_referral_date", label: "Last referral date", description: "Date of the most recent referral." },
  { token: "total_referrals", label: "Total referrals", description: "All-time referral count." },
  { token: "total_revenue", label: "Total revenue", description: "All-time referral revenue (formatted)." },
  { token: "relationship_health", label: "Relationship health", description: "Relationship health score (0–100)." },
  { token: "sender_name", label: "Sender name", description: "Your name (the signed-in user)." },
  { token: "sender_email", label: "Sender email", description: "Your email (reply-to)." },
  { token: "today", label: "Today's date", description: "Today's date." },
];

/** Values used to fill a template. Keys match TemplateVariable.token. */
export type TemplateVars = Record<string, string>;

/**
 * Replace every {{token}} in `text` with its value. Unknown or empty tokens
 * collapse to an empty string so a missing field never leaves "{{token}}" in
 * the sent email.
 */
export function renderTemplate(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, token: string) => {
    const v = vars[token];
    return v == null ? "" : v;
  });
}

/** Build the template variable map for a referral account. */
export function buildReferralTemplateVars(
  partner: ReferralPartner,
  sender: { name?: string | null; email?: string | null },
): TemplateVars {
  const contactFull = (partner.contact_name || partner.contact_person || "").trim();
  const firstName = contactFull ? contactFull.split(/\s+/)[0] : "there";

  return {
    account_name: partnerName(partner),
    contact_name: contactFull || "there",
    contact_first_name: firstName,
    contact_email: partner.email ?? "",
    phone: partner.phone ?? "",
    website: partner.website ?? "",
    address: partner.address ?? "",
    tier: partner.tier ?? "",
    zone: partner.zone ?? "",
    last_visit_date: formatDate(partner.last_visit_date),
    last_referral_date: formatDate(partner.last_referral_date),
    total_referrals: (partner.total_referrals_all_time ?? 0).toLocaleString(),
    total_revenue: formatCurrency(partner.total_revenue_all_time),
    relationship_health: String(partner.relationship_health ?? 0),
    sender_name: sender.name ?? "",
    sender_email: sender.email ?? "",
    today: formatDate(new Date().toISOString().slice(0, 10)),
  };
}

/**
 * Variables available to rescue / shelter templates. These map to fields on the
 * crm_organization record for a rescue account.
 */
export const RESCUE_TEMPLATE_VARIABLES: TemplateVariable[] = [
  { token: "account_name", label: "Rescue name", description: "The rescue / shelter organization name." },
  { token: "contact_name", label: "Contact name", description: "Primary contact's full name (falls back to “there”)." },
  { token: "contact_first_name", label: "Contact first name", description: "Primary contact's first name (falls back to “there”)." },
  { token: "contact_email", label: "Contact email", description: "Primary contact email on file." },
  { token: "phone", label: "Phone", description: "Rescue phone number." },
  { token: "address", label: "Address", description: "Rescue address." },
  { token: "area", label: "Area", description: "Geographic area / zone." },
  { token: "verified_adoptions", label: "Verified adoptions", description: "Verified adoption count on file." },
  { token: "agreement_status", label: "Agreement status", description: "Partnership agreement status." },
  { token: "last_visit_date", label: "Last visit date", description: "Date of the most recent logged visit." },
  { token: "last_contact_date", label: "Last contact date", description: "Date of the most recent contact." },
  { token: "sender_name", label: "Sender name", description: "Your name (the signed-in user)." },
  { token: "sender_email", label: "Sender email", description: "Your email." },
  { token: "today", label: "Today's date", description: "Today's date." },
];

/** Build the template variable map for a rescue / shelter account. */
export function buildRescueTemplateVars(
  org: CrmOrganization,
  sender: { name?: string | null; email?: string | null },
): TemplateVars {
  const contactFull = (org.contact_name || "").trim();
  const firstName = contactFull ? contactFull.split(/\s+/)[0] : "there";

  return {
    account_name: org.name ?? "",
    contact_name: contactFull || "there",
    contact_first_name: firstName,
    contact_email: org.email ?? "",
    phone: org.phone ?? "",
    address: org.address ?? "",
    area: org.area ? getZoneDisplay(org.area) : "",
    verified_adoptions: (org.verified_adoptions ?? 0).toLocaleString(),
    agreement_status: org.agreement_status ?? "",
    last_visit_date: formatDate(org.last_visit_date),
    last_contact_date: formatDate(org.last_contact_date),
    sender_name: sender.name ?? "",
    sender_email: sender.email ?? "",
    today: formatDate(new Date().toISOString().slice(0, 10)),
  };
}

/** Convert a plain-text body into simple HTML (paragraphs + line breaks). */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}
