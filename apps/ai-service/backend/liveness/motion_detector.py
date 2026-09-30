"""Temporal facial-landmark motion detection independent of MediaPipe.

The detector compares selected facial landmark coordinates between frames.
It does not estimate head pose or require a particular gesture; it reports
whether the tracked facial region has moved enough to provide a motion signal.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass
from typing import Any, Sequence


# Eyes, eyebrows, nose, lips, mouth corners, and chin. These are stable
# FaceMesh indices shared by the classic 468 and refined 478 landmark meshes.
TRACKED_LANDMARKS = (
    10, 33, 46, 52, 55, 65, 107, 133, 145, 152, 159, 160, 168, 234,
    263, 276, 282, 285, 295, 338, 362, 374, 386, 387, 397, 454,
    13, 14, 17, 61, 78, 80, 81, 82, 87, 88, 95, 178, 181, 185, 191,
    267, 270, 291, 308, 310, 311, 312, 317, 318, 324,
)


@dataclass(frozen=True)
class MotionDetectorConfig:
    """Tunable thresholds for landmark motion filtering."""

    history_size: int = 8
    smoothing_window: int = 5
    motion_threshold: float = 0.002
    score_saturation: float = 0.02
    stationary_frames: int = 5

    def __post_init__(self) -> None:
        if self.history_size < 2:
            raise ValueError("history_size must be at least 2")
        if self.smoothing_window < 1:
            raise ValueError("smoothing_window must be positive")
        if self.motion_threshold < 0:
            raise ValueError("motion_threshold cannot be negative")
        if self.score_saturation <= self.motion_threshold:
            raise ValueError("score_saturation must exceed motion_threshold")
        if self.stationary_frames < 1:
            raise ValueError("stationary_frames must be positive")


class MotionDetector:
    """Track normalized facial landmark movement across successive frames.

    Args:
        config: Optional immutable detector configuration.

    ``update`` accepts either a single FaceMesh landmark sequence or an object
    with a ``landmark`` sequence (such as a MediaPipe NormalizedLandmarkList).
    A missing, ambiguous, malformed, or non-finite face resets tracking and
    returns a negative motion result.
    """

    def __init__(self, config: MotionDetectorConfig | None = None) -> None:
        self.config = config or MotionDetectorConfig()
        self._landmark_history: deque[tuple[tuple[float, float], ...]] = deque(
            maxlen=self.config.history_size
        )
        self._movement_history: deque[float] = deque(
            maxlen=self.config.smoothing_window
        )
        self._stationary_count = 0

    def update(self, landmarks: Any) -> dict[str, bool | float]:
        """Consume one landmark frame and return motion detection and score."""
        points = self._extract_points(landmarks)
        if points is None:
            self.reset()
            return {"motion_detected": False, "movement_score": 0.0}

        if self._landmark_history:
            previous = self._landmark_history[-1]
            frame_motion = sum(
                math.hypot(current[0] - prior[0], current[1] - prior[1])
                for current, prior in zip(points, previous)
            ) / len(points)
            if not math.isfinite(frame_motion):
                self.reset()
                return {"motion_detected": False, "movement_score": 0.0}
            self._movement_history.append(frame_motion)
            smoothed_motion = sum(self._movement_history) / len(self._movement_history)
        else:
            smoothed_motion = 0.0

        self._landmark_history.append(points)
        if smoothed_motion <= self.config.motion_threshold:
            self._stationary_count += 1
        else:
            self._stationary_count = 0

        movement_score = min(1.0, smoothed_motion / self.config.score_saturation)
        motion_detected = (
            smoothed_motion > self.config.motion_threshold
            and self._stationary_count < self.config.stationary_frames
        )
        return {
            "motion_detected": motion_detected,
            "movement_score": round(movement_score, 4),
        }

    def reset(self) -> None:
        """Clear landmark history and stationary/motion smoothing state."""
        self._landmark_history.clear()
        self._movement_history.clear()
        self._stationary_count = 0

    @staticmethod
    def _extract_points(landmarks: Any) -> tuple[tuple[float, float], ...] | None:
        if landmarks is None:
            return None

        sequence = getattr(landmarks, "landmark", landmarks)
        if not isinstance(sequence, Sequence) or isinstance(sequence, (str, bytes)):
            return None
        try:
            if len(sequence) <= max(TRACKED_LANDMARKS):
                return None
            # A nested sequence indicates multiple face landmark sets; without
            # an explicit face selection, treating either as the subject is unsafe.
            if not hasattr(sequence[TRACKED_LANDMARKS[0]], "x"):
                return None
            points = tuple(
                (float(sequence[index].x), float(sequence[index].y))
                for index in TRACKED_LANDMARKS
            )
        except (AttributeError, IndexError, TypeError, ValueError, OverflowError):
            return None

        if not all(math.isfinite(x) and math.isfinite(y) for x, y in points):
            return None
        return points
