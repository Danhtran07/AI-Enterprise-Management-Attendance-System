import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FileSpreadsheet,
  FileText,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import {
  createAttendance,
  createAttendanceRequest,
  deleteAttendance,
  getAttendanceCalendar,
  getAttendanceRequests,
  getMonthlyTimesheetReport,
  reviewAttendanceRequest,
  updateAttendance,
} from "../api/attendance.api";
import { getEmployeeSchedule, getMySchedule } from "../api/schedule.api";
import { getApiErrorMessage } from "../api/error";
import { getEmployees } from "../api/employee.api";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import type {
  AttendanceCalendarDay,
  AttendanceCalendarResponse,
  AttendanceRequestItem,
  AttendanceRequestType,
  AttendanceStatus,
  MonthlyTimesheetReportResponse,
} from "../types/attendance";
import type { Employee } from "../types/employee";
import type { EmployeeSchedule } from "../types/schedule";
import { getCalendarCellCount, shiftMonth } from "./attendanceCalendar";

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const REQUEST_TYPE_LABELS: Record<AttendanceRequestType, string> = {
  FORGOT_CHECKIN: "Forgot Check-in / Check-out",
  LATE_EXPLANATION: "Late Arrival Explanation",
  EARLY_LEAVE: "Early Leave Explanation",
  LEAVE: "Authorized Leave / Day Off",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatClock(value: string | null) {
  return value
    ? new Date(value).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";
}

function formatShiftTime(value: string) {
  return value.slice(0, 5);
}

function formatMinutes(minutes?: number) {
  if (!minutes || minutes <= 0) return "0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

function downloadCsvFile(filename: string, headers: string[], rows: (string | number)[][]) {
  const escapeCell = (val: string | number) => {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvContent =
    "\uFEFF" +
    [headers.map(escapeCell).join(","), ...rows.map((r) => r.map(escapeCell).join(","))].join(
      "\r\n"
    );
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function statusClass(
  status: AttendanceStatus,
  future: boolean,
  hasRecord: boolean,
  selected: boolean
) {
  const ring = selected ? " ring-2 ring-blue-500" : "";
  if (future) return `border-blue-100 bg-blue-50 text-blue-600${ring}`;
  if (!hasRecord) return `border-slate-200 bg-slate-100 text-slate-500${ring}`;
  if (status === "PRESENT") return `border-emerald-200 bg-emerald-50 text-emerald-700${ring}`;
  if (status === "LATE") return `border-amber-200 bg-amber-50 text-amber-700${ring}`;
  return `border-rose-200 bg-rose-50 text-rose-700${ring}`;
}

export default function Attendance() {
  const [searchParams, setSearchParams] = useSearchParams();
  const storedUser = localStorage.getItem("user");
  const isAdmin = (() => {
    try {
      return JSON.parse(storedUser || "{}").role === "ADMIN";
    } catch {
      return false;
    }
  })();

  const activeTab = (searchParams.get("tab") || "calendar") as
    | "calendar"
    | "timesheet"
    | "requests";

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [employeeId, setEmployeeId] = useState(
    isAdmin ? searchParams.get("employee") || "" : ""
  );
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [calendar, setCalendar] = useState<AttendanceCalendarResponse | null>(null);
  const [daySchedule, setDaySchedule] = useState<EmployeeSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [error, setError] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [editingDay, setEditingDay] = useState<AttendanceCalendarDay | null>(null);
  const [form, setForm] = useState({
    date: "",
    check_in: "",
    check_out: "",
    status: "PRESENT" as AttendanceStatus,
  });
  const [saving, setSaving] = useState(false);

  // Timesheet report state (Admin)
  const [report, setReport] = useState<MonthlyTimesheetReportResponse | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  // Requests state (Admin & Employee)
  const [requests, setRequests] = useState<AttendanceRequestItem[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestForm, setRequestForm] = useState({
    date: todayIso(),
    request_type: "FORGOT_CHECKIN" as AttendanceRequestType,
    reason: "",
    requested_check_in: "",
    requested_check_out: "",
  });
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestFeedback, setRequestFeedback] = useState("");
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  function setTab(tab: "calendar" | "timesheet" | "requests") {
    const next = new URLSearchParams(searchParams);
    if (tab === "calendar") next.delete("tab");
    else next.set("tab", tab);
    setSearchParams(next, { replace: true });
  }

  async function loadCalendar() {
    if (isAdmin && !employeeId) {
      setCalendar(null);
      return;
    }
    try {
      setLoading(true);
      setError("");
      setCalendar(
        await getAttendanceCalendar(
          year,
          month,
          isAdmin && employeeId ? Number(employeeId) : undefined
        )
      );
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load attendance calendar."));
    } finally {
      setLoading(false);
    }
  }

  async function loadDaySchedule(date: string) {
    if (isAdmin && !employeeId) {
      setDaySchedule(null);
      return;
    }
    try {
      setScheduleLoading(true);
      setScheduleError("");
      const result =
        isAdmin && employeeId
          ? await getEmployeeSchedule(Number(employeeId), date)
          : await getMySchedule(date);
      setDaySchedule(result);
    } catch (err) {
      setDaySchedule(null);
      setScheduleError(getApiErrorMessage(err, "Unable to load assigned shift."));
    } finally {
      setScheduleLoading(false);
    }
  }

  async function loadReport() {
    if (!isAdmin) return;
    try {
      setReportLoading(true);
      setError("");
      const data = await getMonthlyTimesheetReport(
        year,
        month,
        departmentFilter || undefined
      );
      setReport(data);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load monthly timesheet report."));
    } finally {
      setReportLoading(false);
    }
  }

  async function loadRequests() {
    try {
      setRequestsLoading(true);
      const data = await getAttendanceRequests();
      setRequests(data);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load attendance requests."));
    } finally {
      setRequestsLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    getEmployees()
      .then((list) => {
        setEmployees(list);
        if (!employeeId && list.length > 0) {
          setEmployeeId(String(list[0].id));
        }
      })
      .catch((err) => setError(getApiErrorMessage(err, "Unable to load employees.")));
  }, [isAdmin]);

  useEffect(() => {
    void loadCalendar();
  }, [year, month, employeeId, isAdmin]);

  useEffect(() => {
    void loadDaySchedule(selectedDate);
  }, [selectedDate, employeeId, isAdmin]);

  useEffect(() => {
    if (activeTab === "timesheet" && isAdmin) {
      void loadReport();
    } else if (activeTab === "requests") {
      void loadRequests();
    }
  }, [activeTab, year, month, departmentFilter, isAdmin]);

  useEffect(() => {
    void loadRequests();
  }, []);

  const departments = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((emp) => {
      if (emp.department?.trim()) set.add(emp.department.trim());
    });
    return Array.from(set).sort();
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    if (!departmentFilter) return employees;
    return employees.filter((e) => (e.department || "").trim() === departmentFilter);
  }, [employees, departmentFilter]);

  const selectedEmployee = employees.find(
    (employee) => String(employee.id) === employeeId
  );
  const currentToday = todayIso();
  const daysByDate = useMemo(
    () => new Map(calendar?.days.map((day) => [day.date, day])),
    [calendar]
  );
  const selectedDay = daysByDate.get(selectedDate);

  const calendarSummary = useMemo(() => {
    if (!calendar) {
      return {
        presentDays: 0,
        lateDays: 0,
        absentDays: 0,
        workingMinutes: 0,
        lateMinutes: 0,
        overtimeMinutes: 0,
      };
    }
    let presentDays = 0;
    let lateDays = 0;
    let absentDays = 0;
    let workingMinutes = 0;
    let lateMinutes = 0;
    let overtimeMinutes = 0;
    for (const d of calendar.days) {
      if (d.has_record) {
        if (d.status === "PRESENT") presentDays += 1;
        else if (d.status === "LATE") lateDays += 1;
        else if (d.status === "ABSENT") absentDays += 1;
        workingMinutes += d.working_minutes || 0;
        lateMinutes += d.late_minutes || 0;
        overtimeMinutes += d.overtime_minutes || 0;
      }
    }
    return {
      presentDays,
      lateDays,
      absentDays,
      workingMinutes,
      lateMinutes,
      overtimeMinutes,
    };
  }, [calendar]);

  const cells = useMemo(() => {
    const count = getCalendarCellCount(year, month);
    const first = (new Date(year, month - 1, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: count }, (_, index) => {
      const dayNumber = index - first + 1;
      return dayNumber > 0 && dayNumber <= daysInMonth
        ? `${year}-${String(month).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`
        : "";
    });
  }, [year, month]);

  function moveMonth(offset: number) {
    const next = shiftMonth(year, month, offset);
    setYear(next.year);
    setMonth(next.month);
    const inCurrentMonth = selectedDate.startsWith(
      `${next.year}-${String(next.month).padStart(2, "0")}`
    );
    if (!inCurrentMonth) {
      const today = todayIso();
      const todayInMonth = today.startsWith(
        `${next.year}-${String(next.month).padStart(2, "0")}`
      );
      setSelectedDate(
        todayInMonth
          ? today
          : `${next.year}-${String(next.month).padStart(2, "0")}-01`
      );
    }
  }

  function chooseEmployee(value: string) {
    setEmployeeId(value);
    const next = new URLSearchParams(searchParams);
    if (value) next.set("employee", value);
    else next.delete("employee");
    setSearchParams(next, { replace: true });
  }

  function selectDay(day: AttendanceCalendarDay) {
    setSelectedDate(day.date);
  }

  function openEditor(day: AttendanceCalendarDay) {
    if (!isAdmin || !employeeId || day.date > currentToday) return;
    if (day.is_weekend && !day.has_record) return;
    setEditingDay(day);
    setForm({
      date: day.date,
      check_in: day.check_in ? day.check_in.slice(0, 16) : "",
      check_out: day.check_out ? day.check_out.slice(0, 16) : "",
      status: day.has_record ? day.status : "PRESENT",
    });
    setError("");
  }

  function openRequestModalForDay(dateStr: string) {
    setRequestForm({
      date: dateStr,
      request_type: "FORGOT_CHECKIN",
      reason: "",
      requested_check_in: `${dateStr}T08:00`,
      requested_check_out: `${dateStr}T17:00`,
    });
    setRequestFeedback("");
    setShowRequestModal(true);
  }

  function handleExportCalendarCsv() {
    if (!calendar) return;
    const empLabel = selectedEmployee
      ? `${selectedEmployee.employee_code}_${selectedEmployee.full_name}`
      : "my_attendance";
    const headers = [
      "Date",
      "Status",
      "Check-in",
      "Check-out",
      "Working Minutes",
      "Late Minutes",
      "Early Leave Minutes",
      "Overtime Minutes",
      "AI Match %",
      "Liveness %",
      "Verification",
    ];
    const rows = calendar.days.map((d) => [
      d.date,
      d.has_record ? d.status : d.is_weekend ? "WEEKEND" : "NO_RECORD",
      d.check_in ? formatClock(d.check_in) : "",
      d.check_out ? formatClock(d.check_out) : "",
      d.working_minutes || 0,
      d.late_minutes || 0,
      d.early_leave_minutes || 0,
      d.overtime_minutes || 0,
      d.face_similarity != null ? (d.face_similarity * 100).toFixed(1) : "",
      d.liveness_score != null ? (d.liveness_score * 100).toFixed(1) : "",
      d.verification_status || "",
    ]);
    downloadCsvFile(
      `timesheet_${empLabel}_${year}_${String(month).padStart(2, "0")}.csv`,
      headers,
      rows
    );
  }

  function handleExportCompanyReportCsv() {
    if (!report) return;
    const headers = [
      "Employee Code",
      "Full Name",
      "Department",
      "Present Days",
      "Late Days",
      "Absent Days",
      "Working Hours",
      "Total Working Minutes",
      "Total Late Minutes",
      "Early Leave Minutes",
      "Overtime Minutes",
      "Avg Face Similarity %",
      "Avg Liveness %",
    ];
    const rows = report.rows.map((r) => [
      r.employee_code,
      r.full_name,
      r.department || "Unassigned",
      r.present_days,
      r.late_days,
      r.absent_days,
      (r.total_working_minutes / 60).toFixed(1),
      r.total_working_minutes,
      r.total_late_minutes,
      r.total_early_leave_minutes,
      r.total_overtime_minutes,
      r.avg_face_similarity != null ? (r.avg_face_similarity * 100).toFixed(1) : "",
      r.avg_liveness_score != null ? (r.avg_liveness_score * 100).toFixed(1) : "",
    ]);
    downloadCsvFile(
      `company_payroll_${year}_${String(month).padStart(2, "0")}.csv`,
      headers,
      rows
    );
  }

  const manageable = Boolean(
    isAdmin &&
      employeeId &&
      selectedDay &&
      selectedDay.date <= currentToday &&
      (!selectedDay.is_weekend || selectedDay.has_record)
  );

  async function saveDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeId) return;
    try {
      setSaving(true);
      if (editingDay?.attendance_id) {
        await updateAttendance(editingDay.attendance_id, {
          check_in: form.check_in || null,
          check_out: form.check_out || null,
          status: form.status,
        });
      } else {
        await createAttendance({
          employee_id: Number(employeeId),
          date: form.date,
          check_in: form.check_in || null,
          check_out: form.check_out || null,
          status: form.status,
        });
      }
      setEditingDay(null);
      await loadCalendar();
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to save attendance."));
    } finally {
      setSaving(false);
    }
  }

  async function removeDay() {
    if (!editingDay?.attendance_id || !window.confirm("Delete this attendance record?")) {
      return;
    }
    try {
      setSaving(true);
      await deleteAttendance(editingDay.attendance_id);
      setEditingDay(null);
      await loadCalendar();
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to delete attendance."));
    } finally {
      setSaving(false);
    }
  }

  async function submitAttendanceRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestForm.reason.trim()) return;
    try {
      setRequestSubmitting(true);
      await createAttendanceRequest({
        date: requestForm.date,
        request_type: requestForm.request_type,
        reason: requestForm.reason.trim(),
        requested_check_in:
          requestForm.request_type === "LEAVE"
            ? null
            : requestForm.requested_check_in || null,
        requested_check_out:
          requestForm.request_type === "LEAVE"
            ? null
            : requestForm.requested_check_out || null,
      });
      setShowRequestModal(false);
      setRequestFeedback("Your request has been submitted for Admin review.");
      await loadRequests();
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to submit attendance request."));
    } finally {
      setRequestSubmitting(false);
    }
  }

  async function handleReviewRequest(
    reqId: number,
    decision: "APPROVED" | "REJECTED"
  ) {
    const note = window.prompt(
      decision === "APPROVED"
        ? "Optional approval note (leave blank if none):"
        : "Reason for rejection (optional):",
      ""
    );
    if (note === null) return;
    try {
      setReviewingId(reqId);
      await reviewAttendanceRequest(reqId, {
        status: decision,
        admin_note: note || null,
      });
      await loadRequests();
      await loadCalendar();
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to review request."));
    } finally {
      setReviewingId(null);
    }
  }

  const shift = daySchedule?.shift;
  const selectedLabel = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(
    "en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric" }
  );

  const pendingCount = requests.filter((r) => r.status === "PENDING").length;

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
            Attendance &amp; Payroll Hub
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            {isAdmin ? "Attendance & Timesheets" : "My Attendance & Requests"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isAdmin
              ? "Manage daily check-ins, export monthly payroll timesheets, and approve employee requests."
              : "Track your monthly working hours, shift schedule, and submit attendance explanations."}
          </p>
        </div>

        {/* NAVIGATION TABS */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
          <button
            type="button"
            onClick={() => setTab("calendar")}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
              activeTab === "calendar"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <CalendarDays size={15} />
            Calendar View
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setTab("timesheet")}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                activeTab === "timesheet"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <FileSpreadsheet size={15} />
              Monthly Timesheet Export
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab("requests")}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
              activeTab === "requests"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <FileText size={15} />
            {isAdmin ? "Approval Requests" : "My Requests"}
            {pendingCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${
                  activeTab === "requests"
                    ? "bg-white text-blue-600"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {pendingCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {requestFeedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {requestFeedback}
        </div>
      )}

      {error && !loading && (
        <ErrorState message={error} onRetry={() => void loadCalendar()} />
      )}

      {/* =========================================================
          TAB 2: ADMIN MONTHLY PAYROLL TIMESHEET REPORT
      ========================================================= */}
      {activeTab === "timesheet" && isAdmin && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => moveMonth(-1)}
                  className="h-9 w-9 rounded-lg border border-slate-200 text-lg text-slate-600 hover:bg-slate-50"
                >
                  ‹
                </button>
                <span className="min-w-[140px] text-center text-sm font-bold text-slate-900">
                  {monthNames[month - 1]} {year}
                </span>
                <button
                  type="button"
                  onClick={() => moveMonth(1)}
                  className="h-9 w-9 rounded-lg border border-slate-200 text-lg text-slate-600 hover:bg-slate-50"
                >
                  ›
                </button>
              </div>

              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500"
              >
                <option value="">All Departments</option>
                {departments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleExportCompanyReportCsv}
              disabled={!report || report.rows.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              <Download size={15} />
              Export Payroll Excel (.CSV)
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {reportLoading ? (
              <LoadingState message="Calculating monthly company timesheet..." />
            ) : !report || report.rows.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-500">
                No employee records found for this filter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3.5">Code</th>
                      <th className="px-4 py-3.5">Employee</th>
                      <th className="px-4 py-3.5">Department</th>
                      <th className="px-4 py-3.5 text-center">Present</th>
                      <th className="px-4 py-3.5 text-center">Late</th>
                      <th className="px-4 py-3.5 text-center">Absent</th>
                      <th className="px-4 py-3.5 text-right">Working Time</th>
                      <th className="px-4 py-3.5 text-right">Late Mins</th>
                      <th className="px-4 py-3.5 text-right">Overtime</th>
                      <th className="px-4 py-3.5 text-right">AI Match</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.rows.map((row) => (
                      <tr key={row.employee_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3.5 font-mono text-xs font-bold text-blue-600">
                          {row.employee_code}
                        </td>
                        <td className="px-4 py-3.5 font-semibold text-slate-900">
                          {row.full_name}
                        </td>
                        <td className="px-4 py-3.5 text-slate-500">
                          {row.department || "—"}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                            {row.present_days}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700">
                            {row.late_days}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700">
                            {row.absent_days}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-bold text-slate-800">
                          {formatMinutes(row.total_working_minutes)}
                        </td>
                        <td className="px-4 py-3.5 text-right text-amber-700">
                          {row.total_late_minutes}m
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold text-blue-600">
                          {formatMinutes(row.total_overtime_minutes)}
                        </td>
                        <td className="px-4 py-3.5 text-right text-xs font-semibold text-slate-600">
                          {row.avg_face_similarity != null
                            ? `${(row.avg_face_similarity * 100).toFixed(1)}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================
          TAB 3: EXPLANATION & LEAVE REQUESTS WORKFLOW
      ========================================================= */}
      {activeTab === "requests" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {isAdmin
                  ? "Employee Attendance & Leave Requests"
                  : "My Explanation & Leave Requests"}
              </h2>
              <p className="text-xs text-slate-500">
                {isAdmin
                  ? "Approving a request automatically updates the employee's attendance record."
                  : "Submit a request if you forgot to check in/out, arrived late with a valid reason, or took leave."}
              </p>
            </div>
            {!isAdmin && (
              <button
                type="button"
                onClick={() => openRequestModalForDay(selectedDate)}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
              >
                <Send size={14} />
                + Submit New Request
              </button>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {requestsLoading ? (
              <LoadingState message="Loading requests..." />
            ) : requests.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-500">
                No attendance or leave requests submitted yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {requests.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          {item.employee_name || `Employee #${item.employee_id}`}
                        </span>
                        {item.employee_code && (
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                            {item.employee_code}
                          </span>
                        )}
                        <span className="rounded-md bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700">
                          {REQUEST_TYPE_LABELS[item.request_type] || item.request_type}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            item.status === "APPROVED"
                              ? "bg-emerald-50 text-emerald-700"
                              : item.status === "REJECTED"
                                ? "bg-rose-50 text-rose-700"
                                : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-500">
                        Date: <strong className="text-slate-700">{item.date}</strong>
                        {item.requested_check_in && (
                          <> · Requested In: {formatClock(item.requested_check_in)}</>
                        )}
                        {item.requested_check_out && (
                          <> · Requested Out: {formatClock(item.requested_check_out)}</>
                        )}
                      </p>
                      <p className="text-sm text-slate-700">
                        <span className="font-semibold text-slate-500">Reason: </span>
                        {item.reason}
                      </p>
                      {item.admin_note && (
                        <p className="text-xs italic text-slate-500">
                          Admin Note: {item.admin_note}
                        </p>
                      )}
                    </div>

                    {isAdmin && item.status === "PENDING" && (
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          disabled={reviewingId === item.id}
                          onClick={() => void handleReviewRequest(item.id, "APPROVED")}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircle2 size={14} />
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={reviewingId === item.id}
                          onClick={() => void handleReviewRequest(item.id, "REJECTED")}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                        >
                          <XCircle size={14} />
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================
          TAB 1: CALENDAR VIEW
      ========================================================= */}
      {activeTab === "calendar" && (
        <>
          {isAdmin && (
            <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-end gap-3">
                <label className="w-full sm:w-52">
                  <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Department Filter
                  </span>
                  <select
                    value={departmentFilter}
                    onChange={(e) => setDepartmentFilter(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-blue-500"
                  >
                    <option value="">All Departments</option>
                    {departments.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="w-full sm:w-72">
                  <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Employee
                  </span>
                  <select
                    value={employeeId}
                    onChange={(event) => chooseEmployee(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">Select an employee</option>
                    {filteredEmployees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.full_name} ({employee.employee_code})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {calendar && (
                <button
                  type="button"
                  onClick={handleExportCalendarCsv}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                  <Download size={15} />
                  Export Employee CSV
                </button>
              )}
            </div>
          )}

          {isAdmin && !employeeId ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm">
              <p className="font-semibold text-slate-700">
                Choose an employee to view their calendar.
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Attendance records and the assigned shift load together.
              </p>
            </div>
          ) : loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <LoadingState message="Loading attendance calendar..." />
            </div>
          ) : (
            calendar && (
              <>
                {/* MONTHLY SUMMARY STRIP */}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      Present / Late Days
                    </p>
                    <p className="mt-1.5 text-2xl font-extrabold text-slate-900">
                      {calendarSummary.presentDays + calendarSummary.lateDays}{" "}
                      <span className="text-sm font-semibold text-slate-400">days</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {calendarSummary.presentDays} on-time · {calendarSummary.lateDays} late
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      Total Working Hours
                    </p>
                    <p className="mt-1.5 text-2xl font-extrabold text-blue-600">
                      {formatMinutes(calendarSummary.workingMinutes)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Recorded shift hours
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      Total Late Minutes
                    </p>
                    <p className="mt-1.5 text-2xl font-extrabold text-amber-600">
                      {calendarSummary.lateMinutes}m
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Beyond shift tolerance
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      Overtime (OT)
                    </p>
                    <p className="mt-1.5 text-2xl font-extrabold text-emerald-600">
                      {formatMinutes(calendarSummary.overtimeMinutes)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Extra hours after shift
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900">
                          {selectedEmployee?.full_name || "My attendance"}
                        </h2>
                        <p className="text-sm text-slate-500">
                          {monthNames[month - 1]} {year} · {calendar.total_days} days
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isAdmin && (
                          <button
                            type="button"
                            onClick={handleExportCalendarCsv}
                            className="mr-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                          >
                            <Download size={14} />
                            Export CSV
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Previous month"
                          onClick={() => moveMonth(-1)}
                          className="h-9 w-9 rounded-lg border border-slate-200 text-lg text-slate-600 hover:bg-slate-50"
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setYear(now.getFullYear());
                            setMonth(now.getMonth() + 1);
                            setSelectedDate(todayIso());
                          }}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                        >
                          Today
                        </button>
                        <button
                          type="button"
                          aria-label="Next month"
                          onClick={() => moveMonth(1)}
                          className="h-9 w-9 rounded-lg border border-slate-200 text-lg text-slate-600 hover:bg-slate-50"
                        >
                          ›
                        </button>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                        {weekDays.map((day) => (
                          <div
                            key={day}
                            className="px-2 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-500"
                          >
                            {day}
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7">
                        {cells.map((date, index) => {
                          const day = date ? daysByDate.get(date) : undefined;
                          const future = Boolean(day && day.date > currentToday);
                          const selected = Boolean(day && day.date === selectedDate);
                          return (
                            <div
                              key={date || `empty-${index}`}
                              onClick={() => day && selectDay(day)}
                              className={`min-h-[112px] border-b border-r border-slate-100 p-2 ${
                                !date ? "bg-slate-50/60" : ""
                              } ${day?.is_weekend ? "bg-slate-50" : ""} ${
                                day ? "cursor-pointer hover:bg-blue-50/40" : ""
                              }`}
                            >
                              {day && (
                                <div
                                  className={`flex h-full min-h-[96px] flex-col rounded-xl border p-2 ${statusClass(
                                    day.status,
                                    future,
                                    day.has_record,
                                    selected
                                  )}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="text-sm font-bold">
                                      {Number(date.slice(-2))}
                                    </span>
                                    <span className="text-[10px] font-bold uppercase">
                                      {future
                                        ? "Upcoming"
                                        : day.has_record
                                          ? day.status
                                          : day.is_weekend
                                            ? "Weekend"
                                            : "No record"}
                                    </span>
                                  </div>
                                  <div className="mt-auto text-xs">
                                    {future ? (
                                      <span>Not started</span>
                                    ) : (
                                      <>
                                        <div>
                                          In <strong>{formatClock(day.check_in)}</strong>
                                        </div>
                                        <div>
                                          Out <strong>{formatClock(day.check_out)}</strong>
                                        </div>
                                        {day.working_minutes ? (
                                          <div className="mt-0.5 text-[10px] font-semibold opacity-80">
                                            Work: {formatMinutes(day.working_minutes)}
                                          </div>
                                        ) : null}
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
                      <span>
                        <i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
                        Present
                      </span>
                      <span>
                        <i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
                        Late
                      </span>
                      <span>
                        <i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-rose-400" />
                        Absent
                      </span>
                      <span>
                        <i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-slate-300" />
                        No record / weekend
                      </span>
                      <span>
                        <i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-blue-400" />
                        Upcoming
                      </span>
                    </div>
                  </div>

                  {/* SELECTED DAY SIDEBAR */}
                  <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                        <CalendarDays size={20} />
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                          Selected day
                        </p>
                        <h2 className="mt-1 text-lg font-bold text-slate-900">
                          {selectedLabel}
                        </h2>
                      </div>
                    </div>

                    {scheduleLoading ? (
                      <p className="mt-6 text-sm text-slate-500">
                        Loading assigned shift...
                      </p>
                    ) : scheduleError ? (
                      <p className="mt-6 text-sm text-rose-600">{scheduleError}</p>
                    ) : daySchedule?.schedule ? (
                      <>
                        <p className="mt-6 text-sm font-semibold text-slate-500">
                          {daySchedule.schedule.name}
                        </p>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          {daySchedule.schedule.code}
                        </p>
                      </>
                    ) : (
                      <h3 className="mt-6 text-base font-bold text-slate-900">
                        No shift assigned
                      </h3>
                    )}

                    {shift ? (
                      <div className="mt-5 grid gap-3">
                        <div className="rounded-xl bg-slate-50 p-4">
                          <Clock3 className="text-blue-600" size={18} />
                          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Shift
                          </p>
                          <p className="mt-1 font-bold text-slate-900">{shift.name}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Hours
                          </p>
                          <p className="mt-2 font-bold text-slate-900">
                            {formatShiftTime(shift.start_time)} -{" "}
                            {formatShiftTime(shift.end_time)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Late tolerance
                          </p>
                          <p className="mt-2 font-bold text-slate-900">
                            {shift.late_tolerance_minutes} minutes
                          </p>
                        </div>
                      </div>
                    ) : (
                      !scheduleLoading &&
                      !scheduleError && (
                        <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                          There is no active schedule for this date.
                        </div>
                      )
                    )}

                    {selectedDay && selectedDay.date <= currentToday && (
                      <div className="mt-5 space-y-2 border-t border-slate-100 pt-5 text-sm text-slate-600">
                        <div className="flex justify-between">
                          <span>Check-in:</span>
                          <strong>{formatClock(selectedDay.check_in)}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span>Check-out:</span>
                          <strong>{formatClock(selectedDay.check_out)}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span>Status:</span>
                          <strong>
                            {selectedDay.has_record
                              ? selectedDay.status
                              : selectedDay.is_weekend
                                ? "Weekend"
                                : "No record"}
                          </strong>
                        </div>
                        {selectedDay.has_record && (
                          <>
                            <div className="flex justify-between">
                              <span>Working Duration:</span>
                              <strong className="text-blue-600">
                                {formatMinutes(selectedDay.working_minutes)}
                              </strong>
                            </div>
                            {(selectedDay.late_minutes || 0) > 0 && (
                              <div className="flex justify-between text-amber-700">
                                <span>Late Arrival:</span>
                                <strong>{selectedDay.late_minutes} mins</strong>
                              </div>
                            )}
                            {(selectedDay.overtime_minutes || 0) > 0 && (
                              <div className="flex justify-between text-emerald-700">
                                <span>Overtime (OT):</span>
                                <strong>
                                  {formatMinutes(selectedDay.overtime_minutes)}
                                </strong>
                              </div>
                            )}
                            {selectedDay.face_similarity != null && (
                              <div className="mt-2 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                                <span className="inline-flex items-center gap-1 font-semibold">
                                  <ShieldCheck size={14} /> AI Biometric Match
                                </span>
                                <strong>
                                  {(selectedDay.face_similarity * 100).toFixed(1)}%
                                </strong>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {manageable && selectedDay && (
                      <button
                        type="button"
                        onClick={() => openEditor(selectedDay)}
                        className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                      >
                        {selectedDay.has_record ? "Edit record" : "Add record"}
                      </button>
                    )}

                    {!isAdmin && selectedDay && (
                      <button
                        type="button"
                        onClick={() => openRequestModalForDay(selectedDay.date)}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        <Send size={15} />
                        Submit Explanation / Leave
                      </button>
                    )}
                  </aside>
                </div>
              </>
            )
          )}
        </>
      )}

      {/* ADMIN EDIT ATTENDANCE MODAL */}
      {editingDay && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={saveDay}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {editingDay.has_record ? "Edit attendance" : "Add attendance"}
                </h2>
                <p className="text-sm text-slate-500">
                  {form.date} · {selectedEmployee?.full_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingDay(null)}
                className="text-xl text-slate-400 hover:text-slate-700"
              >
                ×
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className="mb-1 block text-sm font-semibold text-slate-700">
                  Check-in
                </span>
                <input
                  type="datetime-local"
                  value={form.check_in}
                  onChange={(event) =>
                    setForm({ ...form, check_in: event.target.value })
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label>
                <span className="mb-1 block text-sm font-semibold text-slate-700">
                  Check-out
                </span>
                <input
                  type="datetime-local"
                  value={form.check_out}
                  onChange={(event) =>
                    setForm({ ...form, check_out: event.target.value })
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">
                Status
              </span>
              <select
                value={form.status}
                onChange={(event) =>
                  setForm({
                    ...form,
                    status: event.target.value as AttendanceStatus,
                  })
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="PRESENT">PRESENT</option>
                <option value="LATE">LATE</option>
                <option value="ABSENT">ABSENT</option>
              </select>
            </label>
            <div className="flex justify-between pt-2">
              {editingDay.attendance_id ? (
                <button
                  type="button"
                  onClick={() => void removeDay()}
                  disabled={saving}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingDay(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* EMPLOYEE SUBMIT EXPLANATION / LEAVE MODAL */}
      {showRequestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={submitAttendanceRequest}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Submit Attendance Explanation / Leave
                </h2>
                <p className="text-sm text-slate-500">
                  Your request will be sent to HR / Admin for review.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRequestModal(false)}
                className="text-xl text-slate-400 hover:text-slate-700"
              >
                ×
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className="mb-1 block text-sm font-semibold text-slate-700">
                  Date
                </span>
                <input
                  type="date"
                  required
                  value={requestForm.date}
                  onChange={(e) =>
                    setRequestForm({ ...requestForm, date: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>

              <label>
                <span className="mb-1 block text-sm font-semibold text-slate-700">
                  Request Type
                </span>
                <select
                  value={requestForm.request_type}
                  onChange={(e) =>
                    setRequestForm({
                      ...requestForm,
                      request_type: e.target.value as AttendanceRequestType,
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="FORGOT_CHECKIN">Forgot Check-in / Out</option>
                  <option value="LATE_EXPLANATION">Late Arrival Explanation</option>
                  <option value="EARLY_LEAVE">Early Leave Explanation</option>
                  <option value="LEAVE">Authorized Leave (Day Off)</option>
                </select>
              </label>
            </div>

            {requestForm.request_type !== "LEAVE" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-1 block text-sm font-semibold text-slate-700">
                    Actual Check-in Time
                  </span>
                  <input
                    type="datetime-local"
                    value={requestForm.requested_check_in}
                    onChange={(e) =>
                      setRequestForm({
                        ...requestForm,
                        requested_check_in: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-sm font-semibold text-slate-700">
                    Actual Check-out Time
                  </span>
                  <input
                    type="datetime-local"
                    value={requestForm.requested_check_out}
                    onChange={(e) =>
                      setRequestForm({
                        ...requestForm,
                        requested_check_out: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
              </div>
            )}

            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">
                Reason / Explanation
              </span>
              <textarea
                rows={3}
                required
                placeholder="Explain why you missed check-in, arrived late, or need leave..."
                value={requestForm.reason}
                onChange={(e) =>
                  setRequestForm({ ...requestForm, reason: e.target.value })
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRequestModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={requestSubmitting}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {requestSubmitting ? "Submitting..." : "Submit Request"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
