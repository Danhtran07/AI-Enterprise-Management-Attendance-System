"""Landmark-only mouth opening detector using normalized MAR."""

from __future__ import annotations

import math
from collections import deque
from dataclasses import asdict, dataclass
from typing import Any


UPPER_INNER_LIP = 13
LOWER_INNER_LIP = 14
LEFT_MOUTH_CORNER = 78
RIGHT_MOUTH_CORNER = 308


@dataclass(frozen=True)
class MouthConfig:
    open_threshold: float = 0.35
    close_threshold: float = 0.28
    smoothing_window: int = 3


@dataclass
class MouthResult:
    mouth_open: bool = False
    mouth_ratio: float = 0.0
    confidence: float = 0.0

    def to_dict(self) -> dict[str, bool | float]:
        return asdict(self)


class MouthDetector:
    """Compute mouth aspect ratio from one MediaPipe FaceMesh face.

    The MAR is inner-lip distance divided by mouth-corner distance, making it
    scale invariant. Temporal median smoothing and hysteresis reduce jitter.
    """

    def __init__(self, config: MouthConfig | None = None) -> None:
        self.config = config or MouthConfig()
        if not 0 <= self.config.close_threshold < self.config.open_threshold:
            raise ValueError("thresholds must satisfy 0 <= close < open")
        if self.config.smoothing_window < 1:
            raise ValueError("smoothing_window must be >= 1")
        self._history: deque[float] = deque(maxlen=self.config.smoothing_window)
        self._mouth_open = False

    def update(self, landmarks: Any) -> MouthResult:
        """Consume landmarks (or None) and return normalized mouth state."""
        points = self._extract(landmarks)
        if points is None:
            self.reset()
            return MouthResult()

        mar = self._mar(points)
        if mar is None or not math.isfinite(mar):
            self.reset()
            return MouthResult()

        self._history.append(mar)
        smooth_mar = sorted(self._history)[len(self._history) // 2]
        if self._mouth_open:
            if smooth_mar <= self.config.close_threshold:
                self._mouth_open = False
        elif smooth_mar >= self.config.open_threshold:
            self._mouth_open = True

        # Confidence represents distance from the active decision boundary.
        if self._mouth_open:
            confidence = min(1.0, 0.5 + (smooth_mar - self.config.open_threshold) / 0.5)
        else:
            confidence = min(1.0, 0.5 + (self.config.open_threshold - smooth_mar) / 0.5)
        confidence = max(0.0, confidence)
        return MouthResult(
            mouth_open=self._mouth_open,
            mouth_ratio=round(smooth_mar, 4),
            confidence=round(confidence, 3),
        )

    def reset(self) -> None:
        """Clear temporal smoothing and return to closed-mouth state."""
        self._history.clear()
        self._mouth_open = False

    @staticmethod
    def _extract(landmarks: Any) -> Any | None:
        if landmarks is None:
            return None
        sequence = getattr(landmarks, "landmark", landmarks)
        try:
            if len(sequence) <= RIGHT_MOUTH_CORNER:
                return None
            # Multiple faces are not a valid single-face input.
            if not hasattr(sequence[UPPER_INNER_LIP], "x"):
                return None
            indices = (UPPER_INNER_LIP, LOWER_INNER_LIP,
                       LEFT_MOUTH_CORNER, RIGHT_MOUTH_CORNER)
            for index in indices:
                point = sequence[index]
                x, y = float(point.x), float(point.y)
                if not (math.isfinite(x) and math.isfinite(y)):
                    return None
            return sequence
        except (TypeError, ValueError, IndexError, AttributeError):
            return None

    @staticmethod
    def _mar(points: Any) -> float | None:
        upper, lower, left, right = (points[i] for i in (
            UPPER_INNER_LIP, LOWER_INNER_LIP, LEFT_MOUTH_CORNER, RIGHT_MOUTH_CORNER
        ))
        width = math.hypot(float(left.x) - float(right.x), float(left.y) - float(right.y))
        if width <= 1e-8:
            return None
        height = math.hypot(float(upper.x) - float(lower.x), float(upper.y) - float(lower.y))
        return height / width
