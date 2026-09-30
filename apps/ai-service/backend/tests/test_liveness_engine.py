import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from liveness_engine import ChallengeManager, LivenessEngine, LIVE_THRESHOLD


class FakeLandmarker:
    def close(self):
        pass


def make_engine():
    return LivenessEngine(challenge_manager=ChallengeManager(), face_landmarker=FakeLandmarker())


def test_engine_uses_injected_manager_and_detector():
    manager = ChallengeManager()
    detector = FakeLandmarker()
    engine = LivenessEngine(challenge_manager=manager, face_landmarker=detector)

    assert engine.challenge_manager is manager
    assert engine.detector is detector


def test_blink_challenge_uses_blink_confidence_and_motion_weight():
    result = make_engine().process(
        {"blink": True, "blink_count": 1, "confidence": 0.95, "motion_score": 0.9},
        {"mouth_open": False, "confidence": 0.0},
    )

    assert result == {
        "live": False,
        "score": 0.94,
        "challenge": "BLINK",
        "checks": {"blink": True, "mouth": False},
    }


def test_open_mouth_is_next_challenge_and_keeps_checks():
    engine = make_engine()
    engine.process({"blink": True, "blink_count": 1, "confidence": 0.95}, {})

    result = engine.process(
        SimpleNamespace(blink=False, count=1, confidence=0.0),
        SimpleNamespace(mouth_open=True, confidence=0.95),
    )

    assert result["challenge"] == "OPEN_MOUTH"
    assert result["score"] == 0.76
    assert result["checks"] == {"blink": True, "mouth": True}
    assert result["live"] is False


def test_engine_accepts_motion_detector_output_as_score_input():
    result = make_engine().process(
        {"blink": True, "blink_count": 1, "confidence": 0.95},
        {"mouth_open": False, "confidence": 0.0},
        {"motion_detected": True, "movement_score": 0.9},
    )

    assert result["score"] == 0.94


def test_live_requires_all_challenges_and_threshold():
    engine = make_engine()
    first = engine.process({"blink": True, "blink_count": 1, "confidence": 1.0}, {})
    second = engine.process({}, {"mouth_open": True, "confidence": 1.0})
    final = engine.process(
        {"blink": True, "blink_count": 3, "confidence": 1.0},
        {"mouth_open": False, "confidence": 0.0},
    )

    assert first["live"] is False
    assert second["live"] is False
    assert final["challenge"] == "BLINK_TWICE"
    assert final["checks"] == {"blink": True, "mouth": True}
    assert final["score"] >= LIVE_THRESHOLD
    assert final["live"] is True


def test_blink_twice_requires_two_distinct_blinks():
    engine = make_engine()
    engine.process({"blink": True, "blink_count": 1, "confidence": 1.0}, {})
    engine.process({}, {"mouth_open": True, "confidence": 1.0})

    incomplete = engine.process(
        {"blink": True, "blink_count": 2, "confidence": 1.0}, {}
    )
    assert incomplete["challenge"] == "BLINK_TWICE"
    assert incomplete["live"] is False

    complete = engine.process(
        {"blink": True, "blink_count": 3, "confidence": 1.0}, {}
    )
    assert complete["live"] is True


def test_invalid_confidence_is_clamped_and_cannot_pass_challenges():
    result = make_engine().process(
        {"blink": True, "blink_count": 1, "confidence": float("nan")}, {}
    )

    assert result["score"] == 0.2
    assert result["live"] is False


def test_terminal_calls_are_stable_and_report_passed():
    engine = make_engine()
    engine.process({"blink": True, "blink_count": 1, "confidence": 1.0}, {})
    engine.process({}, {"mouth_open": True, "confidence": 1.0})
    engine.process({"blink": True, "blink_count": 3, "confidence": 1.0}, {})

    result = engine.process({}, {})

    assert result["challenge"] == "PASSED"
    assert result["live"] is True
    assert result["checks"] == {"blink": True, "mouth": True}
