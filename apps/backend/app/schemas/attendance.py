from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, field_serializer

from app.core.timezone import to_vietnam_time
from app.models.attendance import AttendanceStatus


class AttendanceBase(BaseModel):
    employee_id: int
    date: date


class AttendanceCreate(AttendanceBase):
    status: AttendanceStatus | None = None
    check_in: datetime | None = None
    check_out: datetime | None = None


class AttendanceUpdate(BaseModel):
    check_in: datetime | None = None
    check_out: datetime | None = None
    status: AttendanceStatus | None = None


class AttendanceResponse(AttendanceBase):
    id: int
    shift_id: int | None = None
    check_in: datetime | None = None
    check_out: datetime | None = None
    status: AttendanceStatus
    late_minutes: int
    early_leave_minutes: int
    working_minutes: int
    overtime_minutes: int
    timestamp: datetime
    face_similarity: float | None = None
    liveness_score: float | None = None
    verification_status: str
    session_id: str | None = None
    created_at: datetime
    updated_at: datetime

    @field_serializer("check_in", "check_out", "timestamp", "created_at", "updated_at")
    def serialize_datetime(self, value: datetime | None, _info):
        return to_vietnam_time(value)

    model_config = ConfigDict(from_attributes=True)


class AttendanceRecognitionEmployee(BaseModel):
    id: int
    name: str


class AttendanceRecognitionData(BaseModel):
    matched: bool
    confidence: float
    liveness: bool
    liveness_score: float
    verification_status: str
    session_id: str | None = None


class AttendanceRecognitionResponse(BaseModel):
    success: bool
    employee: AttendanceRecognitionEmployee
    attendance: AttendanceResponse
    recognition: AttendanceRecognitionData


class AttendanceCalendarDay(BaseModel):
    date: date
    day_of_week: int
    is_weekend: bool
    attendance_id: int | None = None
    status: AttendanceStatus
    has_record: bool
    check_in: datetime | None = None
    check_out: datetime | None = None

    @field_serializer("check_in", "check_out")
    def serialize_datetime(self, value: datetime | None, _info):
        return to_vietnam_time(value)


class AttendanceCalendarResponse(BaseModel):
    employee_id: int
    year: int
    month: int
    total_days: int
    days: list[AttendanceCalendarDay]
