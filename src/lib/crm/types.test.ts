import { describe, expect, it } from "vitest";
import { canAccessModule, MODULES, type AppRole, type AppUser } from "../auth/permissions";
import { CRM_SECTIONS, crmModuleForSlug, crmSlugForContactType, crmSlugForOrg } from "./types";

function user(role: AppRole): AppUser {
  return {
    id: "u",
    email: "u@example.com",
    full_name: null,
    title: null,
    role,
    is_active: true,
    module_access: {},
    notes: null,
    person_id: "me",
    last_seen_at: null,
    created_at: "",
    updated_at: "",
  };
}

describe("crmModuleForSlug", () => {
  it("maps every CRM section to a real module", () => {
    const keys = new Set(MODULES.map((m) => m.key));
    for (const s of CRM_SECTIONS) {
      expect(keys.has(crmModuleForSlug(s.slug)), s.slug).toBe(true);
    }
  });

  it("puts Marketing Vendors under Marketing", () => {
    expect(crmModuleForSlug("marketing-vendor")).toBe("marketing");
  });

  // Shared /crm/contact and /crm/org record pages gate on these.
  it("lets Staff open Referral, Rescue, Non-Med and Supplies records only", () => {
    const staff = user("staff");
    const open = (slug: Parameters<typeof crmModuleForSlug>[0]) =>
      canAccessModule(staff, crmModuleForSlug(slug));
    expect(open(crmSlugForOrg({ org_type: "referral_clinic", subtype: null }))).toBe(true);
    expect(open(crmSlugForOrg({ org_type: "marketing_partner", subtype: "rescue" }))).toBe(true);
    expect(open(crmSlugForOrg({ org_type: "marketing_partner", subtype: null, category: "marketing" }))).toBe(true);
    expect(open(crmSlugForOrg({ org_type: "med_ops", subtype: null, category: null }))).toBe(true);
    expect(open(crmSlugForOrg({ org_type: "office_marketing", subtype: null, category: "marketing_vendor" }))).toBe(false);
    expect(open(crmSlugForContactType("student"))).toBe(false);
    expect(open(crmSlugForContactType("ce_attendee"))).toBe(false);
    expect(open("influencer")).toBe(false);
  });
});
