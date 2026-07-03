/**
 * Onboarding checklist catalog for the Employee Profile → Onboarding tab.
 *
 * The catalog lives in code (not the database) so items can be added or
 * relabelled without a migration. Per-person state is stored in
 * `greendogops.person_onboarding_item`, keyed by the stable `key` below.
 *
 * Every item uses the same two-state model that matches how veterinary
 * onboarding actually flows: something is first *provided/sent* to the
 * employee, then it comes back *completed/signed/received*. Each state carries
 * an optional date so HR can see exactly when each step happened.
 */

export interface OnboardingItemLink {
  label: string;
  url: string;
}

export interface OnboardingItemDef {
  /** Stable key stored in the DB. Never rename once shipped. */
  key: string;
  label: string;
  /**
   * Label for the first checkbox (e.g. "Sent", "Provided"). Unused by the
   * "annual" group, which only tracks a single last-completed date.
   */
  providedLabel?: string;
  /** Label for the second checkbox (e.g. "Signed", "Completed"). */
  completedLabel?: string;
  /** Optional reference sheet/tracker link shown next to the item. */
  link?: OnboardingItemLink;
  /** Short helper shown under the item label. */
  help?: string;
}

export interface OnboardingGroupDef {
  title: string;
  items: OnboardingItemDef[];
}

/** A recurring-compliance track shown in the Onboarding tab's compliance log. */
export interface ComplianceTypeDef {
  /** Stable key stored in the DB. Never rename once shipped. */
  key: string;
  label: string;
  /** Short helper shown next to the track. */
  help?: string;
}

/**
 * Default compliance tracks for the Annual Compliance log. Each track keeps an
 * ongoing history of completed dates; HR can also add custom tracks in the app.
 */
export const COMPLIANCE_TYPES: ComplianceTypeDef[] = [
  {
    key: "sexual_harassment_training",
    label: "Sexual Harassment Training",
    help: "California requires harassment-prevention training within 6 months of hire, then every 2 years.",
  },
  {
    key: "safety_training",
    label: "Safety Training",
    help: "OSHA / hazard, controlled-substance and radiation-safety orientation.",
  },
];

/** External tracker for the employee Licenses & Expiration Dates list. */
export const LICENSES_TRACKER_LINK: OnboardingItemLink = {
  label: "GD – Licenses and Exp Dates",
  url: "https://docs.google.com/spreadsheets/d/1cILRaovf9bTOqgFtcDazK1ezKDVluB0HIokKvxxBgwU/edit?gid=0#gid=0",
};

export const ONBOARDING_GROUPS: OnboardingGroupDef[] = [
  {
    title: "Offer & Agreements",
    items: [
      {
        key: "offer_letter",
        label: "Offer Letter",
        providedLabel: "Sent",
        completedLabel: "Completed / Signed",
      },
      {
        key: "employee_contract",
        label: "Employee / Contractor Contract",
        providedLabel: "Sent",
        completedLabel: "Signed",
      },
      {
        key: "ce_contract",
        label: "Continuing Education Contract",
        providedLabel: "Sent",
        completedLabel: "Signed",
      },
      {
        key: "immigration_agreement",
        label: "Immigration Expense Agreement",
        providedLabel: "Sent",
        completedLabel: "Signed",
        help: "Only when sponsoring immigration expenses.",
      },
    ],
  },
  {
    title: "Policies & Compliance",
    items: [
      {
        key: "handbook",
        label:
          "Handbook, Content Release, Workplace Liability, HR Pamphlets & CPR Protocol",
        providedLabel: "Provided",
        completedLabel: "Signed",
      },
      {
        key: "harassment_pay",
        label: "Harassment Pay",
        providedLabel: "Provided",
        completedLabel: "Paid",
      },
      {
        key: "background_check",
        label: "Background Check",
        providedLabel: "Initiated",
        completedLabel: "Cleared",
      },
      {
        key: "emergency_contact",
        label: "Emergency Contact Info Form",
        providedLabel: "Sent",
        completedLabel: "Received",
      },
    ],
  },
  {
    title: "Onboarding, Benefits & Licensing",
    items: [
      {
        key: "benefits",
        label: "Benefits Enrollment",
        providedLabel: "Offered",
        completedLabel: "Completed",
        link: {
          label: "Benefits Tracker",
          url: "https://docs.google.com/spreadsheets/d/1l503igEObAaWPz4KlhfoqxkFgc5ZmB_mvjwC4aonsQY/edit?gid=250426221#gid=250426221",
        },
      },
    ],
  },
];

/** Flat list of every onboarding item, in display order. */
export const ONBOARDING_ITEMS: OnboardingItemDef[] = ONBOARDING_GROUPS.flatMap(
  (g) => g.items,
);

/** All stable item keys — used by the save action to iterate form fields. */
export const ONBOARDING_ITEM_KEYS: string[] = ONBOARDING_ITEMS.map(
  (i) => i.key,
);
