export interface Shift {
  id: number;
  name: string;
  code: string;
  description: string | null;
  start_time: string;
  end_time: string;
  late_tolerance_minutes: number;
  early_checkin_minutes: number;
  is_overnight: boolean;
  is_active: boolean;
}

export interface ScheduleRule {
  id: number;
  day_of_week: number;
  shift: Shift | null;
}

export interface WorkSchedule {
  id: number;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  rules: ScheduleRule[];
}

export interface EmployeeSchedule {
  employee_id: number;
  target_date: string;
  assignment_id: number | null;
  schedule: WorkSchedule | null;
  shift: Shift | null;
}