import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from mouth_detector import MouthConfig, MouthDetector


def landmarks_for_mar(mar: float, scale: float = 1.0):
    points = [SimpleNamespace(x=0.0, y=0.0) for _ in range(468)]
    center_x, center_y = 0.5, 0.5
    width = 0.4 * scale
    height = mar * width
    points[78] = SimpleNamespace(x=center_x - width / 2, y=center_y)
    points[308] = SimpleNamespace(x=center_x + width / 2, y=center_y)
    points[13] = SimpleNamespace(x=center_x, y=center_y - height / 2)
    points[14] = SimpleNamespace(x=center_x, y=center_y + height / 2)
    return points


def test_returns_normalized_open_mouth_contract_and_mar():
    detector = MouthDetector(MouthConfig(smoothing_window=1))

    result = detector.update(landmarks_for_mar(0.65))
    output = result.to_dict()

    assert output["mouth_open"] is True
    assert output["mouth_ratio"] == pytest.approx(0.65)
    assert 0.0 <= output["confidence"] <= 1.0


def test_closed_mouth_does_not_cross_open_threshold():
    detector = MouthDetector(MouthConfig(smoothing_window=1))
    result = detector.update(landmarks_for_mar(0.12))
    assert result.mouth_open is False


def test_median_smoothing_rejects_single_frame_noise():
    detector = MouthDetector(MouthConfig(smoothing_window=3))
    detector.update(landmarks_for_mar(0.12))
    noisy = detector.update(landmarks_for_mar(0.70))
    assert noisy.mouth_open is False
    stable = detector.update(landmarks_for_mar(0.12))
    assert stable.mouth_open is False


def test_hysteresis_keeps_open_until_close_threshold_is_crossed():
    detector = MouthDetector(MouthConfig(smoothing_window=1))
    assert detector.update(landmarks_for_mar(0.40)).mouth_open is True
    assert detector.update(landmarks_for_mar(0.32)).mouth_open is True
    assert detector.update(landmarks_for_mar(0.25)).mouth_open is False


def test_mar_is_invariant_to_face_scale():
    detector = MouthDetector(MouthConfig(smoothing_window=1))
    small = detector.update(landmarks_for_mar(0.5, scale=0.5))
    large = detector.update(landmarks_for_mar(0.5, scale=3.0))
    assert small.mouth_ratio == pytest.approx(large.mouth_ratio)


@pytest.mark.parametrize("bad_input", [None, [], [[], []]])
def test_invalid_or_missing_face_resets_to_closed(bad_input):
    detector = MouthDetector(MouthConfig(smoothing_window=1))
    assert detector.update(landmarks_for_mar(0.5)).mouth_open is True
    result = detector.update(bad_input)
    assert result.to_dict() == {
        "mouth_open": False,
        "mouth_ratio": 0.0,
        "confidence": 0.0,
    }


def test_zero_width_and_non_finite_landmarks_are_rejected():
    detector = MouthDetector(MouthConfig(smoothing_window=1))
    zero_width = landmarks_for_mar(0.5)
    zero_width[78] = zero_width[308]
    assert detector.update(zero_width).mouth_ratio == 0.0

    invalid = landmarks_for_mar(0.5)
    invalid[13] = SimpleNamespace(x=float("nan"), y=0.5)
    assert detector.update(invalid).mouth_ratio == 0.0


def test_invalid_threshold_configuration_is_rejected():
    with pytest.raises(ValueError):
        MouthDetector(MouthConfig(open_threshold=0.2, close_threshold=0.3))
