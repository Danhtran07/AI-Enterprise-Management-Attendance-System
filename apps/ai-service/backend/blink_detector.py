"""
Advanced Eye Blink Detector v2
==============================

Cải tiến so với bản cũ:
- EAR tính theo PIXEL (không méo theo tỉ lệ khung hình) và có baseline RIÊNG cho từng mắt
- Calibration bền vững: loại bỏ mẫu chớp mắt, kiểm tra khoảng hợp lệ, tự hiệu chỉnh lại
- Ngưỡng theo TỈ LỆ so với baseline (ear / open_ear) + hysteresis (close < open)
- Baseline thích nghi chậm khi mắt đang mở (chịu được đổi ánh sáng / tư thế)
- Làm mượt bằng EMA nhẹ (không "nuốt" các cú chớp nhanh như moving average)
- State machine đầy đủ: OPEN -> CLOSING -> CLOSED -> OPENING -> OPEN
- Phân biệt: chớp mắt / nháy 1 mắt (wink) / nhắm lâu (buồn ngủ)
- Mất khung hình hoặc mất mặt -> reset an toàn
- Nhận timestamp ngoài (dùng được với file video / unit test), mặc định monotonic clock
- Thống kê: blink rate / phút, PERCLOS, confidence theo từng frame và từng lần chớp
"""

from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import dataclass, asdict
from enum import Enum
from typing import Optional, Tuple


# ============================================================
# MediaPipe FaceMesh indexes
# ============================================================

LEFT_EYE = (33, 160, 158, 133, 153, 144)      # p1..p6
RIGHT_EYE = (362, 385, 387, 263, 373, 380)    # p1..p6

class BlinkState(Enum):
    INIT = 0      # đang calibration
    OPEN = 1
    CLOSING = 2
    CLOSED = 3
    OPENING = 4


# ============================================================
# Config & Result
# ============================================================

@dataclass
class BlinkConfig:
    # calibration
    calibration_frames: int = 45
    baseline_range: Tuple[float, float] = (0.12, 0.50)   # EAR mắt mở hợp lệ
    baseline_alpha: float = 0.01                         # tốc độ thích nghi baseline

    # smoothing (1.0 = không làm mượt). Cao hơn = nhạy hơn với chớp nhanh
    ema_alpha: float = 0.8

    # ngưỡng theo tỉ lệ ear/baseline (hysteresis: close < open)
    close_ratio: float = 0.65
    open_ratio: float = 0.82

    # thời gian (giây). 30fps => 1 frame ~ 0.033s
    min_blink_time: float = 0.03
    max_blink_time: float = 0.80        # dài hơn => coi là nhắm lâu (drowsy)

    # chất lượng
    max_frame_gap: float = 0.5          # khoảng hở frame tối đa trước khi reset
    max_wink_asym: float = 0.35         # chênh lệch tỉ lệ 2 mắt coi là bất đối xứng
    wink_frame_ratio: float = 0.5       # >50% frame bất đối xứng => wink
    # thống kê
    stats_window: float = 60.0
    perclos_ratio: float = 0.2          # mắt nhắm >=80% => tính vào PERCLOS


@dataclass
class BlinkResult:
    blink: bool = False
    count: int = 0
    state: str = "INIT"
    ear: float = 0.0                 # EAR trung bình (đã làm mượt)
    ratio: float = 0.0               # ear / baseline
    confidence: float = 0.0          # chất lượng frame hiện tại
    valid: bool = False              # frame có dùng được không
    reason: str = ""                 # lý do nếu invalid
    calibrated: bool = False
    calibration_progress: float = 0.0
    long_close: bool = False         # nhắm quá lâu (cảnh báo buồn ngủ)
    wink: bool = False
    blink_duration: float = 0.0
    blink_confidence: float = 0.0
    blink_rate: float = 0.0          # lần/phút trong cửa sổ thống kê
    perclos: float = 0.0             # 0..1

    def to_dict(self):
        return asdict(self)


# ============================================================
# Detector
# ============================================================

