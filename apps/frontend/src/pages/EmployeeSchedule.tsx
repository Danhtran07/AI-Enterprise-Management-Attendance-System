import { useEffect, useState } from "react";
import { CalendarDays, Clock3, UserRound } from "lucide-react";
import { useParams } from "react-router-dom";

import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import { getApiErrorMessage } from "../api/error";
import { getEmployeeSchedule, getMySchedule } from "../api/schedule.api";
import { getEmployees } from "../api/employee.api";
import type { Employee } from "../types/employee";
import type { EmployeeSchedule } from "../types/schedule";

function formatTime(value: string) { return value.slice(0, 5); }

export default function EmployeeSchedule() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const isAdmin = (() => { try { return JSON.parse(localStorage.getItem("user") || "{}").role === "ADMIN"; } catch { return false; } })();
  const [targetDate, setTargetDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<EmployeeSchedule | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadSchedule() {
    try { setLoading(true); setError(""); const result = employeeId && employeeId !== "me" && isAdmin ? await getEmployeeSchedule(Number(employeeId), targetDate) : await getMySchedule(targetDate); setData(result); if (isAdmin && employeeId && employeeId !== "me") { const employees = await getEmployees(); setEmployee(employees.find((item) => item.id === Number(employeeId)) || null); } }
    catch (err) { setError(getApiErrorMessage(err, "Unable to load employee schedule.")); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadSchedule(); }, [employeeId, targetDate, isAdmin]);
  if (loading) return <LoadingState message="Loading schedule..." />;
  if (error) return <ErrorState message={error} onRetry={() => void loadSchedule()} />;
  const shift = data?.shift;
  return <section className="mx-auto max-w-4xl space-y-6"><header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Personal planning</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{isAdmin && employee ? `${employee.full_name}'s schedule` : "My schedule"}</h1><p className="mt-1 text-sm text-slate-500">Your assigned shift for a selected day.</p></div><label className="w-full sm:w-48"><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Date</span><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label></header><div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-start gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">{isAdmin ? <UserRound size={22} /> : <CalendarDays size={22} />}</div><div><p className="text-sm font-semibold text-slate-500">{new Date(`${targetDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>{data?.schedule ? <><h2 className="mt-1 text-xl font-bold text-slate-900">{data.schedule.name}</h2><p className="mt-1 text-sm text-slate-500">{data.schedule.code}</p></> : <h2 className="mt-1 text-xl font-bold text-slate-900">No shift assigned</h2>}</div></div>{shift ? <div className="mt-8 grid gap-4 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4"><Clock3 className="text-blue-600" size={18} /><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Shift</p><p className="mt-1 font-bold text-slate-900">{shift.name}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Hours</p><p className="mt-4 font-bold text-slate-900">{formatTime(shift.start_time)} - {formatTime(shift.end_time)}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Late tolerance</p><p className="mt-4 font-bold text-slate-900">{shift.late_tolerance_minutes} minutes</p></div></div> : <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">There is no active schedule for this date.</div>}</div></section>;
}