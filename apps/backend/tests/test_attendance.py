from datetime import date, datetime, time, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.main import app
from app.models.attendance import Attendance, AttendanceStatus
from app.models.employee import Employee
from app.models.face_data import FaceData
from app.models.schedule_assignment import ScheduleAssignment
from app.models.schedule_rule import ScheduleRule
from app.models.shift import Shift
from app.models.user import User, UserRole
from app.models.work_schedule import WorkSchedule
from app.schemas.ai import AIRecognitionResult
from app.api.routes.attendance import _get_ai_client

SQLALCHEMY_DATABASE_URL = "sqlite://"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)



@pytest.fixture
def db_session():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    try:
        yield db
    finally:
        app.dependency_overrides.clear()
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def auth_headers(db_session):
    user = User(
        username="admin_attendance_test",
        password_hash="hashed-password",
        role=UserRole.ADMIN,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    token = create_access_token(
        {"sub": str(user.id), "role": user.role.value}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def employee(db_session):
    user = User(
        username="employee_attendance_test",
        password_hash="hashed-password",
        role=UserRole.EMPLOYEE,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    employee = Employee(
        user_id=user.id,
        employee_code="EMP-ATT-001",
        full_name="Nguyen Van A",
        email="employee.attendance@example.com",
        department="IT",
    )
    db_session.add(employee)
    db_session.commit()
    db_session.refresh(employee)
    return employee


@pytest.fixture
def employee_user_headers(db_session):
    user = User(
        username="employee_self_attendance",
        password_hash="hashed-password",
        role=UserRole.EMPLOYEE,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    employee = Employee(
        user_id=user.id,
        employee_code="EMP-ATT-SELF",
        full_name="Employee Self",
        email="self.attendance@example.com",
        department="Finance",
    )
    db_session.add(employee)
    db_session.commit()
    db_session.refresh(employee)

    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    return {"Authorization": f"Bearer {token}"}, user, employee


client = TestClient(app)


def test_get_attendance_returns_list(db_session, auth_headers, employee):
    record = Attendance(
        employee_id=employee.id,
        date=date(2026, 9, 2),
        check_in=datetime(2026, 9, 2, 8, 30, 0),
        check_out=datetime(2026, 9, 2, 17, 30, 0),
        status=AttendanceStatus.PRESENT,
    )
    db_session.add(record)
    db_session.commit()

    response = client.get("/api/attendance", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["employee_id"] == employee.id
    assert data[0]["status"] == "PRESENT"


def test_get_attendance_calendar_returns_every_day_of_month(
    db_session,
    auth_headers,
    employee,
):
    record = Attendance(
        employee_id=employee.id,
        date=date(2026, 9, 2),
        check_in=datetime(2026, 9, 2, 8, 15, 0),
        status=AttendanceStatus.PRESENT,
    )
    db_session.add(record)
    db_session.commit()

    response = client.get(
        "/api/attendance/calendar",
        params={"year": 2026, "month": 9, "employee_id": employee.id},
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["total_days"] == 30
    assert len(data["days"]) == 30
    assert data["days"][1]["date"] == "2026-09-02"
    assert data["days"][1]["status"] == "PRESENT"
    assert data["days"][1]["has_record"] is True
    assert data["days"][0]["status"] == "ABSENT"
    assert data["days"][0]["has_record"] is False


def test_employee_can_only_view_own_attendance_calendar(
    db_session,
    employee_user_headers,
    employee,
):
    headers, _, own_employee = employee_user_headers

    response = client.get(
        "/api/attendance/calendar",
        params={"year": 2026, "month": 9, "employee_id": employee.id},
        headers=headers,
    )

    assert own_employee.id != employee.id
    assert response.status_code == 403


def test_create_attendance_success(db_session, auth_headers, employee):
    payload = {
        "employee_id": employee.id,
        "date": "2026-09-03",
        "check_in": "2026-09-03T08:15:00",
        "check_out": "2026-09-03T17:10:00",
        "status": "LATE",
    }

    response = client.post(
        "/api/attendance",
        json=payload,
        headers=auth_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["employee_id"] == employee.id
    assert data["date"] == "2026-09-03"
    assert data["status"] == "LATE"


def test_recognize_attendance_sends_employee_gallery_to_ai(
    db_session,
    auth_headers,
    employee,
):
    db_session.add_all(
        [
            FaceData(employee_id=employee.id, embedding=[1.0, 0.0], model_name="test-model"),
            FaceData(employee_id=employee.id, embedding=[0.9, 0.1], model_name="test-model"),
        ]
    )
    db_session.commit()

    class FakeAIClient:
        def __init__(self):
            self.candidates = None
            self.liveness_session_id = None

        def recognize(self, image, candidates, fast_mode=False, liveness_session_id=None):
            self.candidates = candidates
            self.liveness_session_id = liveness_session_id
            assert fast_mode is True
            return AIRecognitionResult(
                matched=True,
                employee_id=employee.id,
                confidence=0.96,
                liveness=True,
            )

    fake_client = FakeAIClient()
    app.dependency_overrides[_get_ai_client] = lambda: fake_client

    try:
        response = client.post(
            "/api/attendance/recognize",
            files={"image": ("frame.jpg", b"image-bytes", "image/jpeg")},
            data={"liveness_session_id": "session-123"},
            headers=auth_headers,
        )
    finally:
        app.dependency_overrides.pop(_get_ai_client, None)

    assert response.status_code == 201
    assert response.json()["employee"]["id"] == employee.id
    assert fake_client.liveness_session_id == "session-123"
    assert [(candidate.employee_id, candidate.embedding) for candidate in fake_client.candidates] == [
        (employee.id, [1.0, 0.0]),
        (employee.id, [0.9, 0.1]),
    ]


def test_create_attendance_auto_sets_late_status_when_check_in_is_late(
    db_session,
    auth_headers,
    employee,
):
    shift = Shift(
        name="Morning Shift",
        code="MORNING-CRUD",
        start_time=time(8, 0),
        end_time=time(17, 0),
        late_tolerance_minutes=15,
        early_checkin_minutes=30,
        is_overnight=False,
        is_active=True,
    )
    schedule = WorkSchedule(
        name="Tuesday Schedule",
        code="TUESDAY-CRUD",
        is_active=True,
    )
    db_session.add_all([shift, schedule])
    db_session.flush()
    db_session.add_all(
        [
            ScheduleRule(
                schedule_id=schedule.id,
                shift_id=shift.id,
                day_of_week=2,
            ),
            ScheduleAssignment(
                employee_id=employee.id,
                schedule_id=schedule.id,
                effective_from=date(2026, 9, 1),
                is_active=True,
            ),
        ]
    )
    db_session.commit()

    payload = {
        "employee_id": employee.id,
        "date": "2026-09-08",
        "check_in": "2026-09-08T09:30:00",
    }

    response = client.post(
        "/api/attendance",
        json=payload,
        headers=auth_headers,
    )

    assert response.status_code == 201
    assert response.json()["status"] == "LATE"


def test_attendance_response_uses_vietnam_timezone(db_session, auth_headers, employee):
    record = Attendance(
        employee_id=employee.id,
        date=date(2026, 9, 2),
        check_in=datetime(2026, 9, 2, 8, 30, 0, tzinfo=timezone.utc),
        status=AttendanceStatus.PRESENT,
        created_at=datetime(2026, 9, 2, 8, 0, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 9, 2, 8, 0, 0, tzinfo=timezone.utc),
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    response = client.get("/api/attendance", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()[0]
    assert data["check_in"] == "2026-09-02T15:30:00+07:00"
    assert data["created_at"] == "2026-09-02T15:00:00+07:00"


def test_create_attendance_conflict_for_same_employee_and_date(
    db_session,
    auth_headers,
    employee,
):
    payload = {
        "employee_id": employee.id,
        "date": "2026-09-04",
        "status": "ABSENT",
    }

    first_response = client.post(
        "/api/attendance",
        json=payload,
        headers=auth_headers,
    )
    second_response = client.post(
        "/api/attendance",
        json=payload,
        headers=auth_headers,
    )

    assert first_response.status_code == 201
    assert second_response.status_code == 409
    assert "already exists" in second_response.json()["detail"]


def test_update_attendance_success(db_session, auth_headers, employee):
    record = Attendance(
        employee_id=employee.id,
        date=date(2026, 9, 5),
        check_in=datetime(2026, 9, 5, 8, 0, 0),
        status=AttendanceStatus.ABSENT,
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    response = client.put(
        f"/api/attendance/{record.id}",
        json={"status": "PRESENT", "check_in": "2026-09-05T08:15:00"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "PRESENT"
    assert data["check_in"] == "2026-09-05T15:15:00+07:00"


def test_update_attendance_rejects_check_out_before_check_in(
    db_session,
    auth_headers,
    employee,
):
    record = Attendance(
        employee_id=employee.id,
        date=date(2026, 9, 7),
        check_in=datetime(2026, 9, 7, 8, 30, 0),
        status=AttendanceStatus.PRESENT,
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    response = client.put(
        f"/api/attendance/{record.id}",
        json={"check_out": "2026-09-07T07:45:00"},
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert "check_out" in response.json()["detail"]


def test_employee_can_only_view_own_attendance_records(
    db_session,
    employee_user_headers,
    employee,
):
    headers, _, own_employee = employee_user_headers

    own_record = Attendance(
        employee_id=own_employee.id,
        date=date(2026, 9, 9),
        check_in=datetime(2026, 9, 9, 8, 0, 0),
        status=AttendanceStatus.PRESENT,
    )
    other_record = Attendance(
        employee_id=employee.id,
        date=date(2026, 9, 10),
        check_in=datetime(2026, 9, 10, 8, 0, 0),
        status=AttendanceStatus.PRESENT,
    )
    db_session.add_all([own_record, other_record])
    db_session.commit()

    response = client.get("/api/attendance", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["employee_id"] == own_employee.id


def test_delete_attendance_success(db_session, auth_headers, employee):
    record = Attendance(
        employee_id=employee.id,
        date=date(2026, 9, 6),
        status=AttendanceStatus.ABSENT,
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    response = client.delete(
        f"/api/attendance/{record.id}",
        headers=auth_headers,
    )

    assert response.status_code == 204
    assert response.content == b""


def test_delete_user_with_employee_success(db_session, auth_headers, employee):
    user = db_session.query(User).filter(
        User.username == "employee_attendance_test"
    ).one()

    response = client.delete(
        f"/api/users/{user.id}",
        headers=auth_headers,
    )

    assert response.status_code == 204
    assert response.content == b""
    assert db_session.query(User).filter(User.id == user.id).first() is None
    assert db_session.query(Employee).filter(Employee.id == employee.id).first() is None


def test_monthly_timesheet_report_and_ai_metrics(db_session, auth_headers, employee):
    record = Attendance(
        employee_id=employee.id,
        date=date(2026, 9, 2),
        check_in=datetime(2026, 9, 2, 8, 10, 0),
        check_out=datetime(2026, 9, 2, 17, 40, 0),
        status=AttendanceStatus.LATE,
        late_minutes=10,
        working_minutes=510,
        overtime_minutes=40,
        face_similarity=0.92,
        liveness_score=0.97,
        verification_status="VERIFIED",
    )
    db_session.add(record)
    db_session.commit()

    report_resp = client.get(
        "/api/attendance/report",
        params={"year": 2026, "month": 9, "department": "IT"},
        headers=auth_headers,
    )
    assert report_resp.status_code == 200
    report_data = report_resp.json()
    assert report_data["total_employees"] == 1
    row = report_data["rows"][0]
    assert row["employee_code"] == "EMP-ATT-001"
    assert row["late_days"] == 1
    assert row["total_working_minutes"] == 510
    assert row["total_overtime_minutes"] == 40

    metrics_resp = client.get("/api/attendance/ai-metrics", headers=auth_headers)
    assert metrics_resp.status_code == 200
    metrics_data = metrics_resp.json()
    assert metrics_data["verified_count"] == 1
    assert metrics_data["avg_face_similarity"] == 0.92


def test_attendance_request_create_and_admin_approve_workflow(
    db_session,
    auth_headers,
    employee_user_headers,
):
    emp_headers, _, own_employee = employee_user_headers

    create_resp = client.post(
        "/api/attendance/requests",
        json={
            "date": "2026-09-15",
            "request_type": "FORGOT_CHECKIN",
            "reason": "Camera was under maintenance at the entrance.",
            "requested_check_in": "2026-09-15T08:00:00",
            "requested_check_out": "2026-09-15T17:00:00",
        },
        headers=emp_headers,
    )
    assert create_resp.status_code == 201
    req_data = create_resp.json()
    assert req_data["status"] == "PENDING"
    assert req_data["employee_id"] == own_employee.id

    review_resp = client.put(
        f"/api/attendance/requests/{req_data['id']}/review",
        json={
            "status": "APPROVED",
            "admin_note": "Verified with security desk",
        },
        headers=auth_headers,
    )
    assert review_resp.status_code == 200
    reviewed = review_resp.json()
    assert reviewed["status"] == "APPROVED"
    assert reviewed["admin_note"] == "Verified with security desk"

    attendance = (
        db_session.query(Attendance)
        .filter(
            Attendance.employee_id == own_employee.id,
            Attendance.date == date(2026, 9, 15),
        )
        .first()
    )
    assert attendance is not None
    assert attendance.status == AttendanceStatus.PRESENT
    assert attendance.verification_status == "ADMIN_APPROVED"
