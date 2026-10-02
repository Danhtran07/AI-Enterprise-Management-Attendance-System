import { describe, expect, it } from "vitest";

import { matchShiftTemplate, SHIFT_TEMPLATES } from "./shiftTemplates";

describe("shift templates", () => {
  it("matches day office hours", () => {
    expect(matchShiftTemplate("08:00:00", "17:00:00")).toBe("day");
    expect(SHIFT_TEMPLATES.day.start).toBe("08:00");
  });

  it("matches night shift hours", () => {
    expect(matchShiftTemplate("16:00", "23:00")).toBe("night");
  });

  it("treats late starts as night", () => {
    expect(matchShiftTemplate("18:00:00", "02:00:00")).toBe("night");
  });
});
