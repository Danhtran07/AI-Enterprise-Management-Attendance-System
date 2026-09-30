import type { Attendance } from "./attendance";

export interface RecognitionEmployee {
  id: number;
  name: string;
}

export interface RecognitionSummary {
  matched: boolean;
  confidence: number;
  liveness: boolean;
  liveness_score: number;
  verification_status: string;
  session_id: string | null;
}

export interface RecognitionAttendanceResponse {
  success: boolean;
  employee: RecognitionEmployee;
  attendance: Attendance;
  recognition: RecognitionSummary;
}

export interface LivenessSessionResponse {
  session_id: string;
  expires_at: string;
  challenges: string[];
  employee_id?: number | null;
}
