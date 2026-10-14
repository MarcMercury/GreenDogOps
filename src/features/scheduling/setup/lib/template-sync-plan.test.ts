import { describe, expect, it } from "vitest";
import type { SchedShiftTemplate, SchedWeekLine } from "@/lib/schedule/types";
import { planTemplateWeekSync } from "./template-sync-plan";

const template = (
  id: string,
  department_id: string,
  extra: Partial<SchedShiftTemplate> = {},
): SchedShiftTemplate => ({
  id,
  department_id,
  role_id: null,
  label: null,
  start_time: "08:00:00",
  end_time: "17:00:00",
  sort_order: 10,
  is_active: true,
  ...extra,
});

const line = (
  id: string,
  template_id: string | null,
  department_id: string,
  extra: Partial<SchedWeekLine> = {},
): SchedWeekLine => ({
  id,
  week_id: "w",
  template_id,
  department_id,
  role_id: null,
  label: null,
  start_time: "08:00:00",
  end_time: "17:00:00",
  sort_order: 10,
  is_adhoc: false,
  ...extra,
});

describe("planTemplateWeekSync", () => {
  it("inserts a line for a template that has none, copying the template fields", () => {
    const plan = planTemplateWeekSync(
      "w",
      [],
      [template("t1", "d1", { role_id: "r1", label: "Lead" })],
      new Set(["d1"]),
    );
    expect(plan.toInsert).toEqual([
      {
        week_id: "w",
        template_id: "t1",
        department_id: "d1",
        role_id: "r1",
        label: "Lead",
        start_time: "08:00:00",
        end_time: "17:00:00",
        sort_order: 10,
      },
    ]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toRemove).toEqual([]);
  });

  it("re-syncs a drifted line and leaves a matching one alone", () => {
    const plan = planTemplateWeekSync(
      "w",
      [line("l1", "t1", "d1"), line("l2", "t2", "d1", { end_time: "18:00:00" })],
      [template("t1", "d1"), template("t2", "d1")],
      new Set(["d1"]),
    );
    expect(plan.toInsert).toEqual([]);
    expect(plan.toUpdate).toEqual([
      {
        id: "l2",
        patch: {
          department_id: "d1",
          role_id: null,
          label: null,
          start_time: "08:00:00",
          end_time: "17:00:00",
          sort_order: 10,
        },
      },
    ]);
    expect(plan.toRemove).toEqual([]);
  });

  it("removes duplicates, ad-hoc lines and lines whose template is gone or in an inactive department", () => {
    const plan = planTemplateWeekSync(
      "w",
      [
        line("l1", "t1", "d1"),
        line("l2", "t1", "d1"), // second line for the same template
        line("l3", null, "d1", { is_adhoc: true }),
        line("l4", "t-gone", "d1"),
        line("l5", "t2", "d2"), // d2 is not active
      ],
      [template("t1", "d1"), template("t2", "d2")],
      new Set(["d1"]),
    );
    expect(plan.toRemove.sort()).toEqual(["l2", "l3", "l4", "l5"]);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
  });

  it("falls back to the template's position when it has no sort_order", () => {
    const plan = planTemplateWeekSync(
      "w",
      [],
      [
        template("t1", "d1", { sort_order: undefined as unknown as number }),
        template("t2", "d1", { sort_order: undefined as unknown as number }),
      ],
      new Set(["d1"]),
    );
    expect(plan.toInsert.map((l) => l.sort_order)).toEqual([0, 1]);
  });
});
