import type { LivenessMessage } from "../types/liveness";

export function createLivenessSocket(sessionId: string): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = localStorage.getItem("access_token") || "";

  const url =
    `${protocol}//${window.location.host}` +
    `/api/attendance/liveness/${encodeURIComponent(sessionId)}` +
    `?access_token=${encodeURIComponent(token)}`;

  return new WebSocket(url);
}

export function parseLivenessMessage(data: unknown): LivenessMessage {
  if (typeof data === "string") {
    return JSON.parse(data) as LivenessMessage;
  }

  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(data)) as LivenessMessage;
  }

  if (data instanceof Blob) {
    throw new Error("Unexpected binary Blob liveness message.");
  }

  if (typeof data === "object" && data !== null) {
    return data as LivenessMessage;
  }

  throw new Error("Invalid liveness message.");
}
