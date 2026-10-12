export const LIVENESS_STEPS = [
  { challenge: "BLINK", label: "Chớp mắt" },
  { challenge: "OPEN_MOUTH", label: "Mở miệng" },
] as const;

export function challengeLabel(challenge: string) {
  return LIVENESS_STEPS.find((step) => step.challenge === challenge)?.label
    || (challenge === "COMPLETE" ? "Đã xác minh" : "Đang kiểm tra khuôn mặt");
}

export function challengeFeedback(challenge: string, feedback?: string) {
  const normalized = (feedback || "").toLowerCase();
  if (normalized.includes("calibrate")) {
    return "Giữ mắt mở để hệ thống hiệu chỉnh, sau đó chớp mắt từ từ.";
  }
  if (/turn|yaw|rotate|head|quay mặt|xoay mặt/.test(normalized)) {
    return "Vui lòng thực hiện thử thách đang hiển thị trên màn hình.";
  }
  if (challenge === "BLINK" && /mouth|miệng/.test(normalized)) {
    return "Chớp mắt từ từ để tiếp tục.";
  }
  if (challenge === "OPEN_MOUTH" && /blink|chớp mắt/.test(normalized)) {
    return "Mở miệng nhẹ và giữ trong giây lát để tiếp tục.";
  }
  if (normalized.includes("no face") || normalized.includes("không tìm thấy khuôn mặt")) {
    return "Không thấy khuôn mặt. Hãy nhìn thẳng vào camera.";
  }
  if (challenge === "OPEN_MOUTH") {
    const holdProgress = normalized.match(/hold:\s*(\d+)\s*\/\s*20/);
    if (holdProgress) {
      return `Giữ miệng mở để xác minh (${holdProgress[1]}/20)`;
    }
  }
  if (challenge === "BLINK") return "Chớp mắt từ từ để tiếp tục.";
  if (challenge === "OPEN_MOUTH") return "Mở miệng nhẹ và giữ trong giây lát để tiếp tục.";
  if (challenge === "COMPLETE") return "Xác minh liveness thành công.";
  return feedback || "Giữ khuôn mặt trong khung hình và nhìn vào camera.";
}
