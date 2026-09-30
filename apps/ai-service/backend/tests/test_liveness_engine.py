import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from liveness_engine import (
    BLINK_WEIGHT,
    LIVE_THRESHOLD,
    LivenessEngine,
    MOTION_WEIGHT,
    MOUTH_WEIGHT,
)


def test_weighted_score_and_required_output_contract():
    engine = LivenessEngine()

    result = engine.process(
        {"blink_detected": True, "blink_count": 1, "confidence": 0.95},
        {"mouth_open": True, "confidence": 0.9},
        {"motion_detected": True, "movement_score": 0.85},
    )

    assert result == {
        "is_live": True,
        "liveness_score": 0.905,
        "checks": {"blink": True, "mouth": True, "motion": True},
    }


def test_weight_constants_match_contract():
    assert (BLINK_WEIGHT, MOUTH_WEIGHT, MOTION_WEIGHT) == (0.4, 0.3, 0.3)
    assert LIVE_THRESHOLD == 0.85


def test_accumulates_checks_across_detector_updates():
    engine = LivenessEngine()
    first = engine.process(
        {"blink_detected": True, "confidence": 0.95}, {}, {}
    )
    assert first["is_live"] is False
    assert first["checks"] == {"blink": True, "mouth": False, "motion": False}

    second = engine.process(
        {}, {"mouth_open": True, "confidence": 0.9},
        {"motion_detected": True, "movement_score": 0.85},
    )
    assert second["is_live"] is True
    assert second["liveness_score"] == 0.905


def test_result_objects_are_supported_and_negative_observations_do_not_erase_checks():
    engine = LivenessEngine()
    engine.process(
        SimpleNamespace(blink_detected=True, blink_count=1, confidence=0.9),
        SimpleNamespace(mouth_open=True, confidence=0.8),
        SimpleNamespace(motion_detected=True, movement_score=0.9),
    )
    result = engine.process({}, {}, {})
    assert result["checks"] == {"blink": True, "mouth": True, "motion": True}
    assert result["liveness_score"] == pytest.approx(0.87)


def test_motion_score_is_ignored_when_motion_not_detected():
    result = LivenessEngine().process(
        {"blink_detected": True, "confidence": 1.0},
        {"mouth_open": True, "confidence": 1.0},
        {"motion_detected": False, "movement_score": 1.0},
    )
    assert result["checks"]["motion"] is False
    assert result["liveness_score"] == 0.7
    assert result["is_live"] is False


def test_confidence_is_clamped_and_non_finite_values_are_rejected():
    result = LivenessEngine().process(
        {"blink_detected": True, "confidence": float("nan")},
        {"mouth_open": True, "confidence": 2.0},
        {"motion_detected": True, "movement_score": -3.0},
    )
    assert result["liveness_score"] == 0.3
    assert result["is_live"] is False


def test_reset_clears_accumulated_liveness_state():
    engine = LivenessEngine()
    engine.process(
        {"blink_detected": True, "confidence": 1.0},
        {"mouth_open": True, "confidence": 1.0},
        {"motion_detected": True, "movement_score": 1.0},
    )
    engine.reset()
    result = engine.process({}, {}, {})
    assert result == {
        "is_live": False,
        "liveness_score": 0.0,
        "checks": {"blink": False, "mouth": False, "motion": False},
    }


def test_challenge_evaluation_and_weighted_score_are_owned_by_engine():
    engine = LivenessEngine()
    blink = SimpleNamespace(
        face_detected=True, is_spoof=False, is_low_light=False,
        blink_detected=True, blink_count=1, blink_confidence=0.95,
        motion_detected=True, movement_score=0.85,
    )
    first = engine.evaluate_challenge("ws-session", "BLINK", blink, 0)
    assert first["challenge_passed"] is True
    assert first["checks"] == {"blink": True, "mouth": False, "motion": True}

    mouth = SimpleNamespace(
        face_detected=True, is_spoof=False, is_low_light=False,
        mouth_open=True, mouth_confidence=0.9,
        motion_detected=False, movement_score=0.0,
    )
    consecutive = 0
    for frame_index in range(20):
        progress = engine.evaluate_challenge(
            "ws-session", "OPEN_MOUTH", mouth, consecutive
        )
        consecutive = progress["consecutive_count"]
        assert progress["challenge_passed"] is (frame_index == 19)
    passed = progress
    assert passed["challenge_passed"] is True
    assert passed["liveness_score"] == 0.905

    twice = SimpleNamespace(
        face_detected=True, is_spoof=False, is_low_light=False,
        blink_detected=True, blink_count=3, blink_confidence=0.95,
        motion_detected=False, movement_score=0.0,
    )
    final = engine.evaluate_challenge(
        "ws-session", "BLINK_TWICE", twice, 0,
        blink_count_at_start=1, is_final_challenge=True,
    )
    assert final["is_live"] is True
    assert final["liveness_score"] == 0.905
