import apiClient from "./client";
import type {
  LivenessSessionResponse,
  RecognitionAttendanceResponse,
} from "../types/recognition";

export async function createLivenessSession(
  initialFace?: Blob
): Promise<LivenessSessionResponse> {
  const formData = new FormData();
  if (initialFace) formData.append("image", initialFace, "verification-start.jpg");
  const response = await apiClient.post<LivenessSessionResponse>(
    "/api/attendance/liveness/session",
    initialFace ? formData : undefined,
    initialFace ? { headers: { "Content-Type": "multipart/form-data" } } : undefined,
  );
  return response.data;
}

export async function recognizeAttendance(
  image: Blob,
  livenessSessionId?: string,
  fastMode = false
): Promise<RecognitionAttendanceResponse> {
  const formData = new FormData();
  formData.append("image", image, "face-capture.jpg");

  if (livenessSessionId) {
    formData.append("liveness_session_id", livenessSessionId);
  }
  formData.append("fast_mode", String(fastMode));

  const response = await apiClient.post<RecognitionAttendanceResponse>(
    "/api/attendance/recognize",
    formData,
    { headers: { "Content-Type": "multipart/form-data" } }
  );

  return response.data;
}
