"""Integration coverage for enrollment -> recognition/liveness -> attendance."""

from datetime import datetime, timezone
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies.auth import get_current_user
from app.core.database import Base, get_db
from app.main import app
from app.models.attendance import Attendance
from app.models.employee import Employee
from app.models.face_data import FaceData
from app.models.user import User, UserRole
from app.schemas.ai import AIEnrollmentResult, AIRecognitionResult, LivenessSessionResponse
from app.services.ai_client import AIRecognitionClient


NOW = datetime(2026, 9, 30, 3, 0, tzinfo=timezone.utc)
REGISTERED_FACE = [1.0, 0.0, 0.0]
OTHER_FACE = [0.0, 1.0, 0.0]


class FlowAIClient:
    """Deterministic AI boundary; DB, API routing and persistence remain real."""

    def __init__(self):
        self.sessions: dict[str, dict] = {}
        self.next_session = 0

    def enroll_face(self, image: bytes) -> AIEnrollmentResult:
        if image.startswith(b"other"):
            embedding = OTHER_FACE
        elif image.startswith(b"employee"):
            embedding = REGISTERED_FACE
        else:
            return AIEnrollmentResult(success=False, error_code="NO_FACE")
        return AIEnrollmentResult(success=True, embedding=embedding)

    def create_liveness_session(self, image=None, candidates=None):
        self.next_session += 1
        session_id = f"integration-session-{self.next_session}"
        employee_id = None
        if image is not None:
            matched = self._match(self._embedding_for_image(image), candidates or [])
            employee_id = matched[0] if matched else None
        self.sessions[session_id] = {"employee_id": employee_id, "challenge": "BLINK"}
        return LivenessSessionResponse(
            session_id=session_id,
            expires_at="2099-01-01T00:00:00+00:00",
            challenges=["BLINK", "OPEN_MOUTH"],
            employee_id=employee_id,
        )

    def recognize(self, image, candidates, *, fast_mode=False, liveness_session_id=None):
        session = self.sessions.get(liveness_session_id)
        embedding = self._embedding_for_image(image)
        match = self._match(embedding, candidates)
        if match is None:
            return AIRecognitionResult(
                matched=False, confidence=0.0, liveness=False,
                error_code="FACE_NOT_RECOGNIZED",
            )
        employee_id, similarity = match
        if session is None:
            return AIRecognitionResult(
                matched=True, employee_id=employee_id, confidence=similarity,
                liveness=False, error_code="LIVENESS_FAILED",
            )
        if session["employee_id"] is not None and session["employee_id"] != employee_id:
            return AIRecognitionResult(
                matched=False, employee_id=employee_id, confidence=similarity,
                liveness=False, error_code="SESSION_IDENTITY_MISMATCH",
            )

        challenge_result = self.sessions[liveness_session_id].get("result")
        if challenge_result is None or not challenge_result["is_live"]:
            return AIRecognitionResult(
                matched=True, employee_id=employee_id, confidence=similarity,
                liveness=False, liveness_score=(challenge_result or {}).get("score", 0.0),
                error_code="LIVENESS_FAILED",
            )
        return AIRecognitionResult(
            matched=True,
            employee_id=employee_id,
            confidence=similarity,
            liveness=True,
            liveness_score=challenge_result["score"],
            verification_status="VERIFIED",
            session_id=liveness_session_id,
        )

    def complete_liveness(
        self,
        session_id: str,
        *,
        blink: bool,
        mouth: bool,
        motion: bool,
        blink_twice: bool = True,
    ):
        """Model the configured BLINK -> OPEN_MOUTH -> BLINK_TWICE sequence."""
        session = self.sessions[session_id]
        score = 0.4 * float(blink and blink_twice) + 0.3 * float(mouth) + 0.3 * float(motion)
        passed = blink and mouth and blink_twice and motion and score >= 0.85
        session["result"] = {
            "is_live": passed,
            "score": round(score, 2),
            "checks": {
                "blink": blink and blink_twice,
                "mouth": mouth,
                "motion": motion,
            },
        }
        return session["result"]

    @staticmethod
    def _embedding_for_image(image: bytes):
        return OTHER_FACE if image.startswith(b"other") else REGISTERED_FACE

    @staticmethod
    def _match(embedding, candidates):
        best = None
        for candidate in candidates:
            vector = candidate.embedding
            score = sum(a * b for a, b in zip(embedding, vector))
            if best is None or score > best[1]:
                best = (candidate.employee_id, score)
        return best if best is not None and best[1] >= 0.45 else None

    def close(self):
        pass


