export type AttendanceStatus =
  | "PRESENT"
  | "LATE"
  | "ABSENT";

export type AttendanceRequestType =
  | "FORGOT_CHECKIN"
  | "LATE_EXPLANATION"
  | "EARLY_LEAVE"
  | "LEAVE";

export type AttendanceRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED";

export interface Attendance {
  id: number;
  employee_id: number;
  shift_id?: number | null;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: AttendanceStatus;
  late_minutes?: number;
  early_leave_minutes?: number;
  working_minutes?: number;
  overtime_minutes?: number;
  timestamp: string;
  face_similarity: number | null;
  liveness_score: number | null;
  verification_status: string;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceCreate {
  employee_id: number;
  date: string;
  check_in?: string | null;
  check_out?: string | null;
  status: AttendanceStatus;
}

export interface AttendanceUpdate {
  check_in?: string | null;
  check_out?: string | null;
  status?: AttendanceStatus;
}

export interface AttendanceCalendarDay {
  date: string;
  day_of_week: number;
  is_weekend: boolean;
  attendance_id: number | null;
  status: AttendanceStatus;
  has_record: boolean;
  check_in: string | null;
  check_out: string | null;
  late_minutes?: number;
  early_leave_minutes?: number;
  working_minutes?: number;
  overtime_minutes?: number;
  face_similarity?: number | null;
  liveness_score?: number | null;
  verification_status?: string | null;
}

export interface AttendanceCalendarResponse {
  employee_id: number;
  year: number;
  month: number;
  total_days: number;
  days: AttendanceCalendarDay[];
}

export interface MonthlyTimesheetRow {
  employee_id: number;
  employee_code: string;
  full_name: string;
  department: string | null;
  present_days: number;
  late_days: number;
  absent_days: number;
  total_working_minutes: number;
  total_late_minutes: number;
  total_early_leave_minutes: number;
  total_overtime_minutes: number;
  avg_face_similarity: number | null;
  avg_liveness_score: number | null;
}

export interface MonthlyTimesheetReportResponse {
  year: number;
  month: number;
  total_employees: number;
  rows: MonthlyTimesheetRow[];
}

export interface AIBiometricsMetricsResponse {
  total_verifications: number;
  verified_count: number;
  avg_face_similarity: number;
  avg_liveness_score: number;
  enrolled_employees: number;
  total_face_embeddings: number;
  engine_attempts: number;
  engine_matched: number;
  engine_rejected: number;
  engine_false_Reject_rate: number;
  rejection_breakdown: Record<string, number>;
}

export interface AttendanceRequestItem {
  id: number;
  employee_id: number;
  employee_name: string | null;
  employee_code: string | null;
  department: string | null;
  date: string;
  request_type: AttendanceRequestType;
  reason: string;
  requested_check_in: string | null;
  requested_check_out: string | null;
  status: AttendanceRequestStatus;
  admin_note: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRequestCreatePayload {
  date: string;
  request_type: AttendanceRequestType;
  reason: string;
  requested_check_in?: string | null;
  requested_check_out?: string | null;
}

export interface AttendanceRequestReviewPayload {
  status: AttendanceRequestStatus;
  admin_note?: string | null;
}
