import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { createLivenessSession } from "../api/recognition.api";
import {
  createLivenessSocket,
  parseLivenessMessage,
} from "../api/liveness.api";
import type {
  LivenessMessage,
  LivenessState,
} from "../types/liveness";

interface UseLivenessOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  enabled?: boolean;
  onStateChange?: (state: LivenessState) => void;
  onComplete?: () => void;
  onError?: (message: string) => void;
}

const FRAME_INTERVAL = 125;
const SESSION_STORAGE_KEY = "liveness_session_id";

function getErrorMessage(message: LivenessMessage): string {
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
    case "SESSION_EXPIRED":
    case "EXPIRED":
      return "Phiên xác thực đã hết hạn. Vui lòng thử lại.";
    case "TIMEOUT":
      return "Xác thực khuôn mặt đã quá thời gian. Vui lòng thử lại.";
    case "NETWORK_ERROR":
      return "Mất kết nối với máy chủ xác thực. Vui lòng kiểm tra mạng và thử lại.";
    default:
      return (
        message.feedback ||
        message.error ||
        "Xác thực khuôn mặt thất bại. Vui lòng thử lại."
      );
  }
}

function normalizeState(
  state?: string,
  challenge?: string,
): LivenessState | null {
  const value = state || challenge;

  switch (value) {
    case "WAITING_FOR_FACE":
      return "WAITING_FOR_FACE";
    case "BLINK":
    case "BLINK_REQUIRED":
      return "BLINK_REQUIRED";
    case "MOUTH_OPEN":
    case "MOUTH_REQUIRED":
      return "MOUTH_REQUIRED";
    case "PASSED":
    case "COMPLETE":
      return "PASSED";
    case "FAILED":
      return "FAILED";
    case "EXPIRED":
      return "EXPIRED";
    default:
      return null;
  }
}

