export type AttendanceStatus =
  | "PRESENT"
  | "LATE"
  | "ABSENT";

export interface Attendance {
  id: number;
  employee_id: number;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: AttendanceStatus;
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
}

export interface AttendanceCalendarResponse {
  employee_id: number;
  year: number;
  month: number;
  total_days: number;
  days: AttendanceCalendarDay[];
}
