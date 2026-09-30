import type { LivenessState } from "../../types/liveness";

interface LivenessInstructionProps {
  state: LivenessState;
  feedback?: string;
}

function getInstruction(state: LivenessState): string {
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
      return "Đang chuẩn bị xác thực khuôn mặt...";
  }
}

export default function LivenessInstruction({
  state,
  feedback,
}: LivenessInstructionProps) {
  const isSuccess = state === "PASSED";
  const isError =
    state === "FAILED" ||
    state === "EXPIRED" ||
    state === "ERROR";

  return (
    <div
      className={[
        "rounded-xl border p-4 text-center",
        isSuccess
          ? "border-emerald-200 bg-emerald-50"
          : isError
            ? "border-red-200 bg-red-50"
            : "border-blue-100 bg-blue-50",
      ].join(" ")}
    >
      <p
        className={[
          "text-xs font-bold uppercase tracking-[0.16em]",
          isSuccess
            ? "text-emerald-600"
            : isError
              ? "text-red-600"
              : "text-blue-600",
        ].join(" ")}
      >
        {isSuccess ? "Xác thực hoàn tất" : "Xác thực khuôn mặt"}
      </p>

      <p className="mt-1 text-sm font-semibold text-slate-700">
        {getInstruction(state)}
      </p>

      {feedback &&
        feedback !== "Đang chuẩn bị xác thực khuôn mặt..." &&
        feedback !== getInstruction(state) && (
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {feedback}
          </p>
        )}
    </div>
  );
}
