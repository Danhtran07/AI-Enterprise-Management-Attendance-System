import apiClient from "./client";
import type {
  LivenessSessionResponse,
  RecognitionAttendanceResponse,
} from "../types/recognition";

export async function createLivenessSession(): Promise<LivenessSessionResponse> {
  const response = await apiClient.post<LivenessSessionResponse>(
    "/api/attendance/liveness/session",
  );
  return response.data;
}

export async function recognizeAttendance(
  image: Blob,
  livenessSessionId?: string,
  fastMode = true,
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
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    },
  );

  return response.data;
}
