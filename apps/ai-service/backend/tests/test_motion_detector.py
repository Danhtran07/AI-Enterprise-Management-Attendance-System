import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from liveness.motion_detector import MotionDetector, MotionDetectorConfig


def face_landmarks(offset_x: float = 0.0, offset_y: float = 0.0):
    return [
        SimpleNamespace(x=(index % 30) / 30 + offset_x,
                        y=(index % 17) / 17 + offset_y)
        for index in range(478)
    ]


def detector():
    return MotionDetector(MotionDetectorConfig(
        smoothing_window=1,
        motion_threshold=0.002,
        score_saturation=0.02,
        stationary_frames=3,
    ))


def test_detects_real_landmark_motion():
    motion = detector()
    motion.update(face_landmarks())

    result = motion.update(face_landmarks(offset_x=0.03, offset_y=0.01))

    assert result["motion_detected"] is True
    assert result["movement_score"] > 0.9


def test_rejects_unchanged_landmarks_after_stationary_window():
    motion = detector()
    points = face_landmarks()
    results = [motion.update(points) for _ in range(8)]

    assert all(result["motion_detected"] is False for result in results)
    assert results[-1]["movement_score"] == 0.0


def test_missing_or_invalid_landmarks_return_negative_and_clear_history():
    motion = detector()
    motion.update(face_landmarks())
    motion.update(face_landmarks(offset_x=0.04))

    assert motion.update(None) == {"motion_detected": False, "movement_score": 0.0}
    assert motion.update([]) == {"motion_detected": False, "movement_score": 0.0}
    assert motion.update(face_landmarks()[:100]) == {
        "motion_detected": False,
        "movement_score": 0.0,
    }


def test_reset_clears_temporal_state():
    motion = detector()
    motion.update(face_landmarks())
    assert motion.update(face_landmarks(offset_x=0.04))["motion_detected"] is True

    motion.reset()

    assert motion.update(face_landmarks(offset_x=0.04))["motion_detected"] is False
    assert motion.update(face_landmarks(offset_x=0.04))["movement_score"] == 0.0


def test_accepts_normalized_landmark_list_wrapper_and_rejects_multiple_faces():
    motion = detector()
    wrapped = SimpleNamespace(landmark=face_landmarks())

    assert motion.update(wrapped)["motion_detected"] is False
    assert motion.update([face_landmarks(), face_landmarks()]) == {
        "motion_detected": False,
        "movement_score": 0.0,
    }
