import uuid
import hashlib
import time
import numpy as np
from threading import Lock
from datetime import datetime, timezone, timedelta
from models import ChallengeType, SessionState, CHALLENGE_SEQUENCE

SESSION_TTL_SECONDS = 120  # 2 minutes to complete all challenges
MAX_FRAME_HASHES = 20       # Rolling window for replay detection
SPOOF_FRAMES_REQUIRED = 5   # Avoid rejecting a real face on one unstable frame


class Session:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.state = SessionState.IN_PROGRESS
        self.challenge_index = 0
        self.consecutive_count = 0
        self.challenges_completed = 0
        self.liveness_token: str | None = None
        self.employee_id: int | None = None
        self.face_embedding_reference: np.ndarray | None = None
        self.liveness_status = False
        self.liveness_passed_at: datetime | None = None
        self.verification_consumed = False
        self._identity_lock = Lock()
        self.identity_challenge_indices: set[int] = set()
        self.smile_photo_path: str | None = None
        self.blink_count_at_challenge_start: int = 0
        self.awaiting_rppg: bool = False
        self.spoof_consecutive_count = 0
        self.created_at = time.monotonic()
        self.created_at_utc = datetime.now(timezone.utc)
        self.frame_hashes: list[str] = []

    def bind_identity(self, employee_id: int, embedding: np.ndarray) -> None:
        """Bind the short-lived session to an identity and in-memory embedding."""
        vector = np.asarray(embedding, dtype=np.float32).reshape(-1).copy()
        if vector.size == 0 or not np.isfinite(vector).all():
            raise ValueError("A finite face embedding is required")
        self.employee_id = int(employee_id)
        self.face_embedding_reference = vector

    def consume_identity_verification(
        self,
        employee_id: int,
        embedding: np.ndarray,
        min_similarity: float,
    ) -> bool:
        """Match and consume this completed liveness session exactly once."""
        with self._identity_lock:
            return self._consume_identity_verification(employee_id, embedding, min_similarity)

    def confirm_challenge_identity(
        self, challenge_index: int, embedding: np.ndarray, min_similarity: float
    ) -> bool:
        """Confirm that a liveness action was performed by the bound identity."""
        with self._identity_lock:
            if self.employee_id is None or self.face_embedding_reference is None:
                return False
            if self._embedding_similarity(embedding) < min_similarity:
                return False
            self.identity_challenge_indices.add(challenge_index)
            return True

    def has_confirmed_all_challenges(self, challenge_count: int) -> bool:
        return self.identity_challenge_indices.issuperset(range(challenge_count))

    def _consume_identity_verification(
        self, employee_id: int, embedding: np.ndarray, min_similarity: float
    ) -> bool:
        if (
            self.state != SessionState.COMPLETE
            or not self.liveness_status
            or self.verification_consumed
            or self.employee_id != employee_id
            or self.face_embedding_reference is None
        ):
            return False
        similarity = self._embedding_similarity(embedding)
        if not np.isfinite(similarity) or similarity < min_similarity:
            return False
        self.verification_consumed = True
        return True

    def _embedding_similarity(self, embedding: np.ndarray) -> float:
        query = np.asarray(embedding, dtype=np.float32).reshape(-1)
        reference = self.face_embedding_reference
        if reference is None or query.shape != reference.shape or not np.isfinite(query).all():
            return -1.0
        query_norm = float(np.linalg.norm(query))
        reference_norm = float(np.linalg.norm(reference))
        if query_norm <= 0 or reference_norm <= 0:
            return -1.0
        return float(np.dot(query / query_norm, reference / reference_norm))

    @property
    def current_challenge(self) -> ChallengeType:
        if self.challenge_index < len(CHALLENGE_SEQUENCE):
            return CHALLENGE_SEQUENCE[self.challenge_index]
        return ChallengeType.COMPLETE

    @property
    def is_expired(self) -> bool:
        return (time.monotonic() - self.created_at) > SESSION_TTL_SECONDS

    @property
    def expires_at_iso(self) -> str:
        expiry = datetime.now(timezone.utc) + timedelta(seconds=SESSION_TTL_SECONDS)
        return expiry.isoformat()

    def advance_challenge(self, blink_count: int = 0):
        self.challenge_index += 1
        self.challenges_completed += 1
        self.consecutive_count = 0
        self.blink_count_at_challenge_start = max(0, blink_count)

    def is_replay_frame(self, frame_bytes: bytes) -> bool:
        frame_hash = hashlib.sha256(frame_bytes).hexdigest()
        if frame_hash in self.frame_hashes:
            return True
        self.frame_hashes.append(frame_hash)
        if len(self.frame_hashes) > MAX_FRAME_HASHES:
            self.frame_hashes.pop(0)
        return False


class SessionManager:
    def __init__(self):
        self._sessions: dict[str, Session] = {}

    def create_session(self) -> Session:
        session_id = str(uuid.uuid4())
        session = Session(session_id)
        self._sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Session | None:
        session = self._sessions.get(session_id)
        if session and session.is_expired and session.state != SessionState.EXPIRED:
            session.state = SessionState.EXPIRED
        return session

    def delete_session(self, session_id: str) -> bool:
        if session_id in self._sessions:
            del self._sessions[session_id]
            return True
        return False

    def cleanup_expired(self):
        expired = [
            sid for sid, s in self._sessions.items()
            if s.is_expired
        ]
        for sid in expired:
            del self._sessions[sid]


# Singleton
session_manager = SessionManager()
