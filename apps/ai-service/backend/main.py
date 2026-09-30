import os
import json
import base64
import time
import asyncio
import logging
import dataclasses
import numpy as np
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from jose import jwt

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("face_api")

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
DUPLICATE_IDENTITY_THRESHOLD = 0.75


class _LimitBodySize(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and int(cl) > MAX_UPLOAD_BYTES:
            return JSONResponse({"detail": "Request body too large (max 10 MB)."}, status_code=413)
        return await call_next(request)

from models import (
    ChallengeType, SessionState, CHALLENGE_SEQUENCE, CHALLENGE_INSTRUCTIONS,
    FrameResponse, CreateSessionResponse, SessionStatusResponse,
    VerifyTokenRequest, VerifyTokenResponse, FaceMetrics, CreateVerificationSessionRequest,
    RegisterFaceRequest, RegisterFaceResponse,
    VerifyFaceRequest, VerifyFaceResponse,
    SearchFaceRequest, SearchFaceResponse, SearchMatch, FaceRecordResponse,
    AnalyzeRequest, AnalyzeResponse, EmotionScores,
    LegacyEnrollRequest, LegacyRecognizeCandidate, LegacyRecognizeRequest,
    BackendRecognitionResponse, RecognitionFeedbackRequest,
    RecognitionMetricsResponse,
)
from liveness_engine import LivenessEngine
from session_manager import session_manager, SPOOF_FRAMES_REQUIRED
from face_recognition_engine import FaceRecognitionEngine, SIMILARITY_THRESHOLD
from face_db import face_db
from emotion_engine import blendshapes_to_emotions, dominant_emotion
from rppg_engine import RPPGEngine
from photo_validator import PhotoValidator
from recognition_metrics import RecognitionMetrics

# ── JWT config ────────────────────────────────────────────────────────────────
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_SECONDS = 300  # token valid for 5 minutes after issuance
SESSION_IDENTITY_SIMILARITY_THRESHOLD = 0.60

# ── Config ────────────────────────────────────────────────────────────────────
_cors_raw = os.getenv("CORS_ORIGINS", "*")
CORS_ORIGINS = ["*"] if _cors_raw.strip() == "*" else [o.strip() for o in _cors_raw.split(",")]


async def _session_cleanup_loop():
    while True:
        await asyncio.sleep(60)
        session_manager.cleanup_expired()


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_session_cleanup_loop())
    logger.info("Face Biometrics API started")
    yield
    task.cancel()
    engine.close()
    logger.info("Face Biometrics API shut down")


# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="Face Biometrics API", version="2.0.0", lifespan=lifespan)

app.add_middleware(_LimitBodySize)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine          = LivenessEngine()
rec_engine      = FaceRecognitionEngine()
photo_validator = PhotoValidator()
recognition_metrics = RecognitionMetrics()

# Per-session rPPG engines — keyed by session_id, cleaned up on session end
rppg_engines: dict[str, RPPGEngine] = {}

# Per-session last ROI center position (normalized 0-1) — used to detect
# inter-frame head movement and discard motion-corrupted samples.
rppg_last_pos: dict[str, tuple[float, float]] = {}


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "faces_registered": face_db.index.ntotal}


@app.get("/metrics/recognition", response_model=RecognitionMetricsResponse)
def recognition_metrics_snapshot():
    return recognition_metrics.snapshot()


@app.post("/metrics/recognition/feedback")
def record_recognition_feedback(body: RecognitionFeedbackRequest):
    recognition_metrics.record_feedback(false_positive=body.false_positive)
    return recognition_metrics.snapshot()


# ── REST endpoints ────────────────────────────────────────────────────────────

# ── Photo validation endpoint ─────────────────────────────────────────────────
# Accepts two modes:
#   1. multipart/form-data with field "file"  — for file uploads from gallery
#   2. JSON body { "image": "<base64>" }      — for camera frame captures
#
# Returns a full PhotoValidationResult as JSON.  The mobile app (or web onboarding
# form) calls this before accepting a photo submission.

