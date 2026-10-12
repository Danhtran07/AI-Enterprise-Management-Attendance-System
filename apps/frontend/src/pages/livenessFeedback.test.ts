import { describe, expect, it } from "vitest";
import { challengeFeedback, LIVENESS_STEPS } from "../utils/livenessFeedback";

describe("liveness challenge feedback", () => {
  it("does not show a legacy head-turn instruction", () => {
    expect(challengeFeedback("BLINK", "Slowly turn your head to the LEFT"))
      .toBe("Vui lòng thực hiện thử thách đang hiển thị trên màn hình.");
  });

  it("uses blink and mouth instructions for their active challenges", () => {
    expect(challengeFeedback("BLINK")).toBe("Chớp mắt từ từ để tiếp tục.");
    expect(challengeFeedback("OPEN_MOUTH")).toBe("Mở miệng nhẹ và giữ trong giây lát để tiếp tục.");
    expect(LIVENESS_STEPS.map((step) => step.challenge)).toEqual(["BLINK", "OPEN_MOUTH"]);
  });

  it("does not let a stale detector instruction conflict with the active challenge", () => {
    expect(challengeFeedback("OPEN_MOUTH", "Please blink slowly"))
      .toBe("Mở miệng nhẹ và giữ trong giây lát để tiếp tục.");
  });

  it("shows consecutive mouth-open progress instead of appearing stuck", () => {
    expect(challengeFeedback("OPEN_MOUTH", "Open your mouth slightly (hold: 12/20)"))
      .toBe("Giữ miệng mở để xác minh (12/20)");
  });
});