export function useLiveness({
  videoRef,
  canvasRef,
  enabled = true,
  onStateChange,
  onComplete,
  onError,
}: UseLivenessOptions) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<LivenessState>("IDLE");
  const [challenge, setChallenge] = useState("");
  const [feedback, setFeedback] = useState(
    "Đang chuẩn bị xác thực khuôn mặt...",
  );
  const [completedSteps, setCompletedSteps] = useState({
    blink: false,
    mouth: false,
  });

  const socketRef = useRef<WebSocket | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const sessionTimeoutRef = useRef<number | null>(null);
  const sendingFrameRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const sessionRef = useRef<string | null>(null);

  const callbacksRef = useRef({
    onStateChange,
    onComplete,
    onError,
  });

  useEffect(() => {
    callbacksRef.current = {
      onStateChange,
      onComplete,
      onError,
    };
  }, [onStateChange, onComplete, onError]);

  const setLivenessState = useCallback((nextState: LivenessState) => {
    if (!mountedRef.current) return;
    setState(nextState);
    callbacksRef.current.onStateChange?.(nextState);
  }, []);

  const clearFrameTimer = useCallback(() => {
    if (frameTimerRef.current !== null) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
  }, []);

  const clearSessionTimeout = useCallback(() => {
    if (sessionTimeoutRef.current !== null) {
      window.clearTimeout(sessionTimeoutRef.current);
      sessionTimeoutRef.current = null;
    }
  }, []);

  const stopLiveness = useCallback(() => {
    generationRef.current += 1;
    clearFrameTimer();
    clearSessionTimeout();
    sendingFrameRef.current = false;

    const socket = socketRef.current;
    socketRef.current = null;

    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;

      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        try {
          socket.close();
        } catch {
          // Ignore cleanup errors.
        }
      }
    }
  }, [clearFrameTimer, clearSessionTimeout]);

  const resetLiveness = useCallback(() => {
    stopLiveness();
    sessionRef.current = null;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);

    if (!mountedRef.current) return;

    setSessionId(null);
    setLivenessState("IDLE");
    setChallenge("");
    setFeedback("Đang chuẩn bị xác thực khuôn mặt...");
    setCompletedSteps({ blink: false, mouth: false });
  }, [setLivenessState, stopLiveness]);

  const sendFrame = useCallback(
    async (socket: WebSocket, generation: number) => {
      if (generation !== generationRef.current) return;
      if (sendingFrameRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas) return;
      if (socket.readyState !== WebSocket.OPEN) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      sendingFrameRef.current = true;

      try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const context = canvas.getContext("2d");
        if (!context) return;

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

        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, "image/jpeg", 0.75);
        });

        if (generation !== generationRef.current) return;
        if (!blob) return;
        if (socket.readyState !== WebSocket.OPEN) return;

        socket.send(blob);
      } finally {
        sendingFrameRef.current = false;
      }
    },
    [canvasRef, videoRef],
  );

  const startLiveness = useCallback(async () => {
    if (!mountedRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    stopLiveness();

    const generation = generationRef.current;

    setLivenessState("STARTING");
    setChallenge("");
    setFeedback("Đang khởi tạo xác thực...");
    setCompletedSteps({ blink: false, mouth: false });

    try {
      const session = await createLivenessSession();

      if (
        !mountedRef.current ||
        generation !== generationRef.current
      ) {
        return;
      }

      const id = session.session_id;
      sessionRef.current = id;
      setSessionId(id);
      sessionStorage.setItem(SESSION_STORAGE_KEY, id);

      const socket = createLivenessSocket(id);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      if (session.expires_at) {
        const expiresAt = new Date(session.expires_at).getTime();
        const delay = Math.max(0, expiresAt - Date.now());

        sessionTimeoutRef.current = window.setTimeout(() => {
          if (
            generation !== generationRef.current ||
            !mountedRef.current
          ) {
            return;
          }

          const expiredMessage = "Phiên xác thực đã hết hạn. Vui lòng thử lại.";
          setFeedback(expiredMessage);
          setLivenessState("EXPIRED");
          callbacksRef.current.onError?.(expiredMessage);
          stopLiveness();
        }, delay);
      }

      socket.onopen = () => {
        if (
          generation !== generationRef.current ||
          !mountedRef.current
        ) {
          return;
        }

        setLivenessState("WAITING_FOR_FACE");
        setFeedback("Vui lòng đưa khuôn mặt vào giữa khung.");

        clearFrameTimer();
        frameTimerRef.current = window.setInterval(() => {
          void sendFrame(socket, generation);
        }, FRAME_INTERVAL);
      };

      socket.onmessage = (event) => {
        if (
          generation !== generationRef.current ||
          !mountedRef.current
        ) {
          return;
        }

        let message: LivenessMessage;

        try {
          message = parseLivenessMessage(event.data);
        } catch {
          const errorMessage =
            "Dữ liệu xác thực từ Backend không hợp lệ.";
          setFeedback(errorMessage);
          setLivenessState("ERROR");
          callbacksRef.current.onError?.(errorMessage);
          stopLiveness();
          return;
        }

        if (message.error || message.error_code) {
          const errorMessage = getErrorMessage(message);
          setFeedback(errorMessage);
          setLivenessState(
            message.error_code === "SESSION_EXPIRED"
              ? "EXPIRED"
              : "ERROR",
          );
          callbacksRef.current.onError?.(errorMessage);
          stopLiveness();
          return;
        }

        const normalized = normalizeState(
          message.state,
          message.challenge,
        );

        if (normalized) {
          setLivenessState(normalized);
        }

        if (message.feedback) {
          setFeedback(message.feedback);
        }

        if (message.challenge) {
          setChallenge(message.challenge);
        }

        if (message.completed_challenges) {
          setCompletedSteps({
            blink: message.completed_challenges.includes("BLINK"),
            mouth: message.completed_challenges.includes("MOUTH_OPEN"),
          });
        } else if (message.challenge_passed === true) {
          if (
            message.challenge === "BLINK" ||
            message.challenge === "BLINK_REQUIRED"
          ) {
            setCompletedSteps((previous) => ({
              ...previous,
              blink: true,
            }));
          }

          if (
            message.challenge === "MOUTH_OPEN" ||
            message.challenge === "MOUTH_REQUIRED"
          ) {
            setCompletedSteps((previous) => ({
              ...previous,
              mouth: true,
            }));
          }
        }

        if (
          message.state === "PASSED" ||
          message.state === "COMPLETE" ||
          message.challenge === "PASSED" ||
          message.challenge === "COMPLETE"
        ) {
          clearFrameTimer();
          clearSessionTimeout();
          setLivenessState("PASSED");
          setFeedback("Xác thực khuôn mặt thành công.");
          callbacksRef.current.onComplete?.();
          return;
        }

        if (
          message.state === "FAILED" ||
          message.challenge === "FAILED"
        ) {
          const errorMessage = getErrorMessage(message);
          setFeedback(errorMessage);
          setLivenessState("FAILED");
          callbacksRef.current.onError?.(errorMessage);
          stopLiveness();
          return;
        }

        if (
          message.state === "EXPIRED" ||
          message.challenge === "EXPIRED"
        ) {
          const errorMessage =
            "Phiên xác thực đã hết hạn. Vui lòng thử lại.";
          setFeedback(errorMessage);
          setLivenessState("EXPIRED");
          callbacksRef.current.onError?.(errorMessage);
          stopLiveness();
        }
      };

      socket.onerror = () => {
        if (
          generation !== generationRef.current ||
          !mountedRef.current
        ) {
          return;
        }

        const errorMessage =
          "Không thể kết nối Backend liveness. Vui lòng thử lại.";
        setFeedback(errorMessage);
        setLivenessState("ERROR");
        callbacksRef.current.onError?.(errorMessage);
        stopLiveness();
      };

      socket.onclose = () => {
        if (
          generation !== generationRef.current ||
          !mountedRef.current
        ) {
          return;
        }

        clearFrameTimer();
      };
    } catch (error) {
      if (
        generation !== generationRef.current ||
        !mountedRef.current
      ) {
        return;
      }

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Không thể khởi tạo phiên xác thực.";

      setFeedback(errorMessage);
      setLivenessState("ERROR");
      callbacksRef.current.onError?.(errorMessage);
      stopLiveness();
    }
  }, [
    canvasRef,
    clearFrameTimer,
    clearSessionTimeout,
    sendFrame,
    setLivenessState,
    stopLiveness,
    videoRef,
  ]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      stopLiveness();
    };
  }, [stopLiveness]);

  useEffect(() => {
    if (!enabled) {
      stopLiveness();
    }
  }, [enabled, stopLiveness]);

  return {
    sessionId,
    state,
    challenge,
    feedback,
    completedSteps,
    startLiveness,
    stopLiveness,
    resetLiveness,
  };
}
