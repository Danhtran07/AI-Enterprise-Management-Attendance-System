from datetime import date, datetime, time, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.attendance import Attendance, AttendanceStatus
from app.models.employee import Employee
from app.models.schedule_assignment import ScheduleAssignment
from app.models.schedule_rule import ScheduleRule
from app.models.shift import Shift
from app.models.user import User, UserRole
from app.models.work_schedule import WorkSchedule
from app.schemas.ai import AIRecognitionResult
from app.services.attendance_policy import calculate_attendance_status
from app.services.attendance_recognition import (
    AttendancePersistenceError,
    RecognitionRejectedError,
    compute_attendance_status,
    record_recognition_attendance,
)
from app.services.shift_resolver import resolve_shift


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture
def employee(db_session):
    user = User(
        username="recognition_employee",
        password_hash="hashed-password",
        role=UserRole.EMPLOYEE,
    )
    db_session.add(user)
    db_session.flush()
    employee = Employee(
        user_id=user.id,
        employee_code="EMP-REC-001",
        full_name="Recognition Employee",
        email="recognition@example.com",
    )
    db_session.add(employee)
    db_session.commit()
    db_session.refresh(employee)
    return employee


@pytest.fixture
def recognition(employee):
    return AIRecognitionResult(
        matched=True,
        employee_id=employee.id,
        confidence=0.97,
        liveness=True,
        liveness_score=0.92,
        verification_status="VERIFIED",
        session_id="verification-session-1",
    )


@pytest.fixture
def monday_schedule(db_session, employee):
    shift = Shift(
        name="Morning Shift",
        code="MORNING-REC",
        start_time=time(8, 0),
        end_time=time(17, 0),
        late_tolerance_minutes=15,
        early_checkin_minutes=30,
        is_overnight=False,
        is_active=True,
    )
    schedule = WorkSchedule(
        name="Monday Schedule",
        code="MONDAY-REC",
        is_active=True,
    )
    db_session.add_all([shift, schedule])
    db_session.flush()
    db_session.add(
        ScheduleRule(
            schedule_id=schedule.id,
            shift_id=shift.id,
            day_of_week=1,
        )
    )
    db_session.add(
        ScheduleAssignment(
            employee_id=employee.id,
            schedule_id=schedule.id,
            effective_from=NOW.date(),
            is_active=True,
        )
    )
    db_session.commit()
    return schedule


NOW = datetime(2026, 9, 5, 1, 0, tzinfo=timezone.utc)


def test_successful_check_in(db_session, recognition, employee):
    attendance = record_recognition_attendance(db_session, recognition, NOW)

    assert attendance.employee_id == employee.id
    assert attendance.check_in == NOW
    assert attendance.check_out is None
    assert attendance.timestamp == NOW
    assert attendance.face_similarity == pytest.approx(0.97)
    assert attendance.liveness_score == pytest.approx(0.92)
    assert attendance.verification_status == "VERIFIED"
    assert attendance.session_id == "verification-session-1"


def test_schedule_controls_late_status(db_session, employee, monday_schedule):
    on_time = datetime(2026, 9, 7, 1, 15, tzinfo=timezone.utc)
    late = datetime(2026, 9, 7, 1, 16, tzinfo=timezone.utc)

    assert compute_attendance_status(db_session, employee.id, on_time) == AttendanceStatus.PRESENT
    assert compute_attendance_status(db_session, employee.id, late) == AttendanceStatus.LATE


def test_attendance_policy_uses_shift_tolerance(db_session, employee, monday_schedule):
    shift = resolve_shift(db_session, employee.id, date(2026, 9, 7))
    check_ins = [
        datetime(2026, 9, 7, 1, 5, tzinfo=timezone.utc),
        datetime(2026, 9, 7, 1, 14, tzinfo=timezone.utc),
        datetime(2026, 9, 7, 1, 16, tzinfo=timezone.utc),
    ]

    assert calculate_attendance_status(check_ins[0], shift) == AttendanceStatus.PRESENT
    assert calculate_attendance_status(check_ins[1], shift) == AttendanceStatus.PRESENT
    assert calculate_attendance_status(check_ins[2], shift) == AttendanceStatus.LATE


