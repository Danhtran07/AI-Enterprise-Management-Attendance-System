import apiClient from "./client";
import type {
  AIBiometricsMetricsResponse,
  Attendance,
  AttendanceCalendarResponse,
  AttendanceCreate,
  AttendanceRequestCreatePayload,
  AttendanceRequestItem,
  AttendanceRequestReviewPayload,
  AttendanceRequestStatus,
  AttendanceUpdate,
  MonthlyTimesheetReportResponse,
} from "../types/attendance";

export async function getAttendanceCalendar(
  year: number,
  month: number,
  employeeId?: number
): Promise<AttendanceCalendarResponse> {
  const response = await apiClient.get<AttendanceCalendarResponse>(
    "/api/attendance/calendar",
    {
      params: {
        year,
        month,
        ...(employeeId ? { employee_id: employeeId } : {}),
      },
    }
  );

  return response.data;
}

export async function getMonthlyTimesheetReport(
  year: number,
  month: number,
  department?: string
): Promise<MonthlyTimesheetReportResponse> {
  const response = await apiClient.get<MonthlyTimesheetReportResponse>(
    "/api/attendance/report",
    {
      params: {
        year,
        month,
        ...(department ? { department } : {}),
      },
    }
  );
  return response.data;
}

export async function getAIBiometricsMetrics(): Promise<AIBiometricsMetricsResponse> {
  const response = await apiClient.get<AIBiometricsMetricsResponse>(
    "/api/attendance/ai-metrics"
  );
  return response.data;
}

export async function getAttendanceRequests(
  status?: AttendanceRequestStatus
): Promise<AttendanceRequestItem[]> {
  const response = await apiClient.get<AttendanceRequestItem[]>(
    "/api/attendance/requests",
    {
      params: status ? { status } : {},
    }
  );
  return response.data;
}

export async function createAttendanceRequest(
  payload: AttendanceRequestCreatePayload
): Promise<AttendanceRequestItem> {
  const response = await apiClient.post<AttendanceRequestItem>(
    "/api/attendance/requests",
    payload
  );
  return response.data;
}

export async function reviewAttendanceRequest(
  requestId: number,
  payload: AttendanceRequestReviewPayload
): Promise<AttendanceRequestItem> {
  const response = await apiClient.put<AttendanceRequestItem>(
    `/api/attendance/requests/${requestId}/review`,
    payload
  );
  return response.data;
}

export async function getAttendances(): Promise<Attendance[]> {
  const response = await apiClient.get<Attendance[]>(
    "/api/attendance"
  );

  return response.data;
}

export async function getAttendance(
  id: number
): Promise<Attendance> {
  const response = await apiClient.get<Attendance>(
    `/api/attendance/${id}`
  );

  return response.data;
}

export async function createAttendance(
  data: AttendanceCreate
): Promise<Attendance> {
  const response = await apiClient.post<Attendance>(
    "/api/attendance",
    data
  );

  return response.data;
}

export async function updateAttendance(
  id: number,
  data: AttendanceUpdate
): Promise<Attendance> {
  const response = await apiClient.put<Attendance>(
    `/api/attendance/${id}`,
    data
  );

  return response.data;
}

export async function deleteAttendance(
  id: number
): Promise<void> {
  await apiClient.delete(`/api/attendance/${id}`);
}