import type { LivenessState } from "../../types/liveness";
import LivenessInstruction from "./LivenessInstruction";
import LivenessProgress from "./LivenessProgress";

interface LivenessPanelProps {
  state: LivenessState;
  feedback?: string;
  blinkCompleted: boolean;
  mouthCompleted: boolean;
}

function getWarning(feedback: string | undefined, state: LivenessState) {
  if (state === "FAILED" || state === "EXPIRED" || state === "ERROR") {
    return feedback;
  }

  return undefined;
}

export default function LivenessPanel({
  state,
  feedback,
  blinkCompleted,
  mouthCompleted,
}: LivenessPanelProps) {
  const warning = getWarning(feedback, state);

  return (
    <div className="space-y-4">
      <LivenessProgress
        state={state}
        blinkCompleted={blinkCompleted}
        mouthCompleted={mouthCompleted}
      />

      <LivenessInstruction
        state={state}
        feedback={feedback}
      />

      {warning && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {warning}
        </div>
      )}
    </div>
  );
}
