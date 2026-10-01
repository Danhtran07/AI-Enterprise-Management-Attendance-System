import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, MoonStar, ShieldCheck } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import { getApiErrorMessage } from "../api/error";
import { getSchedules, getShifts } from "../api/schedule.api";
import type { Shift, WorkSchedule } from "../types/schedule";

const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

type WorkConfigTab = "shifts" | "schedules";

function formatTime(value: string) {
  return value.slice(0, 5);
}

function isWorkConfigTab(value: string | null): value is WorkConfigTab {
  return value === "shifts" || value === "schedules";
}

export default function Schedules() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: WorkConfigTab = isWorkConfigTab(searchParams.get("tab"))
    ? searchParams.get("tab")!
    : "schedules";

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadWorkConfig() {
    try {
      setLoading(true);
      setError("");
      const [shiftData, scheduleData] = await Promise.all([
        getShifts(),
        getSchedules(),
      ]);
      setShifts(shiftData);
      setSchedules(scheduleData);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load shifts and schedules."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkConfig();
  }, []);

  const activeCount = useMemo(
    () => shifts.filter((shift) => shift.is_active).length,
    [shifts]
  );
  const overnightCount = useMemo(
    () => shifts.filter((shift) => shift.is_overnight).length,
    [shifts]
  );

  function setTab(next: WorkConfigTab) {
    setSearchParams(next === "schedules" ? {} : { tab: next }, { replace: true });
  }

  if (loading) return <LoadingState message="Loading work configuration..." />;
  if (error) return <ErrorState message={error} onRetry={() => void loadWorkConfig()} />;

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
            Work configuration
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            Shifts & schedules
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Shift time windows feed weekly patterns. Attendance policy uses the assigned shift at check-in.
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setTab("shifts")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === "shifts"
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Shifts
          </button>
          <button
            type="button"
            onClick={() => setTab("schedules")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === "schedules"
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Weekly schedules
          </button>
        </div>
      </header>

      {tab === "shifts" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <Clock3 className="text-blue-600" size={20} />
              <p className="mt-4 text-2xl font-bold text-slate-900">{shifts.length}</p>
              <p className="text-sm text-slate-500">Configured shifts</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <ShieldCheck className="text-emerald-600" size={20} />
              <p className="mt-4 text-2xl font-bold text-slate-900">{activeCount}</p>
              <p className="text-sm text-slate-500">Available for assignment</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <MoonStar className="text-violet-600" size={20} />
              <p className="mt-4 text-2xl font-bold text-slate-900">{overnightCount}</p>
              <p className="text-sm text-slate-500">Overnight shifts</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-bold text-slate-900">Shift library</h2>
              <p className="mt-1 text-sm text-slate-500">
                Policy values are captured in attendance records when employees check in.
              </p>
            </div>
            {shifts.length === 0 ? (
              <div className="px-5 py-16 text-center text-sm text-slate-500">
                No shifts have been configured yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {shifts.map((shift) => (
                  <article
                    key={shift.id}
                    className="flex flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                        <Clock3 size={20} />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold text-slate-900">{shift.name}</h3>
                          <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            {shift.code}
                          </span>
                          {!shift.is_active && (
                            <span className="rounded-md bg-rose-50 px-2 py-1 text-[10px] font-bold uppercase text-rose-600">
                              Inactive
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                          {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                          {shift.is_overnight ? " · overnight" : ""}
                        </p>
                        {shift.description && (
                          <p className="mt-1 text-sm text-slate-500">{shift.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm md:min-w-[260px]">
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="text-xs text-slate-400">Late tolerance</p>
                        <p className="mt-1 font-bold text-slate-800">
                          {shift.late_tolerance_minutes} min
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="text-xs text-slate-400">Early check-in</p>
                        <p className="mt-1 font-bold text-slate-800">
                          {shift.early_checkin_minutes} min
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-5 xl:grid-cols-2">
            {schedules.map((schedule) => {
              const rules = new Map(
                schedule.rules.map((rule) => [rule.day_of_week, rule])
              );
              return (
                <article
                  key={schedule.id}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="flex items-start justify-between border-b border-slate-100 px-5 py-5">
                    <div className="flex gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                        <CalendarDays size={20} />
                      </div>
                      <div>
                        <h2 className="font-bold text-slate-900">{schedule.name}</h2>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          {schedule.code}
                        </p>
                        {schedule.description && (
                          <p className="mt-1 text-sm text-slate-500">{schedule.description}</p>
                        )}
                      </div>
                    </div>
                    <span
                      className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase ${
                        schedule.is_active
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {schedule.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 divide-y divide-slate-100 px-5 py-2 sm:grid-cols-2 sm:divide-y-0 sm:gap-x-6">
                    {days.map((day, index) => {
                      const shift = rules.get(index + 1)?.shift;
                      return (
                        <div key={day} className="flex items-center justify-between py-3">
                          <span className="text-sm font-semibold text-slate-600">{day}</span>
                          {shift ? (
                            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                              <Clock3 size={14} className="text-blue-500" />
                              {shift.name} · {formatTime(shift.start_time)}
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-slate-400">Day off</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
          {schedules.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-sm text-slate-500">
              No schedules have been configured yet.
            </div>
          )}
        </>
      )}
    </section>
  );
}
