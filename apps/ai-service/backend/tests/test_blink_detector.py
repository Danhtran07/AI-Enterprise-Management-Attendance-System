import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from blink_detector import (  # noqa: E402
    BlinkConfig,
    BlinkDetector,
    LEFT_CHEEK,
    LEFT_EYE,
    NOSE_TIP,
    RIGHT_CHEEK,
    RIGHT_EYE,
)


# ============================================================
# Helpers
# ============================================================

def landmarks_for_ear(ear: float, *, left=None, right=None, scale=1.0, nose_x=0.5):
    """
    Tạo 478 landmark giả với EAR chính xác = `ear` (mỗi mắt có thể chỉnh riêng).
    - scale: phóng to/thu nhỏ hình học mắt (EAR không đổi)
    - nose_x: dịch mũi ngang để giả lập quay đầu (0.5 = nhìn thẳng)
    """
    lm = [SimpleNamespace(x=0.0, y=0.0) for _ in range(478)]
    lm[NOSE_TIP] = SimpleNamespace(x=nose_x, y=0.5)
    lm[LEFT_CHEEK] = SimpleNamespace(x=0.2, y=0.5)
    lm[RIGHT_CHEEK] = SimpleNamespace(x=0.8, y=0.5)

    def build(indices, e, x0):
        outer, upper_a, upper_b, inner, lower_a, lower_b = indices
        w = 0.06 * scale
        h = e * w / 2          # EAR = (2h + 2h) / (2w) = e
        lm[outer] = SimpleNamespace(x=x0, y=0.4)
        lm[inner] = SimpleNamespace(x=x0 + w, y=0.4)
        lm[upper_a] = SimpleNamespace(x=x0 + 0.3 * w, y=0.4 - h)
        lm[lower_b] = SimpleNamespace(x=x0 + 0.3 * w, y=0.4 + h)
        lm[upper_b] = SimpleNamespace(x=x0 + 0.7 * w, y=0.4 - h)
        lm[lower_a] = SimpleNamespace(x=x0 + 0.7 * w, y=0.4 + h)

    build(LEFT_EYE, ear if left is None else left, 0.35)
    build(RIGHT_EYE, ear if right is None else right, 0.55)
    return lm


class Harness:
    """Cấp timestamp giả (mặc định 30 fps) để test không phụ thuộc đồng hồ thật."""

    def __init__(self, fps=30, calibrate=True, scale=1.0, **cfg):
        self.det = BlinkDetector(BlinkConfig(**cfg))
        self.dt = 1.0 / fps
        self.t = 0.0
        if calibrate:
            self.feed([0.30] * self.det.cfg.calibration_frames, scale=scale)
            assert self.det.baseline is not None

    def feed(self, seq, **face_kw):
        out = []
        for item in seq:
            self.t += self.dt
            if isinstance(item, tuple):
                lm = landmarks_for_ear(0.0, left=item[0], right=item[1], **face_kw)
            else:
                lm = landmarks_for_ear(item, **face_kw)
            out.append(self.det.update(lm, timestamp=self.t))
        return out

    def skip(self, seconds):
        self.t += seconds


# ============================================================
# Calibration
# ============================================================

def test_calibration_learns_open_ear_baseline():
    h = Harness(calibrate=False)
    results = h.feed([0.30] * 44)
    assert not results[-1].calibrated
    assert 0.9 < results[-1].calibration_progress < 1.0

    result = h.feed([0.30])[0]
    assert result.calibrated
    assert abs(h.det.baseline[0] - 0.30) < 0.01
    assert abs(h.det.baseline[1] - 0.30) < 0.01


def test_calibration_ignores_blinks_that_happen_during_it():
    h = Harness(calibrate=False)
    h.feed([0.30] * 20 + [0.05] * 2 + [0.30] * 30)
    assert h.det.baseline is not None
    assert abs(h.det.baseline[0] - 0.30) < 0.01


def test_calibration_rejects_closed_eyes_as_baseline():
    h = Harness(calibrate=False)
    h.feed([0.05] * 100)
    assert h.det.baseline is None
    assert h.det.blink_count == 0


# ============================================================
# Blink detection
# ============================================================

def test_blink_requires_open_closed_open_sequence():
    h = Harness()

    assert h.feed([0.30])[0].blink is False
    assert h.feed([0.05])[0].blink is False          # đang nhắm: chưa tính
    result = h.feed([0.30])[0]                       # mở lại: tính 1 lần chớp

    assert result.blink is True
    assert result.count == 1
    assert result.confidence > 0
    assert result.blink_confidence > 0
    assert 0.03 <= result.blink_duration <= 0.8


def test_multi_frame_blink_is_counted_exactly_once():
    h = Harness()
    results = h.feed([0.30] * 5 + [0.20, 0.08, 0.05, 0.08, 0.20] + [0.30] * 5)

    assert sum(r.blink for r in results) == 1
    assert h.det.blink_count == 1
    assert h.det.state.name == "OPEN"


