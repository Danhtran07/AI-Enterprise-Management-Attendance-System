import { useEffect, useRef, useState } from "react";
import { ScanFace } from "lucide-react";
import {
  DrawingUtils,
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import { getApiErrorMessage } from "../api/error";
import { drawMirroredVideoFrame } from "../utils/cameraMirror";
import {
  createLivenessSession,
  recognizeAttendance,
} from "../api/recognition.api";
import type { RecognitionAttendanceResponse } from "../types/recognition";

type CheckInState =
  | "idle"
  | "camera"
  | "uploading"
  | "recognizing"
  | "success"
  | "failure";

const LIVENESS_SESSION_KEY = "liveness_session_id";
const FAST_ATTENDANCE = false;
const FACE_LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const LIVENESS_STEPS = [
  { challenge: "BLINK", label: "Chớp mắt" },
  { challenge: "OPEN_MOUTH", label: "Mở miệng" },
  { challenge: "BLINK_TWICE", label: "Chớp mắt 2 lần" },
] as const;

function challengeLabel(challenge: string) {
  return LIVENESS_STEPS.find((step) => step.challenge === challenge)?.label
    || (challenge === "COMPLETE" ? "Đã xác minh" : "Đang kiểm tra khuôn mặt");
}

function formatTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusClass(status: string) {
  if (status === "PRESENT") return "bg-emerald-50 text-emerald-700";
  if (status === "LATE") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meshCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const meshAnimationRef = useRef<number | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const [state, setState] = useState<CheckInState>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<RecognitionAttendanceResponse | null>(null);
  const [challenge, setChallenge] = useState("");
  const [challengeIndex, setChallengeIndex] = useState(0);
  const [feedback, setFeedback] = useState("Preparing liveness verification...");
  const [livenessComplete, setLivenessComplete] = useState(false);

  const stopLiveness = () => {
    if (frameTimerRef.current !== null) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    socketRef.current?.close();
    socketRef.current = null;
  };

  const stopFaceMesh = () => {
    if (meshAnimationRef.current !== null) {
      window.cancelAnimationFrame(meshAnimationRef.current);
      meshAnimationRef.current = null;
    }
    faceLandmarkerRef.current?.close();
    faceLandmarkerRef.current = null;
    const canvas = meshCanvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const stopCamera = () => {
    stopLiveness();
    stopFaceMesh();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const startFaceMesh = async () => {
    const video = videoRef.current;
    const canvas = meshCanvasRef.current;
    if (!video || !canvas) return;

    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
    );
    const landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: FACE_LANDMARKER_MODEL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
    });
    faceLandmarkerRef.current = landmarker;
    const context = canvas.getContext("2d");
    if (!context) return;
    const drawingUtils = new DrawingUtils(context);

    const drawMesh = () => {
      if (!video || !canvas || !faceLandmarkerRef.current) return;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.clearRect(0, 0, canvas.width, canvas.height);
        const result: FaceLandmarkerResult = landmarker.detectForVideo(
          video,
          performance.now()
        );
        for (const landmarks of result.faceLandmarks) {
          drawingUtils.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_TESSELATION,
            { color: "rgba(125, 211, 252, 0.72)", lineWidth: 1 }
          );
          drawingUtils.drawLandmarks(landmarks, {
            color: "rgba(255, 255, 255, 0.85)",
            radius: 1,
          });
          context.fillStyle = "#67e8f9";
          for (const landmark of landmarks) {
            context.beginPath();
            context.arc(
              landmark.x * canvas.width,
              landmark.y * canvas.height,
              2,
              0,
              Math.PI * 2
            );
            context.fill();
          }
        }
      }
      meshAnimationRef.current = window.requestAnimationFrame(drawMesh);
    };

    drawMesh();
  };

  useEffect(() => stopCamera, []);

  const reset = () => {
    stopCamera();
    setError("");
    setResult(null);
    setChallenge("");
    setChallengeIndex(0);
    setFeedback("Preparing liveness verification...");
    setLivenessComplete(false);
    setState("idle");
  };

  const captureVerificationFrame = async (): Promise<Blob> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error("The camera is not ready for identity verification.");
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to capture a verification frame.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("Unable to encode verification frame.")),
        "image/jpeg",
        0.9,
      );
    });
  };

  const startCamera = async () => {
    setError("");
    setResult(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is not supported by this browser.");
      setState("failure");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error("Camera preview is unavailable.");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setState("camera");
      window.requestAnimationFrame(() => {
        void startFaceMesh().catch(() => undefined);
      });

      if (FAST_ATTENDANCE) {
        setLivenessComplete(true);
        setFeedback("Face mesh active. Hold still for fast attendance scan...");
        window.setTimeout(() => {
          void capture();
        }, 1200);
        return;
      }

      setFeedback("Recognizing your face before starting liveness verification...");
      const initialFace = await captureVerificationFrame();
      const session = await createLivenessSession(initialFace);
      sessionStorage.setItem(LIVENESS_SESSION_KEY, session.session_id);
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const token = localStorage.getItem("access_token");
      const socket = new WebSocket(
        `${protocol}//${window.location.host}/api/attendance/liveness/${session.session_id}?access_token=${encodeURIComponent(token || "")}`
      );
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        setFeedback("Keep your face inside the frame...");
        frameTimerRef.current = window.setInterval(() => {
          const currentVideo = videoRef.current;
          const canvas = canvasRef.current;
          if (!currentVideo || !canvas || socket.readyState !== WebSocket.OPEN) return;
          if (currentVideo.videoWidth === 0 || currentVideo.videoHeight === 0) return;
          canvas.width = currentVideo.videoWidth;
          canvas.height = currentVideo.videoHeight;
          const context = canvas.getContext("2d");
          if (!context) return;
          drawMirroredVideoFrame(context, currentVideo, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (blob && socket.readyState === WebSocket.OPEN) socket.send(blob);
          }, "image/jpeg", 0.75);
        }, 1000 / 12);
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as {
          challenge?: string;
          challenge_index?: number;
          feedback?: string;
          liveness_token?: string;
          error?: string;
        };
        if (message.error) {
          setError(message.error);
          stopCamera();
          setState("failure");
          return;
        }
        setChallenge(message.challenge || "");
        if (typeof message.challenge_index === "number") {
          setChallengeIndex(message.challenge_index);
        }
        setFeedback(message.feedback || "Keep your face inside the frame...");
        if (message.challenge === "COMPLETE") {
          setLivenessComplete(true);
          setFeedback("Liveness verified. Capture your face to continue.");
          stopLiveness();
        } else if (message.challenge === "FAILED") {
          setError(message.feedback || "Liveness verification failed.");
          stopCamera();
          setState("failure");
        }
      };
      socket.onerror = () => {
        setError("Unable to connect to Backend liveness verification.");
        stopCamera();
        setState("failure");
      };
    } catch (reason) {
      stopCamera();
      setError(
        reason instanceof DOMException && reason.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access and try again."
          : getApiErrorMessage(reason, "Unable to open the camera.")
      );
      setState("failure");
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      setError("The camera is not ready yet. Try again in a moment.");
      setState("failure");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Unable to capture the camera frame.");
      setState("failure");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setState("uploading");

    try {
      const image = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error("Unable to encode the camera image.")),
          "image/jpeg",
          0.9
        );
      });
      setState("recognizing");
      const response = await recognizeAttendance(
        image,
        FAST_ATTENDANCE ? undefined : sessionStorage.getItem(LIVENESS_SESSION_KEY) || undefined,
        FAST_ATTENDANCE
      );
      setResult(response);
      stopCamera();
      setState("success");
    } catch (reason) {
      stopCamera();
      setError(getApiErrorMessage(reason, "Recognition failed. Please try again."));
      setState("failure");
    }
  };

  if (state === "uploading" || state === "recognizing") {
    return (
      <main className="min-h-[calc(100vh-5rem)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-soft">
          <LoadingState
            message={
              state === "uploading"
                ? "Uploading image..."
                : "Detecting face, recognizing, and verifying liveness..."
            }
          />
          <div className="border-t border-slate-100 px-6 py-5 text-center text-sm text-slate-500">
            {state === "uploading"
              ? "Uploading..."
              : "Recognizing... Verifying liveness..."}
          </div>
        </section>
      </main>
    );
  }

  if (state === "failure") {
    return (
      <main className="min-h-[calc(100vh-5rem)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-soft">
          <ErrorState message={error} onRetry={startCamera} />
          <button
            type="button"
            onClick={reset}
            className="mx-auto mb-6 block text-sm font-semibold text-slate-500 hover:text-blue-600"
          >
            Back to ready state
          </button>
        </section>
      </main>
    );
  }

  if (state === "success" && result) {
    return (
      <main className="min-h-[calc(100vh-5rem)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-3xl rounded-2xl border border-emerald-200 bg-white shadow-soft">
          <div className="border-b border-emerald-100 bg-emerald-50 px-6 py-7 sm:px-10">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700">
              Identity verified
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
              Attendance recorded
            </h1>
          </div>
          <div className="grid gap-5 p-6 sm:grid-cols-2 sm:p-10">
            <div className="sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Employee
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {result.employee.name}
              </p>
              <p className="mt-1 text-sm text-slate-500">ID {result.employee.id}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Confidence
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {(result.recognition.confidence * 100).toFixed(1)}%
              </p>
              <p className="mt-1 text-xs text-slate-500">Face match similarity</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Liveness
              </p>
              <p className="mt-2 text-2xl font-semibold text-emerald-700">
                {(result.recognition.liveness_score * 100).toFixed(1)}%
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Verified · {result.recognition.verification_status}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Check-in
              </p>
              <p className="mt-2 text-xl font-semibold text-slate-900">
                {formatTime(result.attendance.check_in)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Status
              </p>
              <span
                className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusClass(result.attendance.status)}`}
              >
                {result.attendance.status}
              </span>
            </div>
          </div>
          <div className="border-t border-slate-100 px-6 py-5 sm:px-10">
            <button
              type="button"
              onClick={reset}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Scan again
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-5rem)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-5xl">
        <div className="mb-8 max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">
            FaceAttend AI
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            AI Face Check-in
          </h1>
          <p className="mt-3 text-base leading-7 text-slate-500">
            Verify your identity with a live camera capture before recording attendance.
          </p>
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-8">
          <div className={state === "camera" ? "relative aspect-video overflow-hidden rounded-xl bg-slate-950" : "hidden"}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="relative z-0 h-full w-full scale-x-[-1] object-cover"
            />
            <canvas
              ref={meshCanvasRef}
              className="pointer-events-none absolute inset-0 z-10 h-full w-full scale-x-[-1]"
            />
            <div className="pointer-events-none absolute inset-[12%_35%] rounded-[50%] border-2 border-blue-300 shadow-[0_0_0_999px_rgba(15,23,42,0.3)]" />
            <p className="absolute bottom-4 left-4 rounded-md bg-slate-950/75 px-3 py-2 text-xs font-medium text-white">
              Position your face inside the frame
            </p>
          </div>
          <canvas ref={canvasRef} className="hidden" />
          {state === "camera" ? (
            <>
              {!FAST_ATTENDANCE && <button
                type="button"
                onClick={capture}
                disabled={!livenessComplete}
                className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {livenessComplete ? "Capture" : "Complete liveness verification first"}
              </button>}
              <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-4 text-center">
                {!FAST_ATTENDANCE && (
                  <ol className="mb-4 grid grid-cols-3 gap-2 text-left" aria-label="Liveness challenge progress">
                    {LIVENESS_STEPS.map((step, index) => {
                      const completed = challenge === "COMPLETE" || index < challengeIndex;
                      const current = challenge === step.challenge;
                      return (
                        <li
                          key={step.challenge}
                          aria-current={current ? "step" : undefined}
                          className={`rounded-lg border px-2 py-2 text-center text-xs font-semibold sm:px-3 ${
                            completed
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : current
                                ? "border-blue-300 bg-white text-blue-700 ring-2 ring-blue-100"
                                : "border-blue-100 bg-blue-50/50 text-slate-400"
                          }`}
                        >
                          <span className="block text-[10px] opacity-70">Bước {index + 1}</span>
                          {step.label}
                        </li>
                      );
                    })}
                  </ol>
                )}
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                  {FAST_ATTENDANCE ? "Fast attendance scan" : challengeLabel(challenge)}
                </p>
                <p className="mt-1 text-sm font-medium text-slate-700">{feedback}</p>
              </div>
            </>
          ) : (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
              <div
                className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-3xl text-blue-600"
                aria-hidden="true"
              >
                <ScanFace size={30} strokeWidth={1.8} />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-slate-900">Ready to scan</h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                Allow camera access, then capture a clear image of your face.
              </p>
              <button
                type="button"
                onClick={startCamera}
                className="mt-6 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Start Camera
              </button>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