from fastapi import UploadFile, File, Form
from typing import Optional as Opt

@app.post("/api/validate-photo")
async def validate_photo(
    file: Opt[UploadFile] = File(default=None),
    image: Opt[str]       = Form(default=None),
):
    """
    Validate a profile photo for onboarding.

    Accepts either:
      - multipart upload:  field name = "file"
      - JSON/form field:   "image" = base64-encoded image (with or without
                            the data:image/jpeg;base64, prefix)

    Returns JSON with:
      valid, rejection_reason, face_detected, face_count, single_face,
      face_large_enough, face_centered, no_occlusion, not_ai_generated,
      bbox, bbox_norm, age, gender, detection_score,
      ai_probability, ai_signals
    """
    image_bytes: bytes | None = None

    if file is not None:
        image_bytes = await file.read()
    elif image is not None:
        # Strip data-URI prefix if present
        b64 = image.split(",", 1)[-1] if "," in image else image
        try:
            image_bytes = base64.b64decode(b64)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid base64 image data.")
    else:
        raise HTTPException(
            status_code=422,
            detail="Provide either a 'file' upload or a base64 'image' field.",
        )

    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image data.")

    result = photo_validator.validate(image_bytes)
    return dataclasses.asdict(result)


@app.post("/session/create", response_model=CreateSessionResponse)
def create_session(body: CreateVerificationSessionRequest | None = Body(default=None)):
    employee_id = None
    embedding = None
    if body is not None:
        try:
            image_bytes = base64.b64decode(body.image, validate=True)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid base64 image") from exc
        result = rec_engine.analyze(image_bytes)
        if not result.image_valid or not result.face_detected or result.embedding is None:
            raise HTTPException(status_code=422, detail="A valid face is required to start verification")
        if result.face_count > 1:
            raise HTTPException(status_code=422, detail="Multiple faces detected")
        ranked = _find_best_candidate(
            np.asarray(result.embedding, dtype=np.float32), body.candidates
        )
        employee_id, similarity = ranked[0] if ranked else (None, -1.0)
        if employee_id is None or similarity < body.threshold:
            raise HTTPException(status_code=422, detail="Face was not recognized")
        if _is_ambiguous_match(ranked, body.min_margin):
            raise HTTPException(status_code=422, detail="Face match is ambiguous")
        embedding = result.embedding

    session = session_manager.create_session()
    if employee_id is not None and embedding is not None:
        session.bind_identity(employee_id, embedding)
    return CreateSessionResponse(
        session_id=session.session_id,
        expires_at=session.expires_at_iso,
        challenges=[c.value for c in CHALLENGE_SEQUENCE],
        employee_id=employee_id,
    )


@app.get("/session/{session_id}/status", response_model=SessionStatusResponse)
def get_session_status(session_id: str):
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionStatusResponse(
        session_id=session.session_id,
        state=session.state,
        challenges_completed=session.challenges_completed,
        liveness_token=session.liveness_token,
        smile_photo_path=session.smile_photo_path,
    )