class BlinkDetector:

    def __init__(self, config: Optional[BlinkConfig] = None):
        self.cfg = config or BlinkConfig()
        self.blink_count = 0
        self.recalibrate()

    # --------------------------------------------------------
    # PUBLIC API
    # --------------------------------------------------------

    def recalibrate(self):
        """Xóa baseline và calibration lại từ đầu."""
        self.baseline: Optional[Tuple[float, float]] = None
        self._calib = deque(maxlen=self.cfg.calibration_frames)
        self._t0: Optional[float] = None
        self._blink_times = deque()
        self._perclos = deque()          # (t, dt, closed)
        self._perclos_total = 0.0
        self._perclos_closed = 0.0
        self.reset()

    def reset(self):
        """Reset tracking nhưng GIỮ baseline."""
        self.state = BlinkState.INIT if self.baseline is None else BlinkState.OPEN
        self._ema: Optional[Tuple[float, float]] = None
        self._last_t: Optional[float] = None
        self._clear_blink()

    def update(self, landmarks, timestamp: Optional[float] = None,
               image_size: Optional[Tuple[int, int]] = None) -> BlinkResult:
        """
        landmarks : MediaPipe face landmarks (list hoặc NormalizedLandmarkList)
        timestamp : giây (tùy chọn). Mặc định time.monotonic()
        image_size: (width, height) để tính EAR theo pixel (khuyến nghị)
        """
        cfg = self.cfg
        t = time.monotonic() if timestamp is None else float(timestamp)
        res = BlinkResult(count=self.blink_count, state=self.state.name,
                          calibrated=self.baseline is not None)

        # frame bị hở quá lâu -> dữ liệu cũ không còn đáng tin
        dt = 0.0
        if self._last_t is not None:
            dt = t - self._last_t
            if dt < 0 or dt > cfg.max_frame_gap:
                self.reset()
                dt = 0.0
        self._last_t = t

        # ---- lấy EAR 2 mắt ----
        eyes = self._eyes(landmarks, image_size)
        if eyes is None:
            self.reset()
            res.reason = "no_face"
            res.state = self.state.name
            return res

        # ---- làm mượt EMA từng mắt ----
        a = cfg.ema_alpha
        if self._ema is None:
            self._ema = eyes
        else:
            self._ema = (a * eyes[0] + (1 - a) * self._ema[0],
                         a * eyes[1] + (1 - a) * self._ema[1])
        el, er = self._ema
        res.ear = round((el + er) / 2, 4)
        res.valid = True

        # ---- calibration ----
        if self.baseline is None:
            self._calibrate(el, er)
            res.calibrated = self.baseline is not None
            res.calibration_progress = min(1.0, len(self._calib) / cfg.calibration_frames)
            res.state = self.state.name
            return res
        res.calibrated = True
        res.calibration_progress = 1.0

        # ---- tỉ lệ so với baseline ----
        lr = el / self.baseline[0]
        rr = er / self.baseline[1]
        ratio = (lr + rr) / 2
        asym = abs(lr - rr)
        res.ratio = round(ratio, 3)

        if self._t0 is None:
            self._t0 = t

        # ---- state machine ----
        blink, long_close, wink = self._step(ratio, asym, t)

        # ---- baseline thích nghi khi mắt đang mở ổn định ----
        if self.state == BlinkState.OPEN and 0.9 <= lr <= 1.25 and 0.9 <= rr <= 1.25:
            b = cfg.baseline_alpha
            self.baseline = (self.baseline[0] + b * (el - self.baseline[0]),
                             self.baseline[1] + b * (er - self.baseline[1]))

        # ---- thống kê ----
        self._update_stats(t, dt, ratio, blink)

        # ---- kết quả ----
        res.blink = blink
        res.long_close = long_close
        res.wink = wink
        res.count = self.blink_count
        res.state = self.state.name
        res.confidence = self._frame_confidence(ratio, asym)
        res.blink_rate = self._blink_rate(t)
        res.perclos = round(self._perclos_closed / self._perclos_total, 3) \
            if self._perclos_total > 0 else 0.0
        if blink:
            res.blink_duration = round(self._last_duration, 3)
            res.blink_confidence = self._last_blink_conf
        return res

    # --------------------------------------------------------
    # EAR
    # --------------------------------------------------------

    @staticmethod
    def _points(landmarks, image_size):
        lms = getattr(landmarks, "landmark", landmarks)
        w, h = image_size if image_size else (1.0, 1.0)
        return lambda i: (lms[i].x * w, lms[i].y * h)

    def _eyes(self, landmarks, image_size):
        if landmarks is None:
            return None
        try:
            pt = self._points(landmarks, image_size)
            left = self._ear(pt, LEFT_EYE)
            right = self._ear(pt, RIGHT_EYE)
        except Exception:
            return None
        if left is None or right is None:
            return None
        return left, right

    @staticmethod
    def _ear(pt, idx):
        p1, p2, p3, p4, p5, p6 = (pt(i) for i in idx)
        horizontal = math.dist(p1, p4)
        if horizontal < 1e-9:
            return None
        return (math.dist(p2, p6) + math.dist(p3, p5)) / (2.0 * horizontal)

    # --------------------------------------------------------
    # CALIBRATION
    # --------------------------------------------------------

    def _calibrate(self, el, er):
        self._calib.append((el, er))
        if len(self._calib) < self.cfg.calibration_frames:
            return

        lo, hi = self.cfg.baseline_range
        result = []
        for k in (0, 1):
            vals = sorted(v[k] for v in self._calib)
            med = vals[len(vals) // 2]
            # bỏ các mẫu thấp bất thường (đang chớp trong lúc calibrate)
            good = [v for v in vals if v >= 0.8 * med]
            base = sum(good) / len(good)
            if not (lo <= base <= hi):
                return          # dữ liệu xấu: tiếp tục thu thập (cửa sổ trượt)
            result.append(base)

        self.baseline = (result[0], result[1])
        self.state = BlinkState.OPEN

    # --------------------------------------------------------
    # STATE MACHINE
    # --------------------------------------------------------

    def _clear_blink(self):
        self._t_start = None
        self._min_ratio = 1.0
        self._frames = 0
        self._asym_frames = 0
        self._long_fired = False
        self._last_duration = 0.0
        self._last_blink_conf = 0.0

    def _accumulate(self, ratio, asym):
        self._min_ratio = min(self._min_ratio, ratio)
        self._frames += 1
        if asym > self.cfg.max_wink_asym:
            self._asym_frames += 1

    def _step(self, ratio, asym, t):
        cfg = self.cfg
        blink = long_close = wink = False
        s = self.state

        if s in (BlinkState.OPEN, BlinkState.INIT):
            if ratio < cfg.open_ratio:
                self._clear_blink()
                self._t_start = t
                self._accumulate(ratio, asym)
                # rơi thẳng xuống dưới ngưỡng đóng ngay frame đầu (chớp nhanh)
                self.state = (BlinkState.CLOSED if ratio < cfg.close_ratio
                              else BlinkState.CLOSING)
            else:
                self.state = BlinkState.OPEN

        elif s == BlinkState.CLOSING:
            self._accumulate(ratio, asym)
            if ratio < cfg.close_ratio:
                self.state = BlinkState.CLOSED
            elif ratio >= cfg.open_ratio:
                self.state = BlinkState.OPEN         # nhiễu, không phải chớp mắt

        elif s == BlinkState.CLOSED:
            self._accumulate(ratio, asym)
            if ratio >= cfg.open_ratio:
                blink, wink = self._finish(t)        # mở lại hẳn trong 1 frame
                self.state = BlinkState.OPEN
            elif ratio >= cfg.close_ratio:
                self.state = BlinkState.OPENING
            elif (t - self._t_start) > cfg.max_blink_time and not self._long_fired:
                self._long_fired = True
                long_close = True                    # cảnh báo realtime

        elif s == BlinkState.OPENING:
            self._accumulate(ratio, asym)
            if ratio < cfg.close_ratio:
                self.state = BlinkState.CLOSED
            elif ratio >= cfg.open_ratio:
                blink, wink = self._finish(t)
                self.state = BlinkState.OPEN

        return blink, long_close, wink

    def _finish(self, t):
        cfg = self.cfg
        duration = t - self._t_start
        asym_frac = self._asym_frames / max(1, self._frames)
        wink = asym_frac > cfg.wink_frame_ratio
        is_blink = (not wink) and (cfg.min_blink_time <= duration <= cfg.max_blink_time)

        if is_blink:
            self.blink_count += 1
            self._blink_times.append(t)
            self._last_duration = duration
            depth = min(1.0, (1.0 - self._min_ratio) / 0.6)
            plausible = 1.0 if 0.06 <= duration <= 0.45 else 0.5
            self._last_blink_conf = round(
                0.5 * depth + 0.3 * (1.0 - asym_frac) + 0.2 * plausible, 3)
        return is_blink, wink

    # --------------------------------------------------------
    # STATS & QUALITY
    # --------------------------------------------------------

    def _update_stats(self, t, dt, ratio, blink):
        cfg = self.cfg
        closed = ratio < cfg.perclos_ratio
        if dt > 0:
            self._perclos.append((t, dt, closed))
            self._perclos_total += dt
            if closed:
                self._perclos_closed += dt
        cutoff = t - cfg.stats_window
        while self._perclos and self._perclos[0][0] < cutoff:
            _, d, c = self._perclos.popleft()
            self._perclos_total -= d
            if c:
                self._perclos_closed -= d
        while self._blink_times and self._blink_times[0] < cutoff:
            self._blink_times.popleft()

    def _blink_rate(self, t):
        if self._t0 is None:
            return 0.0
        span = min(self.cfg.stats_window, max(t - self._t0, 1e-6))
        if span < 5.0:                      # chưa đủ dữ liệu để ước lượng
            return 0.0
        return round(len(self._blink_times) / span * 60.0, 1)

    def _frame_confidence(self, ratio, asym):
        cfg = self.cfg
        decisive = 1.0 if (ratio <= cfg.close_ratio or ratio >= cfg.open_ratio) else 0.5
        sync = max(0.0, 1.0 - asym / cfg.max_wink_asym)
        return round(min(1.0, 0.55 * decisive + 0.45 * sync), 3)


# ============================================================
# Demo (cần: pip install opencv-python mediapipe)
# ============================================================

def _demo():
    import cv2
    import mediapipe as mp

    detector = BlinkDetector()
    mesh = mp.solutions.face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True)
    cap = cv2.VideoCapture(0)

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        h, w = frame.shape[:2]
        out = mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        face = out.multi_face_landmarks[0] if out.multi_face_landmarks else None
        r = detector.update(face, image_size=(w, h))

        if not r.calibrated:
            text = f"Calibrating {r.calibration_progress:.0%} - nhin thang, mo mat"
        else:
            text = (f"Blinks {r.count} | {r.blink_rate}/min | PERCLOS {r.perclos} "
                    f"| {r.state}" + (" | DROWSY!" if r.long_close else ""))
        cv2.putText(frame, text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        cv2.imshow("blink", frame)
        if cv2.waitKey(1) & 0xFF == 27:
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    _demo()
