import { MODULES, type ModuleKey } from "../auth/permissions";

/** Emoji per module, used by the dashboard. Adding a ModuleKey must add an entry here. */
export const MODULE_ICONS: Record<ModuleKey, string> = {
  dashboard: "🏠",
  hr: "👥",
  ats: "🎯",
  marketing: "📣",
  crm_referral: "🏥",
  crm_vendor: "🤝",
  crm_supplies: "📦",
  crm_rescue: "🐕",
  crm_business: "🤝",
  crm_student: "🎓",
  crm_ce: "📋",
  crm_influencer: "⭐",
  email_templates: "✉️",
  reporting: "📈",
  emp_reporting: "💰",
  ezyvet: "🐾",
  planning: "🧭",
  schedule: "🗓️",
  calendar: "📅",
  med_boards: "🩺",
  resources: "📚",
  admin: "⚙️",
};

export const MODULE_LABELS = Object.fromEntries(MODULES.map((m) => [m.key, m.label])) as Record<ModuleKey, string>;

export const MODULE_HREFS = Object.fromEntries(MODULES.map((m) => [m.key, m.href])) as Record<ModuleKey, string>;

export function isModuleKey(v: string | null | undefined): v is ModuleKey {
  return !!v && v in MODULE_ICONS;
}
