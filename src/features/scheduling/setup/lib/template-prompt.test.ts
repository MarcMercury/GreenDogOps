import { describe, expect, it } from "vitest";
import type { SchedWeek } from "@/lib/schedule/types";
import { templatePromptConfig } from "@/features/scheduling/setup/lib/template-prompt";

const template = { id: "t1", title: "Summer rotation" } as SchedWeek;

describe("templatePromptConfig", () => {
  it("suggests a name for a new template", () => {
    expect(templatePromptConfig({ kind: "create" })).toEqual({
      title: "Name this template",
      defaultValue: "Standard Week",
      submitLabel: "Create",
      success: "Template created",
    });
  });

  it("starts a rename from the current name and a copy from “<name> (copy)”", () => {
    expect(templatePromptConfig({ kind: "rename", template }).defaultValue).toBe("Summer rotation");
    expect(templatePromptConfig({ kind: "duplicate", template }).defaultValue).toBe("Summer rotation (copy)");
    expect(templatePromptConfig({ kind: "duplicate", template: { ...template, title: null } }).defaultValue).toBe(
      "Template (copy)",
    );
  });
});
