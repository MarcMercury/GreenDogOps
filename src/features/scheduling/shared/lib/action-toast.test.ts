import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-toastify", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "react-toastify";
import { toastInvalidForm, toastResult, toastThrown } from "@/features/scheduling/shared/lib/action-toast";

describe("toastResult", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("toasts a fixed success message and returns the result", () => {
    const res = toastResult({ ok: true as const, data: "id" }, "Saved");
    expect(res).toEqual({ ok: true, data: "id" });
    expect(toast.success).toHaveBeenCalledWith("Saved", expect.any(Object));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("derives the message from the result, and stays quiet on null", () => {
    toastResult({ ok: true as const, message: "Approved Ana." }, (r) => r.message);
    expect(toast.success).toHaveBeenCalledWith("Approved Ana.", expect.any(Object));
    toastResult({ ok: true as const }, null);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("toasts the action's own error text", () => {
    toastResult({ ok: false as const, error: "This pay period is locked." }, "Saved");
    expect(toast.error).toHaveBeenCalledWith("This pay period is locked.", expect.any(Object));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("has fixed wording for invalid forms and thrown errors", () => {
    toastInvalidForm();
    toastThrown(new Error("Failed to fetch"));
    toastThrown("not an error");
    expect(vi.mocked(toast.error).mock.calls.map((c) => c[0])).toEqual([
      "Please fix the highlighted fields.",
      "Failed to fetch",
      "Something went wrong.",
    ]);
  });
});