@app.post("/session/{session_id}/verify", response_model=VerifyTokenResponse)
def verify_token(session_id: str, body: VerifyTokenRequest):
    try:
        payload = jwt.decode(body.liveness_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        session = session_manager.get_session(session_id)
        if (payload.get("sub") != session_id or session is None
                or session.state != SessionState.COMPLETE or not session.liveness_status):
            return VerifyTokenResponse(valid=False)
        return VerifyTokenResponse(
            valid=True,
            session_id=payload.get("sub"),
            issued_at=payload.get("iat"),
        )
    except Exception:
        return VerifyTokenResponse(valid=False)


@app.delete("/session/{session_id}")
def delete_session(session_id: str):
    deleted = session_manager.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": True}


# ── WebSocket endpoint ─────────────────────────────────────────────────────────

@app.websocket("/ws/liveness/{session_id}")
async def liveness_websocket(websocket: WebSocket, session_id: str):
    await websocket.accept()

    session = session_manager.get_session(session_id)
    if not session:
        await websocket.send_text(json.dumps({"error": "Session not found"}))
        await websocket.close(code=4004)
        return

    try:
        while True:
            # Receive frame (binary JPEG or base64-encoded text)
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            if message.get("bytes"):
                frame_bytes = message["bytes"]
            elif message.get("text"):
                frame_bytes = base64.b64decode(message["text"])
            else:
                continue

            # Re-fetch session each iteration to catch expiry
            session = session_manager.get_session(session_id)
            if not session:
                break

            if session.state == SessionState.EXPIRED:
                await _send_response(websocket, session_id, ChallengeType.FAILED,
                                     0, False, "Session expired. Please start over.",
                                     FaceMetrics(face_detected=False))
                break

            if session.state == SessionState.COMPLETE:
                await _send_response(websocket, session_id, ChallengeType.COMPLETE,
                                     len(CHALLENGE_SEQUENCE), True,
                                     CHALLENGE_INSTRUCTIONS[ChallengeType.COMPLETE],
                                     FaceMetrics(face_detected=True),
                                     liveness_token=session.liveness_token,
                                     liveness_result=engine.get_session_result(session_id))
                continue

            if session.state == SessionState.FAILED:
                await _send_response(websocket, session_id, ChallengeType.FAILED,
                                     session.challenges_completed, False,
                                     CHALLENGE_INSTRUCTIONS[ChallengeType.FAILED],
                                     FaceMetrics(face_detected=False))
                break

            # Process frame with MediaPipe
            metrics = engine.process_frame(frame_bytes, session_id=session_id)

            # Feed rPPG engine.
            # We only accept a sample when the face is:
            #   1. Detected and not a spoof
            #   2. Roughly forward-facing (|yaw| < 0.15)
            #      Head turns cause motion blur and ROI drift → huge artifacts.
            #      This is the #1 source of garbage BPM readings.
            rppg = rppg_engines.setdefault(session_id, RPPGEngine())
            face_stable = (
                metrics.face_detected
                and not metrics.is_spoof
                and abs(metrics.yaw_proxy) < 0.15
                and metrics.forehead_rgb is not None
                and metrics.forehead_bbox_norm is not None
            )

            # Position drift gate: if the forehead ROI center moved more than
            # 2% of frame dimensions between consecutive frames, it's motion —
            # reject the sample. This eliminates nodding / vertical movement
            # artifacts that the yaw filter doesn't catch.
            if face_stable:
                bbox = metrics.forehead_bbox_norm
                cx = (bbox[0] + bbox[2]) / 2.0
                cy = (bbox[1] + bbox[3]) / 2.0
                last_pos = rppg_last_pos.get(session_id)
                if last_pos is not None:
                    drift = ((cx - last_pos[0]) ** 2 + (cy - last_pos[1]) ** 2) ** 0.5
                    if drift > 0.02:
                        face_stable = False
                if face_stable:
                    rppg_last_pos[session_id] = (cx, cy)

            if face_stable:
                rppg.add_sample(*metrics.forehead_rgb)

            metrics.rppg_sampling = face_stable
            metrics.rppg_samples  = rppg.n_samples

            # Attach rPPG result once buffer is ready
            if rppg.ready:
                bpm, conf = rppg.compute_bpm()
                is_live_result = rppg.is_live()
                metrics.rppg_bpm        = bpm
                metrics.rppg_confidence = conf
                metrics.rppg_ready      = True
                metrics.rppg_is_live    = is_live_result
                metrics.rppg_verdict    = (
                    "real"      if is_live_result is True  else
                    "synthetic" if is_live_result is False else
                    "pending"
                )

            current_challenge = session.current_challenge

            if session.consecutive_count % 15 == 0:
                logger.debug("challenge=%s blink=%s blink_count=%d mouth=%.3f consec=%d",
                             current_challenge.value, metrics.blink_detected,
                             metrics.blink_count, metrics.mouth_open_score,
                             session.consecutive_count)

            # No face — don't terminate, just guide the user back into frame
            if not metrics.face_detected:
                await _send_response(websocket, session_id, current_challenge,
                                     session.challenge_index, False,
                                     "No face detected — move into the frame",
                                     metrics)
                continue

            if metrics.is_spoof:
                session.spoof_consecutive_count += 1
            else:
                session.spoof_consecutive_count = 0

            if session.spoof_consecutive_count >= SPOOF_FRAMES_REQUIRED:
                session.state = SessionState.FAILED
                await _send_response(websocket, session_id, ChallengeType.FAILED,
                                     session.challenges_completed, False,
                                     "Spoof attempt detected. Session terminated.",
                                     metrics)
                break

            # Evaluate current challenge
            liveness_result = engine.evaluate_challenge(
                session_id,
                current_challenge,
                metrics,
                session.consecutive_count,
                session.blink_count_at_challenge_start,
                is_final_challenge=session.challenge_index == len(CHALLENGE_SEQUENCE) - 1,
            )
            challenge_passed = liveness_result["challenge_passed"]
            new_count = liveness_result["consecutive_count"]
            session.consecutive_count = new_count

            # Bind every completed action (and both mouth-hold endpoints) to
            # the identity captured when this verification session was created.
            identity_sample_required = (
                (current_challenge in (ChallengeType.BLINK, ChallengeType.BLINK_TWICE)
                 and metrics.blink_detected)
                or (current_challenge == ChallengeType.OPEN_MOUTH
                    and (new_count == 1 or challenge_passed))
            )
            if identity_sample_required:
                try:
                    identity_frame = rec_engine.analyze(frame_bytes)
                    identity_matches = bool(
                        identity_frame.face_detected
                        and identity_frame.face_count == 1
                        and identity_frame.embedding is not None
                        and session.confirm_challenge_identity(
                            session.challenge_index,
                            identity_frame.embedding,
                            SESSION_IDENTITY_SIMILARITY_THRESHOLD,
                        )
                    )
                except Exception:
                    logger.exception("Liveness frame identity verification failed")
                    identity_matches = False
                if not identity_matches:
                    session.state = SessionState.FAILED
                    await _send_response(
                        websocket, session_id, ChallengeType.FAILED,
                        session.challenges_completed, False,
                        "The face changed during liveness verification. Please restart.",
                        metrics, liveness_result=liveness_result,
                    )
                    break

            if challenge_passed:
                session.advance_challenge(metrics.blink_count)

                if session.challenge_index >= len(CHALLENGE_SEQUENCE):
                    if (not liveness_result["is_live"]
                            or not session.has_confirmed_all_challenges(len(CHALLENGE_SEQUENCE))):
                        session.state = SessionState.FAILED
                        await _send_response(
                            websocket, session_id, ChallengeType.FAILED,
                            session.challenges_completed, False,
                            "Liveness score did not meet the required threshold.",
                            metrics, liveness_result=liveness_result,
                        )
                        break
                    session.state = SessionState.COMPLETE
                    session.liveness_status = True
                    session.liveness_passed_at = datetime.now(timezone.utc)
                    token = _issue_liveness_token(session_id)
                    session.liveness_token = token
                    await _send_response(
                        websocket, session_id, ChallengeType.COMPLETE,
                        session.challenges_completed, True,
                        CHALLENGE_INSTRUCTIONS[ChallengeType.COMPLETE],
                        metrics, liveness_token=token,
                        liveness_result=liveness_result,
                    )
                else:
                    next_challenge = session.current_challenge
                    await _send_response(
                        websocket, session_id, next_challenge,
                        session.challenge_index, False,
                        CHALLENGE_INSTRUCTIONS[next_challenge],
                        metrics, liveness_result=liveness_result,
                    )
            else:
                feedback = _progress_feedback(current_challenge, metrics, new_count)
                await _send_response(
                    websocket, session_id, current_challenge,
                    session.challenge_index, False, feedback, metrics,
                    liveness_result=liveness_result,
                )

    except WebSocketDisconnect:
        pass
    except Exception as e:
        import traceback
        print(f"[WS ERROR] {e}")
        traceback.print_exc()
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass
    finally:
        rppg_engines.pop(session_id, None)
        rppg_last_pos.pop(session_id, None)
        engine.reset_session(session_id)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _send_response(
    websocket: WebSocket,
    session_id: str,
    challenge: ChallengeType,
    challenge_index: int,
    challenge_passed: bool,
    feedback: str,
    metrics: FaceMetrics,
    liveness_token: str | None = None,
    liveness_result: dict | None = None,
):
    response = FrameResponse(
        session_id=session_id,
        challenge=challenge,
        challenge_index=challenge_index,
        challenge_passed=challenge_passed,
        feedback=feedback,
        metrics=metrics,
        liveness_token=liveness_token,
        is_live=bool(liveness_result and liveness_result.get("is_live", False)),
        liveness_score=float(liveness_result.get("liveness_score", 0.0))
        if liveness_result else 0.0,
    )
    await websocket.send_text(response.model_dump_json())


def _issue_liveness_token(session_id: str) -> str:
    now = int(time.time())
    payload = {
        "sub": session_id,
        "iat": now,
        "exp": now + JWT_EXPIRY_SECONDS,
        "type": "liveness",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _progress_feedback(challenge: ChallengeType, metrics: FaceMetrics, consecutive: int) -> str:
    base = CHALLENGE_INSTRUCTIONS[challenge]
    if not metrics.face_detected:
        return "No face detected. Please look at the camera."
    if consecutive > 0:
        return f"{base} (hold it...)"
    return base


# ── Face Recognition routes ───────────────────────────────────────────────────

@app.post("/face/register", response_model=RegisterFaceResponse)
def register_face(body: RegisterFaceRequest):
    """Register a face. Returns a face_id for future 1:1 verification."""
    try:
        img_bytes = base64.b64decode(body.image)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image")

    result = rec_engine.analyze(img_bytes)
    if not result.face_detected:
        raise HTTPException(status_code=422, detail="No face detected in the image")

    record = face_db.register(
        name=body.name,
        embedding=result.embedding,
        metadata=body.metadata,
    )
    return RegisterFaceResponse(
        face_id=record.face_id,
        name=record.name,
        age=result.age,
        gender=result.gender,
        detection_score=result.detection_score,
    )


@app.post("/face/verify", response_model=VerifyFaceResponse)
def verify_face(body: VerifyFaceRequest):
    """1:1 — verify a live face against a registered face_id."""
    record = face_db.get(body.face_id)
    if not record:
        raise HTTPException(status_code=404, detail="face_id not found")

    try:
        img_bytes = base64.b64decode(body.image)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image")

    result = rec_engine.analyze(img_bytes)
    if not result.face_detected:
        raise HTTPException(status_code=422, detail="No face detected in the image")

    verified, similarity = face_db.verify(body.face_id, result.embedding)
    return VerifyFaceResponse(
        face_id=body.face_id,
        verified=verified,
        similarity=similarity,
        threshold=SIMILARITY_THRESHOLD,
    )


@app.post("/face/search", response_model=SearchFaceResponse)
def search_face(body: SearchFaceRequest):
    """1:N — find the closest matching faces in the database."""
    try:
        img_bytes = base64.b64decode(body.image)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image")

    result = rec_engine.analyze(img_bytes)
    if not result.face_detected:
        return SearchFaceResponse(matches=[], face_detected=False)

    matches = face_db.search(result.embedding, top_k=body.top_k)
    return SearchFaceResponse(
        matches=[SearchMatch(**m) for m in matches],
        face_detected=True,
    )


@app.get("/face/list", response_model=list[FaceRecordResponse])
def list_faces():
    """List all registered faces."""
    return [
        FaceRecordResponse(face_id=r.face_id, name=r.name, metadata=r.metadata)
        for r in face_db.list_all()
    ]


@app.delete("/face/{face_id}")
def delete_face(face_id: str):
    if not face_db.delete(face_id):
        raise HTTPException(status_code=404, detail="face_id not found")
    return {"deleted": True}


# ── Face Analysis route ───────────────────────────────────────────────────────

@app.post("/face/enroll")
def legacy_enroll(body: LegacyEnrollRequest):
    """Compatibility route for the existing FaceAttend frontend."""
    try:
        img_bytes = base64.b64decode(body.image)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image")

    result = rec_engine.analyze(img_bytes)
    if not result.face_detected or result.embedding is None:
        return {"success": False, "error_code": "NO_FACE", "message": "No face detected"}
    return {
        "success": True,
        "embedding": result.embedding.astype(float).tolist(),
        "bbox": result.bbox,
        "detection_confidence": result.detection_score,
    }


def _decode_image_payload(image: str) -> bytes:
    encoded = image.split(",", 1)[-1] if "," in image else image
    return base64.b64decode(encoded, validate=True)


def _recognition_error(status_code: int, error_code: str, message: str, liveness: bool = False):
    recognition_metrics.record_result(matched=False, error_code=error_code)
    return JSONResponse(
        status_code=status_code,
        content=BackendRecognitionResponse(
            matched=False,
            confidence=0.0,
            liveness=liveness,
            success=False,
            recognized=False,
            error_code=error_code,
            message=message,
        ).model_dump(),
    )


def _has_completed_liveness(session_id: str | None) -> bool:
    if not session_id:
        return False
    session = session_manager.get_session(session_id)
    return bool(
        session
        and session.state == SessionState.COMPLETE
        and session.liveness_token
        and session.liveness_status
        and session.employee_id is not None
        and session.face_embedding_reference is not None
        and not session.verification_consumed
    )


def _verify_session_identity(
    session_id: str | None,
    employee_id: int | None,
    embedding: np.ndarray,
) -> bool:
    if not session_id or employee_id is None or not _has_completed_liveness(session_id):
        return False
    session = session_manager.get_session(session_id)
    return bool(session and session.consume_identity_verification(
        employee_id, embedding, SESSION_IDENTITY_SIMILARITY_THRESHOLD
    ))


def _find_best_candidate(
    query: np.ndarray,
    candidates: list[LegacyRecognizeCandidate],
) -> list[tuple[int, float]]:
    query_norm = np.linalg.norm(query)
    if query_norm == 0:
        return []

    best_by_employee: dict[int, float] = {}
    normalized_query = query / query_norm
    for candidate in candidates:
        embedding = np.asarray(candidate.embedding, dtype=np.float32)
        if embedding.shape != query.shape:
            continue
        norm = np.linalg.norm(embedding)
        if norm == 0:
            continue
        similarity = float(np.dot(normalized_query, embedding / norm))
        best_by_employee[candidate.employee_id] = max(
            best_by_employee.get(candidate.employee_id, -1.0),
            similarity,
        )

    return sorted(best_by_employee.items(), key=lambda item: item[1], reverse=True)


def _is_ambiguous_match(
    ranked_matches: list[tuple[int, float]],
    min_margin: float,
) -> bool:
    if len(ranked_matches) < 2:
        return False
    best_similarity = ranked_matches[0][1]
    second_similarity = ranked_matches[1][1]
    return (
        best_similarity - second_similarity < min_margin
        or second_similarity >= DUPLICATE_IDENTITY_THRESHOLD
    )


@app.post("/face/recognize", response_model=BackendRecognitionResponse)
def legacy_recognize(body: LegacyRecognizeRequest):
    """Recognize one face against Backend-provided employee embeddings.

    The Backend owns employee identity data and supplies the candidate gallery.
    A completed liveness session is required, but its JWT is never parsed here.
    """
    if body.fast_mode or not body.liveness_session_id:
        return _recognition_error(
            422,
            "LIVENESS_FAILED",
            "A bound liveness verification session is required",
        )

    try:
        img_bytes = _decode_image_payload(body.image)
    except Exception:
        return _recognition_error(400, "INVALID_IMAGE", "Invalid base64 image")

    try:
        result = rec_engine.analyze(img_bytes)
    except Exception:
        logger.exception("Face recognition inference failed")
        return _recognition_error(500, "INFERENCE_ERROR", "Face recognition inference failed", True)

    if not result.image_valid:
        return _recognition_error(400, "INVALID_IMAGE", "Image data could not be decoded", True)
    if not result.face_detected or result.embedding is None:
        return _recognition_error(422, "NO_FACE", "No face detected", True)
    if result.face_count > 1:
        return _recognition_error(422, "MULTIPLE_FACES", "Multiple faces detected", True)

    query = np.asarray(result.embedding, dtype=np.float32)
    ranked_matches = _find_best_candidate(query, body.candidates)
    best_id, best_similarity = ranked_matches[0] if ranked_matches else (None, -1.0)

    if best_id is not None and best_similarity >= body.threshold:
        if _is_ambiguous_match(ranked_matches, body.min_margin):
            return _recognition_error(
                422,
                "AMBIGUOUS_MATCH",
                "Multiple employees have similarly matching faces",
                True,
            )
        if not _verify_session_identity(body.liveness_session_id, best_id, query):
            return _recognition_error(
                422,
                "SESSION_IDENTITY_MISMATCH",
                "The face does not match the identity bound to the liveness session",
            )
        response = BackendRecognitionResponse(
            matched=True,
            employee_id=best_id,
            confidence=round(best_similarity, 4),
            liveness=True,
            success=True,
            recognized=True,
        )
        recognition_metrics.record_result(
            matched=True,
            confidence=response.confidence,
        )
        return response
    recognition_metrics.record_result(
        matched=False,
        confidence=max(best_similarity, 0.0),
        error_code="FACE_NOT_RECOGNIZED",
    )
    return BackendRecognitionResponse(
        matched=False,
        confidence=round(max(best_similarity, 0.0), 4),
        liveness=True,
        success=False,
        recognized=False,
        error_code="FACE_NOT_RECOGNIZED",
        message="No matching employee",
    )

@app.post("/face/analyze", response_model=AnalyzeResponse)
def analyze_face(body: AnalyzeRequest):
    """
    Single-shot face analysis: age, gender, emotion, smile score.
    Combines InsightFace (age/gender) + MediaPipe blendshapes (emotion/smile).
    """
    try:
        img_bytes = base64.b64decode(body.image)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image")

    # InsightFace for age + gender
    rec_result = rec_engine.analyze(img_bytes)
    if not rec_result.face_detected:
        return AnalyzeResponse(face_detected=False)

    # MediaPipe for emotion + smile — blendshapes are already in the metrics,
    # no need to run the detector a second time.
    liveness_metrics = engine.process_frame(img_bytes)

    emotions: dict | None = None
    dom_emotion: str | None = None
    smile: float | None = None

    if liveness_metrics.face_detected and liveness_metrics.blendshapes:
        emotions = blendshapes_to_emotions(liveness_metrics.blendshapes)
        dom_emotion = dominant_emotion(emotions)
        smile = liveness_metrics.smile_score

    return AnalyzeResponse(
        face_detected=True,
        age=rec_result.age,
        gender=rec_result.gender,
        gender_confidence=rec_result.detection_score,
        emotion=EmotionScores(**emotions) if emotions else None,
        dominant_emotion=dom_emotion,
        smile_score=smile,
        detection_score=rec_result.detection_score,
        bbox=rec_result.bbox,
    )
