from models import ChallengeType, FaceMetrics
from liveness_engine import (
    MOUTH_OPEN_SCORE_THRESHOLD,
)

# Frames that must pass consecutively to complete a challenge (~1.3s at 15fps)
CONSECUTIVE_FRAMES_REQUIRED = 20


def evaluate_challenge(
    challenge: ChallengeType,
    metrics: FaceMetrics,
    consecutive_count: int,
    blink_count_at_challenge_start: int = 0,
) -> tuple[bool, int]:
    """
    Returns (challenge_fully_passed, updated_consecutive_count).
    Resets consecutive count to 0 on any non-passing frame.
    """
    if not metrics.face_detected or metrics.is_spoof or metrics.is_low_light:
        return False, 0

    if challenge == ChallengeType.BLINK:
        return metrics.blink_detected, 1 if metrics.blink_detected else 0

    if challenge == ChallengeType.BLINK_TWICE:
        completed_blinks = max(0, metrics.blink_count - blink_count_at_challenge_start)
        return completed_blinks >= 2, completed_blinks

    frame_passes = _frame_passes_challenge(challenge, metrics)
    new_count = consecutive_count + 1 if frame_passes else 0
    challenge_passed = new_count >= CONSECUTIVE_FRAMES_REQUIRED
    return challenge_passed, new_count


def _frame_passes_challenge(challenge: ChallengeType, metrics: FaceMetrics) -> bool:
    if challenge == ChallengeType.OPEN_MOUTH:
        return metrics.mouth_open_score >= MOUTH_OPEN_SCORE_THRESHOLD

    return False
