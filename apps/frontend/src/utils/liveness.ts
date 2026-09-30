import type {
  LivenessMessage,
  LivenessState,
} from "../types/liveness";

export function getLivenessInstruction(
  state: LivenessState,
): string {
  switch (state) {
    case "STARTING":
      return "Đang khởi tạo xác thực...";

    case "WAITING_FOR_FACE":
      return "Vui lòng đưa khuôn mặt vào giữa khung.";

    case "BLINK_REQUIRED":
      return "Vui lòng chớp mắt.";

    case "MOUTH_REQUIRED":
      return "Mở miệng rồi đóng lại.";

    case "PASSED":
      return "Xác thực khuôn mặt thành công.";

    case "FAILED":
      return "Xác thực thất bại. Vui lòng thử lại.";

    case "EXPIRED":
      return "Phiên xác thực đã hết hạn. Vui lòng thử lại.";

    case "ERROR":
      return "Có lỗi xảy ra trong quá trình xác thực.";

    default:
      return "Đang chuẩn bị xác thực...";
  }
}

export function normalizeLivenessState(
  challenge?: string,
): LivenessState | null {
  switch (challenge) {
    case "WAITING_FOR_FACE":
      return "WAITING_FOR_FACE";

    case "BLINK":
    case "BLINK_REQUIRED":
      return "BLINK_REQUIRED";

    case "MOUTH_OPEN":
    case "MOUTH_REQUIRED":
      return "MOUTH_REQUIRED";

    case "COMPLETE":
    case "PASSED":
      return "PASSED";

    case "FAILED":
      return "FAILED";

    case "EXPIRED":
      return "EXPIRED";

    default:
      return null;
  }
}

export function getLivenessErrorMessage(
  message: LivenessMessage,
): string {
  const code = message.error_code || message.error;

  switch (code) {
    case "NO_FACE":
      return "Không tìm thấy khuôn mặt. Vui lòng đưa khuôn mặt vào giữa khung.";

    case "MULTIPLE_FACES":
      return "Phát hiện nhiều khuôn mặt. Vui lòng chỉ để một người trong khung hình.";

    case "FACE_OUT_OF_FRAME":
      return "Khuôn mặt đang nằm ngoài khung. Vui lòng di chuyển vào giữa.";

    case "LOW_QUALITY":
      return "Hình ảnh khuôn mặt chưa đủ rõ. Vui lòng điều chỉnh vị trí và ánh sáng.";

    case "LOW_LIGHT":
      return "Ánh sáng quá yếu. Vui lòng di chuyển đến nơi có đủ ánh sáng.";

    case "SPOOF_DETECTED":
      return "Không thể xác minh khuôn mặt thật. Vui lòng thử lại.";

    default:
      return (
        message.feedback ||
        message.error ||
        "Xác thực khuôn mặt thất bại. Vui lòng thử lại."
      );
  }
}