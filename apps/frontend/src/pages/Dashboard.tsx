import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  CalendarCheck2,
  Check,
  CircleAlert,
  Clock3,
  FileCheck2,
  ScanFace,
  ShieldCheck,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { getEmployees } from "../api/employee.api";
import {
  getAIBiometricsMetrics,
  getAttendanceRequests,
  getAttendances,
} from "../api/attendance.api";
import { getMySchedule } from "../api/schedule.api";
import { getApiErrorMessage } from "../api/error";

import type { Employee } from "../types/employee";
import type {
  AIBiometricsMetricsResponse,
  Attendance,
  AttendanceRequestItem,
} from "../types/attendance";
import type { EmployeeSchedule } from "../types/schedule";

import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import EmptyState from "../components/EmptyState";

interface StoredUser {
  username?: string;
  role?: string;
}

interface Statistic {
  label: string;
  value: string | number;
  description: string;
  icon: LucideIcon;
  iconClass: string;
}

function formatTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHours(minutes: number) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

export default function Dashboard() {
  const user = useMemo<StoredUser>(() => {
    const storedUser = localStorage.getItem("user");
    if (!storedUser) return {};
    try {
      return JSON.parse(storedUser);
    } catch {
      return {};
    }
  }, []);

  const username = user.username || "User";
  const isAdmin = user.role === "ADMIN";

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [aiMetrics, setAiMetrics] = useState<AIBiometricsMetricsResponse | null>(null);
  const [requests, setRequests] = useState<AttendanceRequestItem[]>([]);
  const [mySchedule, setMySchedule] = useState<EmployeeSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const today = new Date().toISOString().split("T")[0];
  const currentMonthPrefix = today.slice(0, 7);

  const displayDate = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  async function loadDashboard() {
    try {
      setLoading(true);
      setError("");

      if (isAdmin) {
        const [employeeData, attendanceData, aiData, reqData] = await Promise.all([
          getEmployees(),
          getAttendances(),
          getAIBiometricsMetrics().catch(() => null),
          getAttendanceRequests().catch(() => []),
        ]);
        setEmployees(employeeData);
        setAttendances(attendanceData);
        setAiMetrics(aiData);
        setRequests(reqData);
      } else {
        const [attendanceData, scheduleData, reqData] = await Promise.all([
          getAttendances(),
          getMySchedule(today).catch(() => null),
          getAttendanceRequests().catch(() => []),
        ]);
        setAttendances(attendanceData);
        setMySchedule(scheduleData);
        setRequests(reqData);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load dashboard data."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, [isAdmin]);

  const todayAttendances = useMemo(
    () => attendances.filter((item) => item.date === today),
    [attendances, today]
  );

  const monthAttendances = useMemo(
    () => attendances.filter((item) => item.date.startsWith(currentMonthPrefix)),
    [attendances, currentMonthPrefix]
  );

  const totalEmployees = employees.length;
  const presentCount = todayAttendances.filter((item) => item.status === "PRESENT").length;
  const lateCount = todayAttendances.filter((item) => item.status === "LATE").length;
  const absentCount = Math.max(
    0,
    isAdmin
      ? totalEmployees - (presentCount + lateCount)
      : todayAttendances.filter((item) => item.status === "ABSENT").length
  );

  const attendanceRate =
    totalEmployees > 0
      ? Math.round(((presentCount + lateCount) / totalEmployees) * 100)
      : 0;

  const pendingRequestsCount = useMemo(
    () => requests.filter((r) => r.status === "PENDING").length,
    [requests]
  );

  const employeeMap = useMemo(() => {
    const map = new Map<number, Employee>();
    employees.forEach((employee) => {
      map.set(employee.id, employee);
    });
    return map;
  }, [employees]);

  const departmentStats = useMemo(() => {
    if (!isAdmin || employees.length === 0) return [];
    const groups = new Map<
      string,
      { department: string; total: number; checkedIn: number; late: number }
    >();

    const todayByEmp = new Map<number, Attendance>();
    todayAttendances.forEach((a) => todayByEmp.set(a.employee_id, a));

    employees.forEach((emp) => {
      const dept = emp.department?.trim() || "General / Unassigned";
      const current = groups.get(dept) || {
        department: dept,
        total: 0,
        checkedIn: 0,
        late: 0,
      };
      current.total += 1;
      const att = todayByEmp.get(emp.id);
      if (att && (att.status === "PRESENT" || att.status === "LATE")) {
        current.checkedIn += 1;
      }
      if (att && att.status === "LATE") {
        current.late += 1;
      }
      groups.set(dept, current);
    });

    return Array.from(groups.values()).sort((a, b) => b.total - a.total);
  }, [employees, todayAttendances, isAdmin]);

  const adminStatistics: Statistic[] = [
    {
      label: "Total Employees",
      value: totalEmployees,
      description: `${aiMetrics?.enrolled_employees ?? employees.filter((e) => e.face_enrolled).length} face-enrolled profiles`,
      icon: UsersRound,
      iconClass: "bg-blue-50 text-blue-600",
    },
    {
      label: "Present Today",
      value: presentCount,
      description: `${attendanceRate}% company attendance rate`,
      icon: Check,
      iconClass: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "Late Today",
      value: lateCount,
      description: "Checked in after shift tolerance",
      icon: Clock3,
      iconClass: "bg-amber-50 text-amber-600",
    },
    {
      label: "Pending Requests",
      value: pendingRequestsCount,
      description: `${absentCount} not checked in yet today`,
      icon: FileCheck2,
      iconClass: "bg-purple-50 text-purple-600",
    },
  ];

  const myTodayRecord = todayAttendances[0] || null;
  const myPresentMonth = monthAttendances.filter(
    (a) => a.status === "PRESENT" || a.status === "LATE"
  ).length;
  const myLateMonth = monthAttendances.filter((a) => a.status === "LATE").length;
  const myWorkingMinutesMonth = monthAttendances.reduce(
    (sum, a) => sum + (a.working_minutes || 0),
    0
  );
  const myOvertimeMinutesMonth = monthAttendances.reduce(
    (sum, a) => sum + (a.overtime_minutes || 0),
    0
  );

  const employeeStatistics: Statistic[] = [
    {
      label: "Today's Status",
      value: myTodayRecord ? myTodayRecord.status : "NOT CHECKED IN",
      description: myTodayRecord?.check_in
        ? `In: ${formatTime(myTodayRecord.check_in)} · Out: ${formatTime(myTodayRecord.check_out)}`
        : "Use Face Attendance to check in",
      icon: CalendarCheck2,
      iconClass: "bg-blue-50 text-blue-600",
    },
    {
      label: "Attendance This Month",
      value: `${myPresentMonth} days`,
      description: `${myLateMonth} late arrival(s) this month`,
      icon: Check,
      iconClass: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "Working Hours (Month)",
      value: formatHours(myWorkingMinutesMonth),
      description: `Overtime: ${formatHours(myOvertimeMinutesMonth)}`,
      icon: Clock3,
      iconClass: "bg-amber-50 text-amber-600",
    },
    {
      label: "My Requests",
      value: requests.length,
      description: `${pendingRequestsCount} pending admin approval`,
      icon: FileCheck2,
      iconClass: "bg-purple-50 text-purple-600",
    },
  ];

  const recentAttendance = useMemo(() => {
    const source = isAdmin ? todayAttendances : attendances;
    return [...source]
      .sort((a, b) => {
        const timeA = a.check_in ? new Date(a.check_in).getTime() : 0;
        const timeB = b.check_in ? new Date(b.check_in).getTime() : 0;
        return timeB - timeA;
      })
      .slice(0, 6);
  }, [todayAttendances, attendances, isAdmin]);

  const weeklyAttendance = useMemo(() => {
    const result: { day: string; date: string; percent: number }[] = [];
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);

    const denominator = isAdmin ? Math.max(1, totalEmployees) : 1;

    for (let i = 0; i < 5; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const dateString = date.toISOString().split("T")[0];
      const dayAttendances = attendances.filter((item) => item.date === dateString);
      const validCount = dayAttendances.filter(
        (item) => item.status === "PRESENT" || item.status === "LATE"
      ).length;
      const percent =
        isAdmin && totalEmployees === 0
          ? 0
          : Math.min(100, Math.round((validCount / denominator) * 100));

      result.push({
        day: date.toLocaleDateString("en-US", { weekday: "long" }),
        date: dateString,
        percent,
      });
    }
    return result;
  }, [attendances, totalEmployees, isAdmin]);

  if (loading) {
    return <LoadingState message="Loading dashboard..." />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadDashboard} />;
  }

  const statistics = isAdmin ? adminStatistics : employeeStatistics;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {/* PAGE HEADER */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-blue-600">
            {isAdmin ? "Enterprise SaaS Overview" : "Employee Self-Service Portal"}
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            Dashboard
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Welcome back,{" "}
            <span className="font-semibold text-slate-700">{username}</span>
            {!isAdmin && mySchedule?.shift && (
              <span className="ml-2 inline-flex items-center rounded-lg bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                Today&apos;s Shift: {mySchedule.shift.name} (
                {mySchedule.shift.start_time.slice(0, 5)} -{" "}
                {mySchedule.shift.end_time.slice(0, 5)})
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && pendingRequestsCount > 0 && (
            <Link
              to="/attendance?tab=requests"
              className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-800 no-underline shadow-sm transition hover:bg-amber-100"
            >
              <CircleAlert size={16} />
              {pendingRequestsCount} Pending Request{pendingRequestsCount > 1 ? "s" : ""}
            </Link>
          )}
          <Link
            to="/recognition"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white no-underline shadow-sm transition hover:bg-blue-700 hover:shadow-md"
          >
            <ScanFace size={17} strokeWidth={2} aria-hidden="true" />
            Face Attendance
          </Link>
          <div className="inline-flex w-fit items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-500 shadow-sm">
            {displayDate}
          </div>
        </div>
      </header>

      {/* STATISTIC CARDS */}
      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {statistics.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <div className="text-xs font-semibold text-slate-500">{stat.label}</div>
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold ${stat.iconClass}`}
              >
                <stat.icon size={20} strokeWidth={2} />
              </div>
            </div>
            <div className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
              {stat.value}
            </div>
            <div className="mt-2 text-xs font-semibold text-slate-500">
              {stat.description}
            </div>
          </div>
        ))}
      </section>

      {/* AI BIOMETRICS & ANTI-SPOOFING MONITOR (ADMIN) */}
      {isAdmin && aiMetrics && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <ShieldCheck size={20} />
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  AI Biometrics &amp; Anti-Spoofing Security Monitor
                </h2>
                <p className="text-xs text-slate-400">
                  Real-time ArcFace 512-D similarity &amp; active liveness telemetry
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              <Sparkles size={13} />
              InsightFace buffalo_l + MediaPipe Liveness Active
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold text-slate-500">Avg Face Similarity</p>
              <p className="mt-1.5 text-2xl font-extrabold text-slate-900">
                {aiMetrics.avg_face_similarity > 0
                  ? `${(aiMetrics.avg_face_similarity * 100).toFixed(1)}%`
                  : "—"}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">Cosine match confidence</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold text-slate-500">Avg Liveness Score</p>
              <p className="mt-1.5 text-2xl font-extrabold text-emerald-600">
                {aiMetrics.avg_liveness_score > 0
                  ? `${(aiMetrics.avg_liveness_score * 100).toFixed(1)}%`
                  : "—"}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">Blink + Mouth + rPPG</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold text-slate-500">Enrolled Biometrics</p>
              <p className="mt-1.5 text-2xl font-extrabold text-blue-600">
                {aiMetrics.enrolled_employees} / {totalEmployees}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {aiMetrics.total_face_embeddings} stored face vectors
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold text-slate-500">Verified Check-ins</p>
              <p className="mt-1.5 text-2xl font-extrabold text-slate-900">
                {aiMetrics.verified_count}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {aiMetrics.engine_rejected > 0
                  ? `${aiMetrics.engine_rejected} spoof/invalid blocked`
                  : "Zero spoof breaches"}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* MAIN CHARTS & RECENT FEED */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          {/* WEEKLY OVERVIEW */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {isAdmin ? "Weekly Attendance Rate" : "My Weekly Check-in Progress"}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  {isAdmin
                    ? "Employee attendance rate across Monday – Friday"
                    : "Your attendance completion during this week"}
                </p>
              </div>
              <span className="shrink-0 rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500">
                This week
              </span>
            </div>

            <div className="mt-6 space-y-4">
              {weeklyAttendance.map((item) => (
                <AttendanceRow
                  key={item.date}
                  day={item.day}
                  percent={item.percent}
                />
              ))}
            </div>
          </div>

          {/* DEPARTMENT ANALYTICS (ADMIN) */}
          {isAdmin && departmentStats.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Building2 size={18} />
                  </span>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Department Attendance Breakdown
                    </h2>
                    <p className="text-xs text-slate-400">
                      Today&apos;s check-in rate and headcount by department
                    </p>
                  </div>
                </div>
                <Link
                  to="/attendance"
                  className="text-xs font-bold text-blue-600 no-underline hover:underline"
                >
                  View Timesheets →
                </Link>
              </div>

              <div className="mt-5 space-y-4">
                {departmentStats.map((dept) => {
                  const pct =
                    dept.total > 0
                      ? Math.round((dept.checkedIn / dept.total) * 100)
                      : 0;
                  return (
                    <div key={dept.department} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700">
                          {dept.department}
                        </span>
                        <span className="font-semibold text-slate-500">
                          {dept.checkedIn}/{dept.total} present ({pct}%)
                          {dept.late > 0 ? ` · ${dept.late} late` : ""}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* RECENT ATTENDANCE */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {isAdmin ? "Recent Biometric Check-ins" : "My Recent Attendance"}
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                {isAdmin
                  ? "Latest verified check-ins with AI similarity scores"
                  : "Your latest check-in and check-out records"}
              </p>
            </div>
            <Link
              to="/attendance"
              className="shrink-0 rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-semibold text-blue-600 no-underline hover:bg-blue-50"
            >
              Open Calendar
            </Link>
          </div>

          <div className="mt-5 divide-y divide-slate-100">
            {recentAttendance.length === 0 ? (
              <div className="py-8">
                <EmptyState
                  title="No attendance records yet"
                  message="No employee check-ins have been recorded."
                />
              </div>
            ) : (
              recentAttendance.map((item) => {
                const employee = employeeMap.get(item.employee_id);
                return (
                  <Activity
                    key={item.id}
                    name={
                      isAdmin
                        ? employee?.full_name ?? `Employee #${item.employee_id}`
                        : `Date: ${item.date}`
                    }
                    department={isAdmin ? employee?.department : undefined}
                    time={item.check_in ? formatTime(item.check_in) : "-"}
                    checkOut={item.check_out ? formatTime(item.check_out) : null}
                    status={item.status}
                    similarity={item.face_similarity}
                    liveness={item.liveness_score}
                    workingMinutes={item.working_minutes}
                  />
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function AttendanceRow({ day, percent }: { day: string; percent: number }) {
  return (
    <div className="grid grid-cols-[90px_1fr_48px] items-center gap-3">
      <span className="text-xs font-semibold text-slate-500">{day}</span>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-right text-xs font-bold text-slate-500">
        {percent}%
      </span>
    </div>
  );
}

function Activity({
  name,
  department,
  time,
  checkOut,
  status,
  similarity,
  liveness,
  workingMinutes,
}: {
  name: string;
  department?: string | null;
  time: string;
  checkOut: string | null;
  status: string;
  similarity?: number | null;
  liveness?: number | null;
  workingMinutes?: number;
}) {
  const initials = name
    .replace("Date:", "")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(-2)
    .toUpperCase();

  const statusClass =
    status === "PRESENT"
      ? "bg-emerald-50 text-emerald-600"
      : status === "LATE"
      ? "bg-amber-50 text-amber-600"
      : "bg-red-50 text-red-600";

  return (
    <div className="flex items-center gap-3 py-3.5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-600">
        {initials || "AT"}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold text-slate-800">{name}</span>
          {department && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              {department}
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>
            In: <strong className="text-slate-600">{time}</strong>
            {checkOut ? (
              <>
                {" "}
                · Out: <strong className="text-slate-600">{checkOut}</strong>
              </>
            ) : null}
          </span>
          {workingMinutes && workingMinutes > 0 ? (
            <span className="text-slate-500">· {formatHours(workingMinutes)}</span>
          ) : null}
          {similarity != null && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">
              Match {(similarity * 100).toFixed(0)}%
            </span>
          )}
          {liveness != null && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600">
              Live {(liveness * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </div>

      <span
        className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${statusClass}`}
      >
        {status}
      </span>
    </div>
  );
}