def test_closed_without_prior_open_does_not_count():
    h = Harness(calibrate=False)
    results = h.feed([0.05] * 50 + [0.30] * 60)

    assert not any(r.blink for r in results)
    assert h.det.blink_count == 0


def test_eyes_staying_open_never_blink():
    h = Harness()
    results = h.feed([0.30, 0.31, 0.29, 0.30, 0.32, 0.28] * 20)
    assert not any(r.blink for r in results)


def test_wink_is_not_counted_as_blink():
    h = Harness()
    results = h.feed([0.30] * 5 + [(0.05, 0.30)] * 4 + [0.30] * 5)

    assert h.det.blink_count == 0
    assert any(r.wink for r in results)


def test_long_closure_raises_alert_but_is_not_a_blink():
    h = Harness()
    results = h.feed([0.30] * 5 + [0.05] * 40 + [0.30] * 5)   # ~1.3 s

    assert sum(r.long_close for r in results) == 1             # chỉ báo 1 lần
    assert h.det.blink_count == 0


# ============================================================
# Invalid input
# ============================================================

def assert_rejected(result, count=0):
    assert result.valid is False
    assert result.blink is False
    assert result.confidence == 0.0
    assert result.count == count


def test_no_face_multiple_faces_and_malformed_landmarks_are_rejected():
    h = Harness()
    face = landmarks_for_ear(0.30)
    det = h.det

    assert_rejected(det.update(None, timestamp=h.t + 0.03))
    assert_rejected(det.update([], timestamp=h.t + 0.06))
    assert_rejected(det.update([face, face], timestamp=h.t + 0.09))   # nhiều mặt
    assert_rejected(det.update(face[:100], timestamp=h.t + 0.12))     # thiếu landmark


def test_accepts_mediapipe_style_object_with_landmark_attribute():
    h = Harness()
    wrapped = SimpleNamespace(landmark=landmarks_for_ear(0.30))
    result = h.det.update(wrapped, timestamp=h.t + 0.03)
    assert result.valid is True


def test_head_turn_is_rejected():
    h = Harness()
    lm = landmarks_for_ear(0.30, nose_x=0.7)      # quay đầu mạnh
    result = h.det.update(lm, timestamp=h.t + 0.03)

    assert result.valid is False
    assert result.reason == "head_pose"


def test_losing_face_mid_blink_does_not_count_and_keeps_baseline():
    h = Harness()
    h.feed([0.30] * 3 + [0.05])
    h.det.update(None, timestamp=h.t + 0.03)
    h.t += 0.03
    results = h.feed([0.30] * 5)

    assert h.det.blink_count == 0
    assert not any(r.blink for r in results)
    assert h.det.baseline is not None


def test_frame_gap_resets_tracking():
    h = Harness()
    h.feed([0.30] * 5 + [0.05] * 2)
    h.skip(1.0)                                    # hở 1 giây
    results = h.feed([0.30] * 5)

    assert h.det.blink_count == 0
    assert not any(r.blink for r in results)


# ============================================================
# Normalization
# ============================================================

def test_ear_normalizes_different_eye_sizes():
    # Cùng EAR nhưng mắt to gấp đôi: không được sinh chớp giả, và vẫn bắt được chớp thật
    h = Harness()
    assert not any(r.blink for r in h.feed([0.30] * 10, scale=2.0))
    assert h.feed([0.05], scale=2.0)[0].blink is False
    assert h.feed([0.30], scale=2.0)[0].blink is True


def test_calibration_works_for_any_eye_size():
    for scale in (0.5, 1.0, 3.0):
        h = Harness(scale=scale)
        h.feed([0.30] * 3 + [0.05, 0.30], scale=scale)
        assert h.det.blink_count == 1


def test_per_eye_baselines_handle_naturally_asymmetric_eyes():
    h = Harness(calibrate=False)
    h.feed([(0.34, 0.26)] * 45)                    # mắt trái to hơn mắt phải
    assert h.det.baseline[0] > h.det.baseline[1]

    h.feed([(0.34, 0.26)] * 10)                    # trạng thái bình thường: không wink giả
    results = h.feed([(0.06, 0.05)] * 2 + [(0.34, 0.26)] * 3)
    assert h.det.blink_count == 1
    assert not any(r.wink for r in results)


# ============================================================
# Stats
# ============================================================

def test_blink_rate_is_estimated_per_minute():
    h = Harness()
    for _ in range(4):
        h.feed([0.30] * 59 + [0.05, 0.30])         # ~2 s mỗi chu kỳ
    result = h.feed([0.30])[0]

    assert h.det.blink_count == 4
    assert 20 < result.blink_rate < 40


def test_perclos_increases_when_eyes_are_closed():
    h = Harness()
    open_only = h.feed([0.30] * 60)[-1].perclos
    closed = h.feed([0.02] * 60)[-1].perclos

    assert open_only == 0.0
    assert closed > 0.3