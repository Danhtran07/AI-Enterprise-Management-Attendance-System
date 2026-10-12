export type ShiftTemplateId = "day" | "night";

export const SHIFT_TEMPLATES: Record<
  ShiftTemplateId,
  { label: string; start: string; end: string }
> = {
  day: {
    label: "Day office (08:00–17:00)",
    start: "08:00",
    end: "17:00",
  },
  night: {
    label: "Night shift (16:00–23:00)",
    start: "16:00",
    end: "23:00",
  },
};

export function normalizeClock(value: string): string {
  return value.slice(0, 5);
}

export function matchShiftTemplate(start: string, end: string): ShiftTemplateId {
  const startClock = normalizeClock(start);
  const endClock = normalizeClock(end);
  if (
    startClock === SHIFT_TEMPLATES.night.start &&
    endClock === SHIFT_TEMPLATES.night.end
  ) {
    return "night";
  }
  if (
    startClock === SHIFT_TEMPLATES.day.start &&
    endClock === SHIFT_TEMPLATES.day.end
  ) {
    return "day";
  }
  const hour = Number(startClock.slice(0, 2));
  return Number.isFinite(hour) && hour >= 16 ? "night" : "day";
}
