from pydantic import BaseModel, Field
from typing import Optional, Any
from enum import Enum


# ── Liveness ──────────────────────────────────────────────────────────────────

class ChallengeType(str, Enum):
    BLINK      = "BLINK"
    OPEN_MOUTH = "OPEN_MOUTH"
    BLINK_TWICE = "BLINK_TWICE"
    COMPLETE   = "COMPLETE"
    FAILED     = "FAILED"


class SessionState(str, Enum):
    CREATED    = "CREATED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETE   = "COMPLETE"
    FAILED     = "FAILED"
    EXPIRED    = "EXPIRED"


CHALLENGE_SEQUENCE = [
    ChallengeType.BLINK,
    ChallengeType.OPEN_MOUTH,
    ChallengeType.BLINK_TWICE,
]

CHALLENGE_INSTRUCTIONS = {
    ChallengeType.BLINK:       "Please blink slowly",
    ChallengeType.OPEN_MOUTH:  "Open your mouth slightly",
    ChallengeType.BLINK_TWICE: "Please blink twice",
    ChallengeType.COMPLETE:   "Verification complete!",
    ChallengeType.FAILED:     "Verification failed. Please try again.",
}


class FaceMetrics(BaseModel):
    face_detected: bool
    blink_detected: bool = False
    blink_count: int = 0
    blink_confidence: float = 0.0
    motion_detected: bool = False
    movement_score: float = 0.0
    yaw_proxy: float = 0.0
    blink_score: float = 0.0
    smile_score: float = 0.0
    mouth_open_score: float = 0.0
    lighting_mean: float = 0.0
    is_low_light: bool = False
    texture_variance: float = 0.0
    landmark_z_std: float = 0.0
    is_spoof: bool = False
    # rPPG fields — populated once enough frames are buffered (~5 seconds)
    rppg_bpm: Optional[float] = None         # estimated heart rate
    rppg_confidence: Optional[float] = None  # 0–1, how dominant the peak is
    rppg_ready: bool = False                 # False until MIN_SAMPLES of data collected
    rppg_is_live: Optional[bool] = None      # True = heartbeat detected
    rppg_sampling: bool = False              # True = this frame was accepted into buffer
    rppg_samples: int = 0                   # how many good samples collected so far
    rppg_verdict: str = "pending"           # "pending" | "real" | "synthetic"
    # Forehead sampling region — for debug visualization
    forehead_rgb: Optional[list[float]] = None       # [r, g, b] 0-255
    forehead_bbox_norm: Optional[list[float]] = None  # [x1, y1, x2, y2] 0-1
    # Raw blendshapes — populated so callers don't need to re-run the detector
    blendshapes: Optional[dict[str, float]] = None


class FrameResponse(BaseModel):
    session_id: str
    challenge: ChallengeType
    challenge_index: int
    challenge_passed: bool
    feedback: str
    metrics: FaceMetrics
    liveness_token: Optional[str] = None


class CreateSessionResponse(BaseModel):
    session_id: str
    expires_at: str
    challenges: list[str]


class SessionStatusResponse(BaseModel):
    session_id: str
    state: SessionState
    challenges_completed: int
    liveness_token: Optional[str] = None
    smile_photo_path: Optional[str] = None


class VerifyTokenRequest(BaseModel):
    liveness_token: str


class VerifyTokenResponse(BaseModel):
    valid: bool
    session_id: Optional[str] = None
    issued_at: Optional[str] = None


# ── Face Recognition ──────────────────────────────────────────────────────────

class RegisterFaceRequest(BaseModel):
    name: str
    image: str              # base64 JPEG
    metadata: dict[str, Any] = {}


class RegisterFaceResponse(BaseModel):
    face_id: str
    name: str
    age: Optional[int] = None
    gender: Optional[str] = None
    detection_score: float = 0.0


class VerifyFaceRequest(BaseModel):
    face_id: str
    image: str              # base64 JPEG


class VerifyFaceResponse(BaseModel):
    face_id: str
    verified: bool
    similarity: float
    threshold: float


class SearchFaceRequest(BaseModel):
    image: str              # base64 JPEG
    top_k: int = 5


class SearchMatch(BaseModel):
    face_id: str
    name: str
    similarity: float
    matched: bool
    metadata: dict[str, Any] = {}


class SearchFaceResponse(BaseModel):
    matches: list[SearchMatch]
    face_detected: bool


class FaceRecordResponse(BaseModel):
    face_id: str
    name: str
    metadata: dict[str, Any] = {}


# ── Face Analysis ─────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    image: str              # base64 JPEG


class LegacyEnrollRequest(BaseModel):
    image: str


class LegacyRecognizeCandidate(BaseModel):
    employee_id: int
    embedding: list[float]


class LegacyRecognizeRequest(BaseModel):
    image: str
    candidates: list[LegacyRecognizeCandidate] = Field(default_factory=list)
    threshold: float = 0.5
    min_margin: float = 0.05
    fast_mode: bool = False
    liveness_session_id: Optional[str] = None


class BackendRecognitionResponse(BaseModel):
    matched: bool
    employee_id: Optional[int] = None
    confidence: float = 0.0
    liveness: bool
    # Kept for compatibility with the existing FaceAttend client contract.
    success: bool = True
    recognized: Optional[bool] = None
    error_code: Optional[str] = None
    message: Optional[str] = None


class RecognitionFeedbackRequest(BaseModel):
    false_positive: bool


class RecognitionMetricsResponse(BaseModel):
    total_requests: int
    matched_requests: int
    failed_requests: int
    failure_rate: float
    average_confidence: float
    failure_reasons: dict[str, int]
    labeled_results: int
    false_positive_reports: int
    false_positive_rate: float


class EmotionScores(BaseModel):
    happy: float = 0.0
    sad: float = 0.0
    angry: float = 0.0
    surprised: float = 0.0
    disgusted: float = 0.0
    neutral: float = 1.0


class AnalyzeResponse(BaseModel):
    face_detected: bool
    age: Optional[int] = None
    gender: Optional[str] = None
    gender_confidence: Optional[float] = None
    emotion: Optional[EmotionScores] = None
    dominant_emotion: Optional[str] = None
    smile_score: Optional[float] = None
    detection_score: Optional[float] = None
    bbox: Optional[list[int]] = None          # [x1, y1, x2, y2]
