from datetime import datetime, timezone

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.timezone import to_vietnam_time
from app.models.attendance import Attendance, AttendanceStatus
from app.models.employee import Employee
from app.schemas.ai import AIRecognitionResult
from app.services.attendance_policy import (
    calculate_attendance_metrics,
    calculate_attendance_status,
)
from app.services.shift_hours import (
    CheckInWindowState,
    format_clock,
    get_shift_check_in_window,
)
from app.services.shift_resolver import resolve_shift, resolve_shift_for_punch


class RecognitionRejectedError(Exception):
    def __init__(self, detail: str, status_code: int) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class AttendancePersistenceError(Exception):
    pass


def compute_attendance_status(
    db: Session,
    employee_id: int,
    check_in: datetime | None,
) -> AttendanceStatus:
    if check_in is None:
        return AttendanceStatus.ABSENT

    local_check_in = to_vietnam_time(check_in)
    shift, _date, _continuation = resolve_shift_for_punch(db, employee_id, local_check_in)
    return calculate_attendance_status(check_in, shift)


def record_recognition_attendance(
    db: Session,
    recognition: AIRecognitionResult,
    now: datetime | None = None,
) -> Attendance:
    if not recognition.matched:
        raise RecognitionRejectedError("Face was not recognized", 422)
    if not recognition.liveness:
        raise RecognitionRejectedError("Liveness validation failed", 422)
    if recognition.employee_id is None:
        raise RecognitionRejectedError("Recognition did not identify an employee", 422)

    employee = (
        db.query(Employee)
        .filter(Employee.id == recognition.employee_id)
        .first()
    )
    if employee is None:
        raise RecognitionRejectedError("Employee not found", 404)

    server_now = now or datetime.now(timezone.utc)
    local_now = to_vietnam_time(server_now)
    shift, local_date, _continuation = resolve_shift_for_punch(
        db,
        employee.id,
        local_now,
    )
    attendance_status = calculate_attendance_status(server_now, shift)
    metrics = calculate_attendance_metrics(server_now, None, shift)
    attendance = (
        db.query(Attendance)
        .filter(
            Attendance.employee_id == employee.id,
            Attendance.date == local_date,
        )
        .first()
    )

    if attendance is None:
        _reject_if_check_in_closed(db, employee.id, shift, local_date, server_now)
        attendance = Attendance(
            employee_id=employee.id,
            shift_id=shift.id if shift is not None else None,
            date=local_date,
            check_in=server_now,
            status=attendance_status,
            late_minutes=metrics.late_minutes,
            early_leave_minutes=metrics.early_leave_minutes,
            working_minutes=metrics.working_minutes,
            overtime_minutes=metrics.overtime_minutes,
            timestamp=server_now,
            face_similarity=recognition.confidence,
            liveness_score=recognition.liveness_score,
            verification_status=recognition.verification_status,
            session_id=recognition.session_id,
        )
        db.add(attendance)
    elif attendance.check_out is None:
        attendance.check_out = server_now
        attendance.timestamp = server_now
        attendance.face_similarity = recognition.confidence
        attendance.liveness_score = recognition.liveness_score
        attendance.verification_status = recognition.verification_status
        attendance.session_id = recognition.session_id
        metrics = calculate_attendance_metrics(
            attendance.check_in,
            server_now,
            attendance.shift,
        )
        attendance.early_leave_minutes = metrics.early_leave_minutes
        attendance.working_minutes = metrics.working_minutes
        attendance.overtime_minutes = metrics.overtime_minutes
    else:
        raise RecognitionRejectedError("Attendance already completed for today", 409)

    try:
        db.commit()
        db.refresh(attendance)
    except SQLAlchemyError as exc:
        db.rollback()
        raise AttendancePersistenceError("Failed to save attendance") from exc

    return attendance


def _reject_if_check_in_closed(
    db: Session,
    employee_id: int,
    shift,
    local_date,
    server_now: datetime,
) -> None:
    if shift is None:
        return

    window = get_shift_check_in_window(shift, server_now)
    if window.state == CheckInWindowState.TOO_EARLY:
        raise RecognitionRejectedError(
            f"Check-in is not open yet. It opens at {format_clock(window.opens_at)}.",
            422,
        )

    if window.state != CheckInWindowState.CLOSED:
        return

    absent = Attendance(
        employee_id=employee_id,
        shift_id=shift.id,
        date=local_date,
        check_in=None,
        check_out=None,
        status=AttendanceStatus.ABSENT,
    )
    db.add(absent)
    try:
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise AttendancePersistenceError("Failed to save attendance") from exc

    raise RecognitionRejectedError(
        (
            "Check-in is closed for today's shift. This day is marked absent "
            f"and check-out is locked. The window was {format_clock(window.opens_at)} "
            f"to {format_clock(window.closes_at)}."
        ),
        422,
    )