def test_recognition_persists_shift_snapshot_metrics(
    db_session,
    employee,
    recognition,
    monday_schedule,
):
    check_in = datetime(2026, 9, 7, 1, 16, tzinfo=timezone.utc)
    check_out = datetime(2026, 9, 7, 10, 30, tzinfo=timezone.utc)

    attendance = record_recognition_attendance(db_session, recognition, check_in)
    record_recognition_attendance(db_session, recognition, check_out)
    db_session.refresh(attendance)

    shift = resolve_shift(db_session, employee.id, date(2026, 9, 7))
    assert attendance.shift_id == shift.id
    assert attendance.status == AttendanceStatus.LATE
    assert attendance.late_minutes == 1
    assert attendance.early_leave_minutes == 0
    assert attendance.working_minutes == 554
    assert attendance.overtime_minutes == 30


def test_resolve_shift_returns_employee_shift(db_session, employee, monday_schedule):
    shift = resolve_shift(db_session, employee.id, date(2026, 9, 7))

    assert shift is not None
    assert shift.name == "Morning Shift"
    assert shift.start_time == time(8, 0)
    assert shift.end_time == time(17, 0)


def test_resolve_shift_returns_none_without_assignment(db_session, employee):
    assert resolve_shift(db_session, employee.id, date(2026, 9, 7)) is None


def test_successful_check_out(db_session, recognition, employee):
    first = record_recognition_attendance(db_session, recognition, NOW)
    later = datetime(2026, 9, 5, 9, 0, tzinfo=timezone.utc)

    second = record_recognition_attendance(db_session, recognition, later)

    assert second.id == first.id
    assert second.check_out == later
    assert second.timestamp == later
    assert second.face_similarity == pytest.approx(0.97)
    assert second.liveness_score == pytest.approx(0.92)
    assert second.verification_status == "VERIFIED"
    assert second.session_id == "verification-session-1"


def test_unknown_face_is_rejected(db_session):
    result = AIRecognitionResult(
        matched=False,
        confidence=0.2,
        liveness=True,
    )

    with pytest.raises(RecognitionRejectedError) as error:
        record_recognition_attendance(db_session, result, NOW)

    assert error.value.status_code == 422
    assert db_session.query(Attendance).count() == 0


def test_liveness_failure_is_rejected(db_session, recognition):
    recognition.liveness = False

    with pytest.raises(RecognitionRejectedError) as error:
        record_recognition_attendance(db_session, recognition, NOW)

    assert error.value.status_code == 422


def test_duplicate_completed_attendance_is_rejected(db_session, recognition):
    record_recognition_attendance(db_session, recognition, NOW)
    record_recognition_attendance(
        db_session,
        recognition,
        datetime(2026, 9, 5, 9, 0, tzinfo=timezone.utc),
    )

    with pytest.raises(RecognitionRejectedError) as error:
        record_recognition_attendance(
            db_session,
            recognition,
            datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc),
        )

    assert error.value.status_code == 409


def test_employee_not_found_is_rejected(db_session):
    result = AIRecognitionResult(
        matched=True,
        employee_id=999,
        confidence=0.9,
        liveness=True,
    )

    with pytest.raises(RecognitionRejectedError) as error:
        record_recognition_attendance(db_session, result, NOW)

    assert error.value.status_code == 404


def test_database_error_rolls_back(db_session, recognition, monkeypatch):
    def fail_commit():
        raise SQLAlchemyError("database unavailable")

    monkeypatch.setattr(db_session, "commit", fail_commit)

    with pytest.raises(AttendancePersistenceError):
        record_recognition_attendance(db_session, recognition, NOW)
