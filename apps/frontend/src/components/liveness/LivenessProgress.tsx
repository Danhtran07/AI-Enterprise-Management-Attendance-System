import type { LivenessState } from "../../types/liveness";

interface LivenessProgressProps {
  state: LivenessState;
  blinkCompleted: boolean;
  mouthCompleted: boolean;
}

type StepStatus = "pending" | "active" | "completed";

function statusFor(
  step: "blink" | "mouth",
  state: LivenessState,
  completed: boolean,
): StepStatus {
  if (completed) return "completed";

  if (
    (step === "blink" && state === "BLINK_REQUIRED") ||
    (step === "mouth" && state === "MOUTH_REQUIRED")
  ) {
    return "active";
  }

  return "pending";
}

function Step({
  number,
  title,
  status,
}: {
  number: number;
  title: string;
  status: StepStatus;
}) {
  const styles = {
    completed: {
      wrapper: "border-emerald-200 bg-emerald-50",
      icon: "bg-emerald-500 text-white",
      status: "Hoàn thành",
    },
    active: {
      wrapper: "border-blue-300 bg-blue-50",
      icon: "bg-blue-500 text-white",
      status: "Đang thực hiện",
    },
    pending: {
      wrapper: "border-slate-200 bg-slate-50",
      icon: "bg-slate-200 text-slate-500",
      status: "Chưa thực hiện",
    },
  }[status];

  return (
    <div className={`rounded-xl border p-4 transition ${styles.wrapper}`}>
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-bold ${styles.icon}`}
          aria-hidden="true"
        >
          {status === "completed" ? "✓" : number}
        </div>

        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
            Bước {number}
          </p>
          <p className="font-semibold text-slate-800">{title}</p>
          <p className="mt-0.5 text-xs text-slate-500">{styles.status}</p>
        </div>
      </div>
    </div>
  );
}

export default function LivenessProgress({
  state,
  blinkCompleted,
  mouthCompleted,
}: LivenessProgressProps) {
  return (
    <section aria-label="Tiến độ xác thực khuôn mặt">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-800">
          Tiến độ xác thực
        </h2>
        <span className="text-xs text-slate-500">2 bước</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Step
          number={1}
          title="Chớp mắt"
          status={statusFor("blink", state, blinkCompleted)}
        />
        <Step
          number={2}
          title="Mở miệng rồi đóng lại"
          status={statusFor("mouth", state, mouthCompleted)}
        />
      </div>
    </section>
  );
}
