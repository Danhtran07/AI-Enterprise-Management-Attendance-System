from datetime import date, time

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator

from app.services.shift_hours import classify_shift_kind, is_overnight_hours, shift_duration_minutes


class ShiftBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=1, max_length=50)
    description: str | None = None
    start_time: time
    end_time: time
    break_start_time: time | None = None
    break_end_time: time | None = None
    late_tolerance_minutes: int = Field(default=15, ge=0, le=240)
    early_checkin_minutes: int = Field(default=30, ge=0, le=240)
    checkin_close_minutes: int = Field(default=90, ge=15, le=720)
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper().replace(" ", "-")

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Shift name is required")
        return stripped


class ShiftCreate(ShiftBase):
    pass


class ShiftUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    code: str | None = Field(default=None, min_length=1, max_length=50)
    description: str | None = None
    start_time: time | None = None
    end_time: time | None = None
    break_start_time: time | None = None
    break_end_time: time | None = None
    late_tolerance_minutes: int | None = Field(default=None, ge=0, le=240)
    early_checkin_minutes: int | None = Field(default=None, ge=0, le=240)
    checkin_close_minutes: int | None = Field(default=None, ge=15, le=720)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return value.strip().upper().replace(" ", "-")


class ShiftResponse(BaseModel):
    id: int
    name: str
    code: str
    description: str | None = None
    start_time: time
    end_time: time
    break_start_time: time | None = None
    break_end_time: time | None = None
    late_tolerance_minutes: int
    early_checkin_minutes: int
    checkin_close_minutes: int = 90
    is_overnight: bool
    is_active: bool

    model_config = ConfigDict(from_attributes=True)

    @computed_field
    @property
    def kind(self) -> str:
        return classify_shift_kind(self.start_time, self.end_time, self.is_overnight).value

    @computed_field
    @property
    def duration_minutes(self) -> int:
        return shift_duration_minutes(self.start_time, self.end_time)


class ScheduleRuleInput(BaseModel):
    day_of_week: int = Field(ge=1, le=7)
    shift_id: int | None = None


class ScheduleRuleResponse(BaseModel):
    id: int
    day_of_week: int
    shift: ShiftResponse | None = None

    model_config = ConfigDict(from_attributes=True)


class ScheduleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=1, max_length=50)
    description: str | None = None
    is_active: bool = True
    rules: list[ScheduleRuleInput] = Field(default_factory=list)

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper().replace(" ", "-")

    @model_validator(mode="after")
    def unique_days(self):
        days = [rule.day_of_week for rule in self.rules]
        if len(days) != len(set(days)):
            raise ValueError("Each weekday can only appear once in a schedule")
        return self


class ScheduleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    code: str | None = Field(default=None, min_length=1, max_length=50)
    description: str | None = None
    is_active: bool | None = None
    rules: list[ScheduleRuleInput] | None = None

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return value.strip().upper().replace(" ", "-")


class ScheduleResponse(BaseModel):
    id: int
    name: str
    code: str
    description: str | None = None
    is_active: bool
    rules: list[ScheduleRuleResponse]

    model_config = ConfigDict(from_attributes=True)


class EmployeeScheduleResponse(BaseModel):
    employee_id: int
    target_date: date
    assignment_id: int | None = None
    schedule: ScheduleResponse | None = None
    shift: ShiftResponse | None = None
    is_overnight_continuation: bool = False


class WeekDayScheduleResponse(BaseModel):
    date: date
    day_of_week: int
    shift: ShiftResponse | None = None
    is_off: bool


class EmployeeWeekScheduleResponse(BaseModel):
    employee_id: int
    start_date: date
    days: list[WeekDayScheduleResponse]


class ScheduleAssignmentCreate(BaseModel):
    employee_id: int
    schedule_id: int
    effective_from: date
    effective_to: date | None = None

    @model_validator(mode="after")
    def valid_range(self):
        if self.effective_to is not None and self.effective_to < self.effective_from:
            raise ValueError("effective_to cannot be before effective_from")
        return self


class ScheduleAssignmentResponse(BaseModel):
    id: int
    employee_id: int
    schedule_id: int
    effective_from: date
    effective_to: date | None = None
    is_active: bool
    schedule: ScheduleResponse | None = None

    model_config = ConfigDict(from_attributes=True)


def overnight_from_hours(start_time: time, end_time: time) -> bool:
    return is_overnight_hours(start_time, end_time)
