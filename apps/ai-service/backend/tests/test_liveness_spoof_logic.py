import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from liveness_engine import LivenessEngine
from challenge_evaluator import evaluate_challenge
from models import CHALLENGE_SEQUENCE, ChallengeType, FaceMetrics


def test_small_face_with_low_texture_is_not_spoof():
    engine = LivenessEngine()
    decision = engine._spoof_decision(texture_var=10.0, z_std=0.002, face_width=80, face_height=80)
    assert decision is False


def test_large_realistic_face_with_low_texture_is_still_filtered():
    engine = LivenessEngine()
    decision = engine._spoof_decision(texture_var=10.0, z_std=0.002, face_width=220, face_height=260)
    assert decision is True


def test_lighting_mean_helper_has_access_to_opencv():
    import numpy as np

    engine = LivenessEngine()
    landmarks = [
        SimpleNamespace(x=0.2 + (index % 10) * 0.01,
                        y=0.2 + ((index // 10) % 10) * 0.01)
        for index in range(468)
    ]
    frame = np.full((100, 100, 3), 128, dtype=np.uint8)

    assert engine._compute_lighting_mean(frame, landmarks, 100, 100) == 128.0


def test_spoof_helper_has_access_to_opencv():
    import numpy as np

    engine = LivenessEngine()
    landmarks = [SimpleNamespace(x=0.2, y=0.2, z=0.0)] * 468
    frame = np.full((100, 100, 3), 128, dtype=np.uint8)

    texture, z_std, is_spoof = engine._check_spoof(frame, landmarks, 100, 100)

    assert texture == 0.0
    assert z_std == 0.0
    assert is_spoof is False


def test_blink_challenge_uses_completed_blink_event():
    metrics = FaceMetrics(face_detected=True, blink_detected=True, blink_count=1)

    passed, count = evaluate_challenge(ChallengeType.BLINK, metrics, 0)

    assert passed is True
    assert count == 1


def test_blink_challenge_does_not_pass_without_blink_signal():
    metrics = FaceMetrics(face_detected=True, blink_detected=False, blink_score=0.7)

    passed, count = evaluate_challenge(ChallengeType.BLINK, metrics, 0)

    assert passed is False
    assert count == 0


def test_mouth_open_challenge_accepts_a_clear_mouth_open_score():
    metrics = FaceMetrics(face_detected=True, mouth_open_score=0.3)

    passed, count = evaluate_challenge(ChallengeType.OPEN_MOUTH, metrics, 19)

    assert passed is True
    assert count == 20


def test_low_light_frame_does_not_pass_liveness_challenge():
    metrics = FaceMetrics(face_detected=True, lighting_mean=18.0, is_low_light=True)

    passed, count = evaluate_challenge(ChallengeType.BLINK, metrics, 19)

    assert passed is False
    assert count == 0


def test_challenge_sequence_has_no_head_turn_steps():
    assert CHALLENGE_SEQUENCE == [
        ChallengeType.BLINK,
        ChallengeType.OPEN_MOUTH,
    ]
    assert "BLINK_TWICE" not in ChallengeType.__members__
    assert "TURN_LEFT" not in ChallengeType.__members__
    assert "TURN_RIGHT" not in ChallengeType.__members__


def test_blink_calibration_is_exposed_in_frame_metrics():
    assert FaceMetrics(face_detected=True).blink_calibrated is False


def test_blink_score_uses_eye_geometry_when_blendshape_is_missing():
    landmarks = [SimpleNamespace(x=0.0, y=0.0) for _ in range(400)]
    for indices in ((33, 160, 158, 133, 153, 144), (362, 385, 387, 263, 373, 380)):
        outer, upper_a, upper_b, inner, lower_a, lower_b = indices
        landmarks[outer] = SimpleNamespace(x=0.0, y=0.0)
        landmarks[inner] = SimpleNamespace(x=1.0, y=0.0)
        landmarks[upper_a] = SimpleNamespace(x=0.5, y=0.05)
        landmarks[upper_b] = SimpleNamespace(x=0.5, y=0.05)
        landmarks[lower_a] = SimpleNamespace(x=0.5, y=-0.05)
        landmarks[lower_b] = SimpleNamespace(x=0.5, y=-0.05)

    result = SimpleNamespace(face_blendshapes=[])
    score = LivenessEngine.__new__(LivenessEngine)._compute_blink_score(result, landmarks)

    assert score >= 0.35


def test_lighting_mean_helper_has_access_to_opencv():
    import numpy as np

    engine = LivenessEngine()
    landmarks = [
        SimpleNamespace(x=0.2 + (index % 10) * 0.01,
                        y=0.2 + ((index // 10) % 10) * 0.01)
        for index in range(468)
    ]
    frame = np.full((100, 100, 3), 128, dtype=np.uint8)

    assert engine._compute_lighting_mean(frame, landmarks, 100, 100) == 128.0


def test_spoof_helper_has_access_to_opencv():
    import numpy as np

    engine = LivenessEngine()
    landmarks = [SimpleNamespace(x=0.2, y=0.2, z=0.0)] * 468
    frame = np.full((100, 100, 3), 128, dtype=np.uint8)

    texture, z_std, is_spoof = engine._check_spoof(frame, landmarks, 100, 100)

    assert texture == 0.0
    assert z_std == 0.0
    assert is_spoof is False
