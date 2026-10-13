import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  canAccessModule: vi.fn(),
  askSmartReport: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/auth/permissions", () => ({
  canAccessModule: mocks.canAccessModule,
  isAdminRole: () => false,
}));
vi.mock("@/lib/reporting/smart-scope", () => ({
  scopeForUser: (user: { role: string }) => ({ role: user.role }),
}));
vi.mock("@/lib/reporting/smart", () => ({ askSmartReport: mocks.askSmartReport }));
vi.mock("@/lib/reporting/ziggy-context", () => ({
  getAskerFacts: async () => null,
  formatAskerContext: () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: unknown) => {
        mocks.insert(row);
        return { select: () => ({ maybeSingle: async () => ({ data: { id: "log-1" } }) }) };
      },
    }),
  }),
}));

import { askSmartQuestion } from "./actions";

const staff = { id: "staff-1", role: "staff", module_access: {} };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccessModule.mockReturnValue(true);
  mocks.askSmartReport.mockResolvedValue({
    ok: true,
    answer: "42",
    sql: "select 42",
    rows: [],
    columns: [],
    rowCount: 1,
    truncated: false,
    provider: "test",
    attempts: [],
  });
});

describe("askSmartQuestion", () => {
  it("answers during a View-as preview with the previewed scope and never logs", async () => {
    mocks.requireUser.mockResolvedValue({
      email: "staff@example.com",
      appUser: staff,
      viewAs: { kind: "user", label: "Staff" },
    });

    const result = await askSmartQuestion("What was June revenue");

    expect(mocks.requireUser).toHaveBeenCalledWith({ allowPreview: true });
    expect(mocks.askSmartReport.mock.calls[0][2]).toEqual({ role: "staff" });
    expect(result).toMatchObject({ ok: true, answer: "42", logId: null });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("logs a normal question to the asker's history", async () => {
    mocks.requireUser.mockResolvedValue({ email: "staff@example.com", appUser: staff, viewAs: null });

    const result = await askSmartQuestion("What was June revenue");

    expect(result.logId).toBe("log-1");
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ app_user_id: "staff-1", question: "What was June revenue" }),
    );
  });

  it("returns, rather than throws, when the user lacks Ask Ziggy access", async () => {
    mocks.requireUser.mockResolvedValue({ email: "staff@example.com", appUser: staff, viewAs: null });
    mocks.canAccessModule.mockReturnValue(false);

    const result = await askSmartQuestion("anything");

    expect(result).toMatchObject({ ok: false, answer: "You do not have access to Ask Ziggy." });
    expect(mocks.askSmartReport).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
