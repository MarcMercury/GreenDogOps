import type { TemplatePrompt } from "@/features/scheduling/setup/types/template-prompt";

export interface TemplatePromptConfig {
  title: string;
  defaultValue: string;
  submitLabel: string;
  success: string;
}

/** The wording of the name dialog for each of New / Rename / Duplicate. */
export function templatePromptConfig(prompt: TemplatePrompt): TemplatePromptConfig {
  switch (prompt.kind) {
    case "create":
      return {
        title: "Name this template",
        defaultValue: "Standard Week",
        submitLabel: "Create",
        success: "Template created",
      };
    case "rename":
      return {
        title: "Rename template",
        defaultValue: prompt.template.title ?? "",
        submitLabel: "Rename",
        success: "Template renamed",
      };
    case "duplicate":
      return {
        title: "Name for the copy",
        defaultValue: `${prompt.template.title ?? "Template"} (copy)`,
        submitLabel: "Duplicate",
        success: "Template duplicated",
      };
  }
}
