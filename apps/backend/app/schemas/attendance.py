from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.core.timezone import to_vietnam_time
from app.models.attendance import AttendanceStatus
from app.models.attendance_request import (
    AttendanceRequestStatus,
    AttendanceRequestType,
)


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
    late_minutes: int = 0
    early_leave_minutes: int = 0
    working_minutes: int = 0
    overtime_minutes: int = 0
    face_similarity: float | None = None
    liveness_score: float | None = None
    verification_status: str | None = None

    @field_serializer("check_in", "check_out")
    def serialize_datetime(self, value: datetime | None, _info):
        return to_vietnam_time(value)


class AttendanceCalendarResponse(BaseModel):
    employee_id: int
    year: int
    month: int
    total_days: int
    days: list[AttendanceCalendarDay]


class MonthlyTimesheetRow(BaseModel):
    employee_id: int
    employee_code: str
    full_name: str
    department: str | None = None
    present_days: int = 0
    late_days: int = 0
    absent_days: int = 0
    total_working_minutes: int = 0
    total_late_minutes: int = 0
    total_early_leave_minutes: int = 0
    total_overtime_minutes: int = 0
    avg_face_similarity: float | None = None
    avg_liveness_score: float | None = None


class MonthlyTimesheetReportResponse(BaseModel):
    year: int
    month: int
    total_employees: int
    rows: list[MonthlyTimesheetRow]


class AIBiometricsMetricsResponse(BaseModel):
    total_verifications: int = 0
    verified_count: int = 0
    avg_face_similarity: float = 0.0
    avg_liveness_score: float = 0.0
    enrolled_employees: int = 0
    total_face_embeddings: int = 0
    engine_attempts: int = 0
    engine_matched: int = 0
    engine_rejected: int = 0
    engine_false_Reject_rate: float = 0.0
    rejection_breakdown: dict[str, int] = Field(default_factory=dict)


class AttendanceRequestCreate(BaseModel):
    date: date
    request_type: AttendanceRequestType
    reason: str = Field(..., min_length=3, max_length=1000)
    requested_check_in: datetime | None = None
    requested_check_out: datetime | None = None


class AttendanceRequestReview(BaseModel):
    status: AttendanceRequestStatus
    admin_note: str | None = Field(default=None, max_length=500)


class AttendanceRequestResponse(BaseModel):
    id: int
    employee_id: int
    employee_name: str | None = None
    employee_code: str | None = None
    department: str | None = None
    date: date
    request_type: AttendanceRequestType
    reason: str
    requested_check_in: datetime | None = None
    requested_check_out: datetime | None = None
    status: AttendanceRequestStatus
    admin_note: str | None = None
    reviewed_by: int | None = None
    reviewed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    @field_serializer(
        "requested_check_in",
        "requested_check_out",
        "reviewed_at",
        "created_at",
        "updated_at",
    )
    def serialize_datetime(self, value: datetime | None, _info):
        return to_vietnam_time(value)

    model_config = ConfigDict(from_attributes=True)
