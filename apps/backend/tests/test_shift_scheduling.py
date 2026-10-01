from datetime import date, datetime, time, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.attendance import AttendanceStatus
from app.models.employee import Employee
from app.models.schedule_assignment import ScheduleAssignment
from app.models.schedule_rule import ScheduleRule
from app.models.shift import Shift
from app.models.user import User, UserRole
from app.models.work_schedule import WorkSchedule
from app.schemas.ai import AIRecognitionResult
from app.services.attendance_policy import (
    calculate_attendance_metrics,
    calculate_attendance_status,
)
from app.services.attendance_recognition import record_recognition_attendance
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
def employee(db_session: Session):
    user = User(
        username="shift_test_employee",
        password_hash="hashed-password",
        role=UserRole.EMPLOYEE,
    )
    db_session.add(user)
    db_session.flush()
    employee = Employee(
        user_id=user.id,
        employee_code="EMP-SHIFT-001",
        full_name="Shift Test Employee",
        email="shift-test@example.com",
    )
    db_session.add(employee)
    db_session.commit()
    db_session.refresh(employee)
    return employee


@pytest.fixture
def shifts(db_session: Session):
    morning = Shift(
        name="Morning Shift",
        code="MORNING-TEST",
        start_time=time(8, 0),
        end_time=time(17, 0),
        late_tolerance_minutes=15,
        early_checkin_minutes=30,
        is_overnight=False,
        is_active=True,
    )
    afternoon = Shift(
        name="Afternoon Shift",
        code="AFTERNOON-TEST",
        start_time=time(13, 0),
        end_time=time(22, 0),
        late_tolerance_minutes=15,
        early_checkin_minutes=30,
        is_overnight=False,
        is_active=True,
    )
    night = Shift(
        name="Night Shift",
        code="NIGHT-TEST",
        start_time=time(22, 0),
        end_time=time(6, 0),
        late_tolerance_minutes=15,
        early_checkin_minutes=30,
        is_overnight=True,
        is_active=True,
    )
    db_session.add_all([morning, afternoon, night])
    db_session.commit()
    return morning, afternoon, night


@pytest.fixture
def weekly_schedule(db_session: Session, employee, shifts):
    morning, afternoon, night = shifts
    schedule = WorkSchedule(
        name="Weekly Test Schedule",
        code="WEEKLY-TEST",
        is_active=True,
    )
    db_session.add(schedule)
    db_session.flush()
    db_session.add_all(
        [
            ScheduleRule(schedule_id=schedule.id, day_of_week=1, shift_id=morning.id),
            ScheduleRule(schedule_id=schedule.id, day_of_week=4, shift_id=afternoon.id),
            ScheduleRule(schedule_id=schedule.id, day_of_week=5, shift_id=night.id),
        ]
    )
    db_session.add(
        ScheduleAssignment(
            employee_id=employee.id,
            schedule_id=schedule.id,
            effective_from=date(2026, 9, 1),
            is_active=True,
        )
    )
    db_session.commit()
    return schedule


def utc(year: int, month: int, day: int, hour: int, minute: int = 0):
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def test_creates_morning_afternoon_and_night_shifts(db_session, shifts):
    morning, afternoon, night = shifts

    assert (morning.start_time, morning.end_time) == (time(8, 0), time(17, 0))
    assert (afternoon.start_time, afternoon.end_time) == (time(13, 0), time(22, 0))
    assert (night.start_time, night.end_time) == (time(22, 0), time(6, 0))
    assert night.is_overnight is True
    assert db_session.query(Shift).count() == 3


def test_resolves_weekly_schedule_and_off_day(db_session, employee, weekly_schedule, shifts):
    morning, afternoon, night = shifts

    assert resolve_shift(db_session, employee.id, date(2026, 9, 7)).id == morning.id
    assert resolve_shift(db_session, employee.id, date(2026, 9, 10)).id == afternoon.id
    assert resolve_shift(db_session, employee.id, date(2026, 9, 13)) is None


def test_effective_date_switches_employee_schedule(db_session, employee, shifts, weekly_schedule):
    _, _, night = shifts
    replacement = WorkSchedule(
        name="Replacement Schedule",
        code="REPLACEMENT-TEST",
        is_active=True,
    )
    db_session.add(replacement)
    db_session.flush()
    db_session.add(
        ScheduleRule(schedule_id=replacement.id, day_of_week=1, shift_id=night.id)
    )
    db_session.add(
        ScheduleAssignment(
            employee_id=employee.id,
            schedule_id=replacement.id,
            effective_from=date(2026, 9, 15),
            is_active=True,
        )
    )
    db_session.commit()

    assert resolve_shift(db_session, employee.id, date(2026, 9, 14)).name == "Morning Shift"
    assert resolve_shift(db_session, employee.id, date(2026, 9, 21)).name == "Night Shift"


@pytest.mark.parametrize(
    ("check_in", "shift_index", "expected"),
    [
        (utc(2026, 9, 7, 1, 0), 0, AttendanceStatus.PRESENT),
        (utc(2026, 9, 7, 1, 16), 0, AttendanceStatus.LATE),
        (utc(2026, 9, 10, 6, 0), 1, AttendanceStatus.PRESENT),
        (utc(2026, 9, 10, 6, 16), 1, AttendanceStatus.LATE),
        (utc(2026, 9, 11, 15, 0), 2, AttendanceStatus.PRESENT),
        (utc(2026, 9, 11, 15, 16), 2, AttendanceStatus.LATE),
    ],
)
def test_policy_handles_all_shift_windows(
    db_session,
    employee,
    weekly_schedule,
    shifts,
    check_in,
    shift_index,
    expected,
):
    shift = shifts[shift_index]
    assert calculate_attendance_status(check_in, shift) == expected


def test_night_shift_check_out_calculates_working_minutes(db_session, shifts):
    night = shifts[2]
    check_in = utc(2026, 9, 11, 15, 0)
    check_out = utc(2026, 9, 11, 23, 0)

    metrics = calculate_attendance_metrics(check_in, check_out, night)

    assert metrics.late_minutes == 0
    assert metrics.early_leave_minutes == 0
    assert metrics.working_minutes == 480
    assert metrics.overtime_minutes == 0


def test_attendance_snapshots_shift_and_check_out_metrics(
    db_session,
    employee,
    weekly_schedule,
    shifts,
):
    recognition = AIRecognitionResult(
        matched=True,
        employee_id=employee.id,
        confidence=0.98,
        liveness=True,
    )
    check_in = utc(2026, 9, 7, 1, 16)
    check_out = utc(2026, 9, 7, 10, 0)

    attendance = record_recognition_attendance(db_session, recognition, check_in)
    record_recognition_attendance(db_session, recognition, check_out)
    db_session.refresh(attendance)

    assert attendance.shift_id == shifts[0].id
    assert attendance.status == AttendanceStatus.LATE
    assert attendance.late_minutes == 1
    assert attendance.working_minutes == 524


def test_employee_without_schedule_does_not_crash(db_session, employee):
    recognition = AIRecognitionResult(
        matched=True,
        employee_id=employee.id,
        confidence=0.98,
        liveness=True,
    )

    attendance = record_recognition_attendance(
        db_session,
        recognition,
        utc(2026, 9, 7, 1, 0),
    )

    assert attendance.shift_id is None
    assert attendance.status == AttendanceStatus.PRESENT