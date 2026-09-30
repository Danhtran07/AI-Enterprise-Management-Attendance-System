import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { ScanFace } from "lucide-react";

import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";

import CameraPreview from "../components/camera/CameraPreview";
import LivenessPanel from "../components/liveness/LivenessPanel";

import { getApiErrorMessage } from "../api/error";

import {
  recognizeAttendance,
} from "../api/recognition.api";

import {
  useFaceMesh,
} from "../hooks/useFaceMesh";

import {
  useLiveness,
} from "../hooks/useLiveness";

import type {
  RecognitionAttendanceResponse,
} from "../types/recognition";

import type {
  LivenessState,
} from "../types/liveness";

type CheckInState =
  | "idle"
  | "camera"
  | "uploading"
  | "recognizing"
  | "success"
  | "failure";

function formatTime(
  value: string | null,
) {
  if (!value) {
    return "-";
  }

  return new Date(
    value,
  ).toLocaleTimeString(
    "vi-VN",
    {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    },
  );
}

function statusClass(
  status: string,
) {
  if (status === "PRESENT") {
    return "bg-emerald-50 text-emerald-700";
  }

  if (status === "LATE") {
    return "bg-amber-50 text-amber-700";
  }

  return "bg-slate-100 text-slate-600";
}

export default function App() {
  /*
   * -----------------------------------------------------------
   * REFS
   * -----------------------------------------------------------
   */

  const videoRef =
    useRef<HTMLVideoElement>(
      null,
    );

  const canvasRef =
    useRef<HTMLCanvasElement>(
      null,
    );

  const meshCanvasRef =
    useRef<HTMLCanvasElement>(
      null,
    );

  const streamRef =
    useRef<MediaStream | null>(
      null,
    );

  /*
   * Camera operation generation.
   *
   * Prevents an old async getUserMedia()/play()
   * operation from continuing after Hủy / Retry.
   */
  const cameraGenerationRef =
    useRef(0);

  /*
   * -----------------------------------------------------------
   * APP STATE
   * -----------------------------------------------------------
   */

  const [state, setState] =
    useState<CheckInState>(
      "idle",
    );

  const [error, setError] =
    useState("");

  const [result, setResult] =
    useState<RecognitionAttendanceResponse | null>(
      null,
    );

  const [livenessState, setLivenessState] =
    useState<LivenessState>(
      "IDLE",
    );

  const [livenessComplete, setLivenessComplete] =
    useState(false);

  /*
   * -----------------------------------------------------------
   * FACE MESH
   * -----------------------------------------------------------
   */

  useFaceMesh({
    videoRef,
    meshCanvasRef,
    enabled: state === "camera",
  });

  /*
   * -----------------------------------------------------------
   * LIVENESS
   * -----------------------------------------------------------
   */

  const {
    sessionId,
    challenge,
    feedback,
    completedSteps,
    startLiveness,
    stopLiveness,
    resetLiveness,
  } = useLiveness({
    videoRef,
    canvasRef,
    enabled: state === "camera",

    onStateChange: (
      nextState,
    ) => {
      setLivenessState(
        nextState,
      );
    },

    onComplete: () => {
      setLivenessComplete(
        true,
      );
    },

    onError: (
      message,
    ) => {
      setLivenessComplete(
        false,
      );

      setError(message);
      setState("failure");
    },
  });

  /*
   * -----------------------------------------------------------
   * STOP CAMERA
   * -----------------------------------------------------------
   */

  const stopCamera =
    useCallback(() => {
      /*
       * Invalidate every pending camera start operation.
       */
      cameraGenerationRef.current += 1;

      stopLiveness();

      streamRef.current
        ?.getTracks()
        .forEach(
          (track) => {
            track.stop();
          },
        );

      streamRef.current =
        null;

      if (
        videoRef.current
      ) {
        videoRef.current.pause();
        videoRef.current.srcObject =
          null;
      }
    }, [
      stopLiveness,
    ]);

  /*
   * -----------------------------------------------------------
   * PAGE CLEANUP
   * -----------------------------------------------------------
   */

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [
    stopCamera,
  ]);

  /*
   * -----------------------------------------------------------
   * RESET
   * -----------------------------------------------------------
   *
   * Retry = session mới.
   */

  const reset =
    useCallback(() => {
      stopCamera();

      resetLiveness();

      setError("");
      setResult(null);

      setLivenessComplete(
        false,
      );

      setLivenessState(
        "IDLE",
      );

      setState("idle");
    }, [
      resetLiveness,
      stopCamera,
    ]);

  /*
   * -----------------------------------------------------------
   * START CAMERA
   * -----------------------------------------------------------
   */

  const startCamera =
    useCallback(
      async () => {
        /*
         * Starting a new attempt invalidates
         * the previous camera/session operation.
         */
        stopCamera();

        const generation =
          cameraGenerationRef.current;

        setError("");
        setResult(null);

        setLivenessComplete(
          false,
        );

        setLivenessState(
          "STARTING",
        );

        setState("camera");

        if (
          !navigator
            .mediaDevices
            ?.getUserMedia
        ) {
          const message =
            "Trình duyệt không hỗ trợ truy cập camera.";

          setError(message);
          setLivenessState(
            "ERROR",
          );
          setState("failure");

          return;
        }

        try {
          /*
           * Request camera.
           */
          const stream =
            await navigator
              .mediaDevices
              .getUserMedia({
                video: {
                  facingMode:
                    "user",
                  width: {
                    ideal: 1280,
                  },
                  height: {
                    ideal: 720,
                  },
                },
                audio: false,
              });

          /*
           * User may have pressed Hủy
           * while getUserMedia() was pending.
           */
          if (
            generation !==
            cameraGenerationRef.current
          ) {
            stream
              .getTracks()
              .forEach(
                (track) => {
                  track.stop();
                },
              );

            return;
          }

          streamRef.current =
            stream;

          /*
           * Attach video.
           */
          if (
            !videoRef.current
          ) {
            throw new Error(
              "Không thể khởi tạo camera preview.",
            );
          }

          videoRef.current.srcObject =
            stream;

          await videoRef.current.play();

          /*
           * User may have pressed Hủy
           * while video.play() was pending.
           */
          if (
            generation !==
            cameraGenerationRef.current
          ) {
            stream
              .getTracks()
              .forEach(
                (track) => {
                  track.stop();
                },
              );

            return;
          }

          /*
           * useFaceMesh is already enabled
           * automatically when state === "camera".
           *
           * Do NOT call startFaceMesh() here,
           * otherwise MediaPipe can be initialized twice.
           */

          /*
           * Create a NEW liveness session.
           */
          await startLiveness();

          /*
           * Cancel/retry may have happened while
           * the liveness session request was pending.
           */
          if (
            generation !==
            cameraGenerationRef.current
          ) {
            return;
          }
        } catch (
          reason
        ) {
          /*
           * A cancelled/stale operation must not
           * turn the UI into an error state.
           */
          if (
            generation !==
            cameraGenerationRef.current
          ) {
            return;
          }

          stopCamera();

          const message =
            reason instanceof
              DOMException &&
            reason.name ===
              "NotAllowedError"
              ? "Quyền truy cập camera đã bị từ chối. Vui lòng cho phép camera rồi thử lại."
              : getApiErrorMessage(
                  reason,
                  "Không thể khởi tạo camera hoặc phiên xác thực.",
                );

          setError(message);

          setLivenessState(
            "ERROR",
          );

          setState("failure");
        }
      },
      [
        startLiveness,
        stopCamera,
      ],
    );

  /*
   * -----------------------------------------------------------
   * CAPTURE
   * -----------------------------------------------------------
   *
   * Chỉ được gọi khi Backend -> PASSED.
   */

  const capture =
    useCallback(
      async () => {
        /*
         * FE-17 SECURITY GATE
         */

        if (
          livenessState !==
            "PASSED" ||
          !livenessComplete
        ) {
          setError(
            "Vui lòng hoàn thành xác thực khuôn mặt trước.",
          );

          return;
        }

        /*
         * Session bắt buộc phải tồn tại.
         */

        if (!sessionId) {
          setError(
            "Không tìm thấy phiên xác thực. Vui lòng thử lại.",
          );

          setState(
            "failure",
          );

          return;
        }

        const video =
          videoRef.current;

        const canvas =
          canvasRef.current;

        if (
          !video ||
          !canvas ||
          video.videoWidth === 0 ||
          video.videoHeight === 0
        ) {
          setError(
            "Camera chưa sẵn sàng. Vui lòng thử lại.",
          );

          setState(
            "failure",
          );

          return;
        }

        canvas.width =
          video.videoWidth;

        canvas.height =
          video.videoHeight;

        const context =
          canvas.getContext(
            "2d",
          );

        if (!context) {
          setError(
            "Không thể chụp ảnh từ camera.",
          );

          setState(
            "failure",
          );

          return;
        }

        /*
         * Capture image
         */

        /*
         * Capture the same mirrored orientation shown
         * in the camera preview.
         */
        context.save();
        context.scale(-1, 1);
        context.drawImage(
          video,
          -canvas.width,
          0,
          canvas.width,
          canvas.height,
        );
        context.restore();

        setState(
          "uploading",
        );

        try {
          const image =
            await new Promise<Blob>(
              (
                resolve,
                reject,
              ) => {
                canvas.toBlob(
                  (
                    blob,
                  ) => {
                    if (
                      blob
                    ) {
                      resolve(
                        blob,
                      );
                    } else {
                      reject(
                        new Error(
                          "Không thể tạo ảnh từ camera.",
                        ),
                      );
                    }
                  },
                  "image/jpeg",
                  0.9,
                );
              },
            );

          setState(
            "recognizing",
          );

          /*
           * IMPORTANT:
           *
           * fastMode = false
           *
           * Backend sẽ validate liveness session.
           */

          const response =
            await recognizeAttendance(
              image,
              sessionId,
              false,
            );

          setResult(
            response,
          );

          stopCamera();

          setState(
            "success",
          );
        } catch (
          reason
        ) {
          stopCamera();

          setError(
            getApiErrorMessage(
              reason,
              "Nhận diện khuôn mặt thất bại. Vui lòng thử lại.",
            ),
          );

          setState(
            "failure",
          );
        }
      },
      [
        livenessState,
        livenessComplete,
        sessionId,
        stopCamera,
      ],
    );

  /*
   * -----------------------------------------------------------
   * LOADING
   * -----------------------------------------------------------
   */

  if (
    state ===
      "uploading" ||
    state ===
      "recognizing"
  ) {
    return (
      <main className="min-h-[calc(100vh-5rem)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-soft">

          <LoadingState
            message={
              state ===
              "uploading"
                ? "Đang tải ảnh lên..."
                : "Đang nhận diện khuôn mặt..."
            }
          />

          <div className="border-t border-slate-100 px-6 py-5 text-center text-sm text-slate-500">
            {state ===
            "uploading"
              ? "Đang tải ảnh..."
              : "Đang nhận diện và xác minh khuôn mặt..."}
          </div>

        </section>
      </main>
    );
  }

  /*
   * -----------------------------------------------------------
   * FAILURE
   * -----------------------------------------------------------
   */

  if (
    state ===
    "failure"
  ) {
    return (
      <main className="min-h-[calc(100vh-5rem)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-soft">

          <ErrorState
            message={error}
            onRetry={
              startCamera
            }
          />

          <button
            type="button"
            onClick={reset}
            className="mx-auto mb-6 block text-sm font-semibold text-slate-500 hover:text-blue-600"
          >
            Quay lại
          </button>

        </section>
      </main>
    );
  }

  /*
   * -----------------------------------------------------------
   * SUCCESS
   * -----------------------------------------------------------
   */

  if (
    state ===
      "success" &&
    result
  ) {
    return (
      <main className="min-h-[calc(100vh-5rem)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">

        <section className="mx-auto max-w-3xl rounded-2xl border border-emerald-200 bg-white shadow-soft">

          <div className="border-b border-emerald-100 bg-emerald-50 px-6 py-7 sm:px-10">

            <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700">
              Xác thực thành công
            </p>

            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
              Điểm danh thành công
            </h1>

          </div>

          <div className="grid gap-5 p-6 sm:grid-cols-2 sm:p-10">

            <div className="sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Nhân viên
              </p>

              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {
                  result
                    .employee
                    .name
                }
              </p>

              <p className="mt-1 text-sm text-slate-500">
                ID{" "}
                {
                  result
                    .employee
                    .id
                }
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">

              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Confidence
              </p>

              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {(
                  result
                    .recognition
                    .confidence *
                  100
                ).toFixed(
                  1,
                )}
                %
              </p>

            </div>

            <div className="rounded-xl border border-slate-200 p-4">

              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Liveness
              </p>

              <p className="mt-2 text-2xl font-semibold text-emerald-700">
                Verified
              </p>

            </div>

            <div className="rounded-xl border border-slate-200 p-4">

              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Check-in
              </p>

              <p className="mt-2 text-xl font-semibold text-slate-900">
                {formatTime(
                  result
                    .attendance
                    .check_in,
                )}
              </p>

            </div>

            <div className="rounded-xl border border-slate-200 p-4">

              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Status
              </p>

              <span
                className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusClass(
                  result
                    .attendance
                    .status,
                )}`}
              >
                {
                  result
                    .attendance
                    .status
                }
              </span>

            </div>

          </div>

          <div className="border-t border-slate-100 px-6 py-5 sm:px-10">

            <button
              type="button"
              onClick={reset}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Điểm danh lần khác
            </button>

          </div>

        </section>
      </main>
    );
  }

  /*
   * -----------------------------------------------------------
   * MAIN UI
   * -----------------------------------------------------------
   */

  return (
    <main className="min-h-[calc(100vh-5rem)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">

      <section className="mx-auto max-w-5xl">

        <div className="mb-8 max-w-2xl">

          <div className="flex items-center gap-3">

            <div className="rounded-xl bg-blue-100 p-3">
              <ScanFace className="h-6 w-6 text-blue-600" />
            </div>

            <div>

              <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">
                FaceAttend AI
              </p>

              <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Điểm danh bằng khuôn mặt
              </h1>

            </div>

          </div>

          <p className="mt-4 text-base leading-7 text-slate-500">
            Xác thực khuôn mặt bằng camera để thực hiện điểm danh.
          </p>

        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-8">

          {state ===
            "camera" && (
            <>
              <CameraPreview
                videoRef={
                  videoRef
                }
                meshCanvasRef={
                  meshCanvasRef
                }
                canvasRef={
                  canvasRef
                }
              />

              <div className="mt-5 space-y-4">

                <LivenessPanel
                  state={
                    livenessState
                  }
                  feedback={
                    feedback
                  }
                  blinkCompleted={
                    completedSteps
                      .blink
                  }
                  mouthCompleted={
                    completedSteps
                      .mouth
                  }
                />

                <button
                  type="button"
                  onClick={
                    capture
                  }
                  disabled={
                    livenessState !==
                      "PASSED" ||
                    !livenessComplete
                  }
                  className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {livenessState ===
                    "PASSED"
                    ? "Tiếp tục điểm danh"
                    : "Hoàn thành xác thực khuôn mặt trước"}
                </button>

                <button
                  type="button"
                  onClick={
                    reset
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Hủy
                </button>

              </div>
            </>
          )}

          {state ===
            "idle" && (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">

              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <ScanFace
                  size={30}
                  strokeWidth={1.8}
                />
              </div>

              <h2 className="mt-5 text-xl font-semibold text-slate-900">
                Sẵn sàng điểm danh?
              </h2>

              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                Cho phép camera, sau đó thực hiện xác thực khuôn mặt.
              </p>

              <button
                type="button"
                onClick={
                  startCamera
                }
                className="mt-6 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Bắt đầu điểm danh
              </button>

            </div>
          )}

        </section>

      </section>

    </main>
  );
}