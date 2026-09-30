import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models import SessionState
from session_manager import Session


def completed_bound_session() -> Session:
    session = Session("test-session")
    session.bind_identity(101, np.asarray([1.0, 0.0, 0.0], dtype=np.float32))
    session.state = SessionState.COMPLETE
    session.liveness_status = True
    return session


def test_other_employee_cannot_use_passed_liveness_session():
    session = completed_bound_session()
    assert not session.consume_identity_verification(202, np.asarray([1.0, 0.0, 0.0]), 0.45)


def test_same_employee_with_different_face_embedding_is_rejected():
    session = completed_bound_session()
    assert not session.consume_identity_verification(101, np.asarray([0.0, 1.0, 0.0]), 0.45)


def test_matching_identity_consumes_session_once():
    session = completed_bound_session()
    face = np.asarray([0.99, 0.01, 0.0], dtype=np.float32)
    assert session.consume_identity_verification(101, face, 0.45)
    assert session.verification_consumed is True
    assert not session.consume_identity_verification(101, face, 0.45)


def test_session_without_completed_liveness_cannot_be_consumed():
    session = completed_bound_session()
    session.liveness_status = False
    assert not session.consume_identity_verification(101, np.asarray([1.0, 0.0, 0.0]), 0.45)


def test_identity_similarity_threshold_rejects_weak_match():
    session = completed_bound_session()
    weak_match = np.asarray([0.5, 0.8660254, 0.0], dtype=np.float32)
    assert not session.consume_identity_verification(101, weak_match, 0.60)


def test_liveness_action_frames_must_match_bound_identity():
    session = completed_bound_session()
    assert session.confirm_challenge_identity(0, np.asarray([0.99, 0.01, 0.0]), 0.60)
    assert not session.confirm_challenge_identity(1, np.asarray([0.0, 1.0, 0.0]), 0.60)
    assert not session.has_confirmed_all_challenges(3)
    assert session.confirm_challenge_identity(1, np.asarray([0.99, 0.01, 0.0]), 0.60)
    assert session.confirm_challenge_identity(2, np.asarray([0.99, 0.01, 0.0]), 0.60)
    assert session.has_confirmed_all_challenges(3)
