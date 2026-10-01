import { FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3 } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import {
  createAttendance,
  deleteAttendance,
  getAttendanceCalendar,
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
  AttendanceStatus,
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

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [employees, setEmployees] = useState<Employee[]>([]);
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

  useEffect(() => {
    if (!isAdmin) return;
    getEmployees()
      .then(setEmployees)
      .catch((err) => setError(getApiErrorMessage(err, "Unable to load employees.")));
  }, [isAdmin]);

  useEffect(() => {
    void loadCalendar();
  }, [year, month, employeeId, isAdmin]);

  useEffect(() => {
    void loadDaySchedule(selectedDate);
  }, [selectedDate, employeeId, isAdmin]);

  const selectedEmployee = employees.find(
    (employee) => String(employee.id) === employeeId
  );
  const currentToday = todayIso();
  const daysByDate = useMemo(
    () => new Map(calendar?.days.map((day) => [day.date, day])),
    [calendar]
  );
  const selectedDay = daysByDate.get(selectedDate);
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
    const inCurrentMonth =
      selectedDate.startsWith(
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

  const shift = daySchedule?.shift;
  const selectedLabel = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(
    "en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric" }
  );

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
            Attendance overview
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            {isAdmin ? "Attendance calendar" : "My calendar"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Check-ins by day, plus the assigned shift for the selected date.
          </p>
        </div>
        {isAdmin && (
          <label className="w-full md:w-72">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Employee
            </span>
            <select
              value={employeeId}
              onChange={(event) => chooseEmployee(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Select an employee</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.full_name} ({employee.employee_code})
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {error && !loading && (
        <ErrorState message={error} onRetry={() => void loadCalendar()} />
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
                <p className="mt-6 text-sm text-slate-500">Loading assigned shift...</p>
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
                      {formatShiftTime(shift.start_time)} - {formatShiftTime(shift.end_time)}
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
                <div className="mt-5 border-t border-slate-100 pt-5 text-sm text-slate-600">
                  <p>
                    In <strong>{formatClock(selectedDay.check_in)}</strong>
                  </p>
                  <p className="mt-1">
                    Out <strong>{formatClock(selectedDay.check_out)}</strong>
                  </p>
                  <p className="mt-1">
                    Status{" "}
                    <strong>
                      {selectedDay.has_record
                        ? selectedDay.status
                        : selectedDay.is_weekend
                          ? "Weekend"
                          : "No record"}
                    </strong>
                  </p>
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
            </aside>
          </div>
        )
      )}

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
    </section>
  );
}