@pytest.fixture
def flow(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = session_factory()
    user = User(
        username="flow-admin", password_hash="not-used", role=UserRole.ADMIN,
    )
    db.add(user)
    db.flush()
    employee = Employee(
        user_id=user.id,
        employee_code="FLOW-001",
        full_name="Flow Employee",
        email="flow@example.com",
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)

    ai = FlowAIClient()
    monkeypatch.setattr(AIRecognitionClient, "__init__", lambda self, *args, **kwargs: None)
    monkeypatch.setattr(AIRecognitionClient, "enroll_face", ai.enroll_face)
    monkeypatch.setattr(AIRecognitionClient, "create_liveness_session", ai.create_liveness_session)
    monkeypatch.setattr(AIRecognitionClient, "recognize", ai.recognize)
    monkeypatch.setattr(AIRecognitionClient, "close", ai.close)

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    try:
        yield {"client": client, "db": db, "employee": employee, "ai": ai}
    finally:
        client.close()
        app.dependency_overrides.clear()
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _enroll(flow):
    response = flow["client"].post(
        f"/api/employees/{flow['employee'].id}/face",
        files=[("images", (f"frame-{index}.jpg", BytesIO(b"employee-frame"), "image/jpeg"))
               for index in range(3)],
    )
    assert response.status_code == 201, response.text
    assert flow["db"].query(FaceData).filter_by(employee_id=flow["employee"].id).count() == 3


def _create_session(flow, initial_frame=b"employee-live"):
    response = flow["client"].post(
        "/api/attendance/liveness/session",
        files={"image": ("initial.jpg", BytesIO(initial_frame), "image/jpeg")},
    )
    assert response.status_code == 200, response.text
    return response.json()["session_id"]


def _recognize(flow, session_id, image=b"employee-live"):
    return flow["client"].post(
        "/api/attendance/recognize",
        data={"liveness_session_id": session_id},
        files={"image": ("frame.jpg", BytesIO(image), "image/jpeg")},
    )


def test_enroll_match_blink_and_mouth_liveness_create_attendance(flow, monkeypatch):
    _enroll(flow)
    session_id = _create_session(flow)
    # Both configured action challenges pass; motion evidence raises score over threshold.
    result = flow["ai"].complete_liveness(session_id, blink=True, mouth=False, motion=True)
    assert result["is_live"] is True

    monkeypatch.setattr(
        "app.services.attendance_recognition.datetime",
        type("FixedDateTime", (), {"now": staticmethod(lambda _tz: NOW)}),
    )
    response = _recognize(flow, session_id)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["employee"]["id"] == flow["employee"].id
    assert body["attendance"]["employee_id"] == flow["employee"].id
    assert body["attendance"]["face_similarity"] == pytest.approx(1.0)
    assert body["attendance"]["liveness_score"] >= 0.85
    assert body["attendance"]["verification_status"] == "VERIFIED"
    assert body["attendance"]["session_id"] == session_id
    assert flow["db"].query(Attendance).count() == 1


def test_open_mouth_challenge_is_required_for_attendance(flow):
    _enroll(flow)
    session_id = _create_session(flow)
    result = flow["ai"].complete_liveness(session_id, blink=True, mouth=True, motion=True)
    assert result["checks"]["mouth"] is True
    assert result["is_live"] is True

    response = _recognize(flow, session_id)

    assert response.status_code == 201, response.text
    assert response.json()["attendance"]["employee_id"] == flow["employee"].id


def test_wrong_face_does_not_match_or_create_attendance(flow):
    _enroll(flow)
    session_id = _create_session(flow)
    flow["ai"].complete_liveness(session_id, blink=True, mouth=False, motion=True)

    response = _recognize(flow, session_id, image=b"other-person")

    assert response.status_code == 422
    assert flow["db"].query(Attendance).count() == 0


@pytest.mark.parametrize("missing_challenge", ["BLINK", "OPEN_MOUTH"])
def test_missing_required_challenge_does_not_create_attendance(flow, missing_challenge):
    _enroll(flow)
    session_id = _create_session(flow)
    result = flow["ai"].complete_liveness(
        session_id,
        blink=missing_challenge != "BLINK",
        mouth=missing_challenge != "OPEN_MOUTH",
        motion=True,
    )
    assert result["is_live"] is False

    response = _recognize(flow, session_id)

    assert response.status_code == 422
    assert flow["db"].query(Attendance).count() == 0


def test_replay_without_motion_is_rejected(flow):
    _enroll(flow)
    session_id = _create_session(flow)
    result = flow["ai"].complete_liveness(session_id, blink=True, mouth=False, motion=False)
    assert result["is_live"] is False

    response = _recognize(flow, session_id)

    assert response.status_code == 422
    assert flow["db"].query(Attendance).count() == 0


def test_liveness_bound_to_another_identity_cannot_create_attendance(flow):
    _enroll(flow)
    session_id = _create_session(flow, initial_frame=b"other-person")
    flow["ai"].complete_liveness(session_id, blink=True, mouth=False, motion=True)

    response = _recognize(flow, session_id, image=b"employee-live")

    assert response.status_code == 422
    assert flow["db"].query(Attendance).count() == 0
