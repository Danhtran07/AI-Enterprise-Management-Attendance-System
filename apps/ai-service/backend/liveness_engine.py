import numpy as np
from collections.abc import Mapping
from typing import Any, Protocol, TYPE_CHECKING
from pathlib import Path

if TYPE_CHECKING:
    from models import FaceMetrics
    from blink_detector import BlinkDetector
    from liveness.motion_detector import MotionDetector

# MediaPipe landmark indices
NOSE_TIP = 1
LEFT_EYE_OUTER = 33
RIGHT_EYE_OUTER = 263
LEFT_EYE_LANDMARKS = (33, 160, 158, 133, 153, 144)
RIGHT_EYE_LANDMARKS = (362, 385, 387, 263, 373, 380)

MOUTH_OPEN_SCORE_THRESHOLD = 0.25

UPPER_INNER_LIP = 13
LOWER_INNER_LIP = 14
LEFT_MOUTH_CORNER = 78
RIGHT_MOUTH_CORNER = 308

SPOOF_TEXTURE_MIN = 50.0
SPOOF_Z_STD_MIN   = 0.008
LOW_LIGHT_MEAN    = 25.0

MODEL_PATH = Path(__file__).parent / "face_landmarker.task"
LIVE_THRESHOLD = 0.85


class ChallengeManagerProtocol(Protocol):
    """Small interface allowing the challenge policy to be injected."""

    @property
    def current_challenge(self) -> str: ...

    @property
    def complete(self) -> bool: ...

    def observe(self, challenge: str, *, blink: bool, blink_count: int,
                mouth_open: bool) -> bool: ...

    def record_score(self, score: float) -> None: ...

    @property
    def checks(self) -> dict[str, bool]: ...

    @property
    def completed_scores(self) -> list[float]: ...


class ChallengeManager:
    """In-memory challenge sequence: blink, mouth open, then two blinks."""

    SEQUENCE = ("BLINK", "OPEN_MOUTH", "BLINK_TWICE")

    def __init__(self) -> None:
        self._index = 0
        self._blink_total = 0
        self._checks = {"blink": False, "mouth": False}
        self._scores: list[float] = []

    @property
    def current_challenge(self) -> str:
        return self.SEQUENCE[self._index] if not self.complete else "PASSED"

    @property
    def complete(self) -> bool:
        return self._index >= len(self.SEQUENCE)

    @property
    def checks(self) -> dict[str, bool]:
        return dict(self._checks)

    @property
    def completed_scores(self) -> list[float]:
        return list(self._scores)

    def observe(self, challenge: str, *, blink: bool, blink_count: int,
                mouth_open: bool) -> bool:
        """Record one detector update; return whether the active step passed."""
        if self.complete or challenge != self.current_challenge:
            return False

        if challenge in ("BLINK", "BLINK_TWICE"):
            self._blink_total += max(1 if blink else 0, blink_count)
            passed = self._blink_total >= (2 if challenge == "BLINK_TWICE" else 1)
            if passed:
                self._checks["blink"] = True
        else:
            passed = mouth_open
            if passed:
                self._checks["mouth"] = True

        if passed:
            self._index += 1
            self._blink_total = 0
        return passed

    def record_score(self, score: float) -> None:
        self._scores.append(score)


class LivenessEngine:
    def __init__(self, challenge_manager: ChallengeManagerProtocol | None = None,
                 face_landmarker: Any | None = None):
        # Both dependencies can be supplied in tests or by an application
        # composition root; defaults preserve the existing FastAPI behavior.
        self.challenge_manager = challenge_manager or ChallengeManager()
        self._last_blink_count = 0
        if face_landmarker is None:
            import mediapipe as mp
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision as mp_vision

            base_options = mp_python.BaseOptions(model_asset_path=str(MODEL_PATH))
            options = mp_vision.FaceLandmarkerOptions(
                base_options=base_options,
                output_face_blendshapes=True,
                num_faces=2,
                min_face_detection_confidence=0.5,
                min_face_presence_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            face_landmarker = mp_vision.FaceLandmarker.create_from_options(options)
        self.detector = face_landmarker

    def process(self, blink_result: Any, mouth_result: Any,
                motion_result: Any | None = None) -> dict[str, Any]:
        """Aggregate detector outputs and advance the injected challenge policy.

        Results may be mappings or detector result objects. Blink detectors
        exposing a cumulative ``count``/``blink_count`` should set ``blink``
        for the current frame as well; only newly reported count is consumed.
        The legacy ``process_frame`` path remains available to the current API.
        """
        manager = self.challenge_manager
        challenge = manager.current_challenge
        blink_detected = bool(self._value(blink_result, "blink", False))
        blink_count = self._bounded_int(self._value(
            blink_result, "blink_count", self._value(blink_result, "count", 0)
        ))
        blink_confidence = self._bounded_float(self._value(
            blink_result, "blink_confidence", self._value(blink_result, "confidence", 0.0)
        ))
        mouth_open = bool(self._value(mouth_result, "mouth_open", False))
        mouth_confidence = self._bounded_float(self._value(mouth_result, "confidence", 0.0))
        motion_raw = self._value(motion_result, "movement_score", None)
        if motion_raw is None:
            motion_raw = self._value(blink_result, "motion_score", 1.0 if blink_detected else 0.0)
        motion_score = self._bounded_float(motion_raw)
        if motion_result is not None and not bool(
            self._value(motion_result, "motion_detected", False)
        ):
            motion_score = 0.0

        challenge_passed = False
        if not manager.complete:
            # A detector's cumulative count is useful for the two-blink step.
            # It is capped per update so malformed detector data cannot skip
            # arbitrarily far through a challenge.
            new_blink_count = max(0, blink_count - self._last_blink_count)
            self._last_blink_count = max(self._last_blink_count, blink_count)
            challenge_passed = manager.observe(
                challenge,
                blink=blink_detected,
                blink_count=min(new_blink_count, 2),
                mouth_open=mouth_open,
            )

        if challenge in ("BLINK", "BLINK_TWICE"):
            score = 0.8 * blink_confidence + 0.2 * motion_score
        elif challenge == "OPEN_MOUTH":
            score = 0.8 * mouth_confidence
        else:
            score = 1.0 if manager.complete else 0.0
        score = round(self._bounded_float(score), 4)

        if challenge_passed:
            manager.record_score(score)
        if manager.complete and hasattr(manager, "completed_scores"):
            prior_scores = manager.completed_scores
            # The terminal frame is the final challenge's score; the score list
            # also contains the earlier completed challenge scores.
            score = round(sum(prior_scores) / len(prior_scores), 4) if prior_scores else score

        checks = manager.checks
        return {
            "live": bool(manager.complete and score >= LIVE_THRESHOLD),
            "score": score,
            "challenge": challenge,
            "checks": checks,
        }

    @staticmethod
    def _value(result: Any, key: str, default: Any) -> Any:
        if isinstance(result, Mapping):
            return result.get(key, default)
        return getattr(result, key, default) if result is not None else default

    @staticmethod
    def _bounded_float(value: Any) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return 0.0
        if not np.isfinite(number):
            return 0.0
        return float(np.clip(number, 0.0, 1.0))

    @staticmethod
    def _bounded_int(value: Any) -> int:
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return 0

    def process_frame(self, jpeg_bytes: bytes,
                      motion_detector: "MotionDetector | None" = None,
                      blink_detector: "BlinkDetector | None" = None) -> "FaceMetrics":
        """
        Process one JPEG frame. Returns a fully populated FaceMetrics including
        forehead_rgb and forehead_bbox_norm when a face is detected.
        """
        import cv2
        import mediapipe as mp
        from models import FaceMetrics

        nparr = np.frombuffer(jpeg_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            if motion_detector is not None:
                motion_detector.update(None)
            if blink_detector is not None:
                blink_detector.update(None)
            return FaceMetrics(face_detected=False)

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self.detector.detect(mp_image)

        if not result.face_landmarks:
            if motion_detector is not None:
                motion_detector.update(None)
            if blink_detector is not None:
                blink_detector.update(None)
            return FaceMetrics(face_detected=False)

        if len(result.face_landmarks) > 1:
            if motion_detector is not None:
                motion_detector.update(None)
            if blink_detector is not None:
                blink_detector.update(None)
            return FaceMetrics(face_detected=False)

        landmarks = result.face_landmarks[0]
        h, w = frame.shape[:2]
        motion = motion_detector.update(landmarks) if motion_detector is not None else None
        blink = (
            blink_detector.update(landmarks, image_size=(w, h))
            if blink_detector is not None else None
        )

        yaw_proxy   = self._compute_yaw_proxy(landmarks)
        blink_score = self._compute_blink_score(result, landmarks)
        smile_score = self._compute_smile_score(result)
        mouth_open_score = self._compute_mouth_open_score(result, landmarks)
        lighting_mean = self._compute_lighting_mean(frame, landmarks, w, h)
        texture_var, z_std, is_spoof = self._check_spoof(frame, landmarks, w, h)
        forehead    = self.extract_forehead_rgb(frame, landmarks, w, h)

        bs = self.extract_blendshapes(result)
        metrics = FaceMetrics(
            face_detected=True,
            blink_detected=bool(blink and blink.blink),
            blink_count=int(blink.count) if blink else 0,
            blink_confidence=float(blink.blink_confidence) if blink and blink.blink else 0.0,
            motion_detected=bool(motion and motion["motion_detected"]),
            movement_score=float(motion["movement_score"]) if motion else 0.0,
            yaw_proxy=round(yaw_proxy, 4),
            blink_score=round(blink_score, 4),
            smile_score=round(smile_score, 4),
            mouth_open_score=round(mouth_open_score, 4),
            lighting_mean=round(lighting_mean, 2),
            is_low_light=lighting_mean < LOW_LIGHT_MEAN,
            texture_variance=round(texture_var, 2),
            landmark_z_std=round(z_std, 6),
            is_spoof=is_spoof,
            blendshapes=bs if bs else None,
        )

        if forehead is not None:
            r, g, b, x1n, y1n, x2n, y2n = forehead
            metrics.forehead_rgb      = [round(r, 1), round(g, 1), round(b, 1)]
            metrics.forehead_bbox_norm = [round(x1n, 4), round(y1n, 4),
                                           round(x2n, 4), round(y2n, 4)]

        return metrics

    def _compute_yaw_proxy(self, landmarks) -> float:
        """
        Symmetric ratio of nose-to-eye distances, retained only as an rPPG
        frame-stability signal. It is not used to select or pass challenges.
        """
        nose      = landmarks[NOSE_TIP]
        left_eye  = landmarks[LEFT_EYE_OUTER]
        right_eye = landmarks[RIGHT_EYE_OUTER]

        eps = 1e-6
        dist_to_left  = nose.x - left_eye.x    # positive when nose is right of left eye
        dist_to_right = right_eye.x - nose.x   # positive when nose is left of right eye

        yaw_proxy = (dist_to_left - dist_to_right) / (dist_to_left + dist_to_right + eps)
        return float(np.clip(yaw_proxy, -1.0, 1.0))

    def extract_blendshapes(self, result) -> dict[str, float]:
        """Returns all 52 blendshape scores as a dict."""
        if not result.face_blendshapes:
            return {}
        return {bs.category_name: bs.score for bs in result.face_blendshapes[0]}

    def _compute_smile_score(self, result) -> float:
        """
        Average of mouthSmileLeft and mouthSmileRight blendshape scores.
        Range 0–1; 0 = neutral, 1 = full smile.
        """
        bs = self.extract_blendshapes(result)
        left  = bs.get("mouthSmileLeft",  0.0)
        right = bs.get("mouthSmileRight", 0.0)
        return float((left + right) / 2)

    def _compute_mouth_open_score(self, result, landmarks) -> float:
        """Combine jaw-open blendshape and normalized inner-lip distance."""
        bs = self.extract_blendshapes(result)
        blendshape_score = bs.get("jawOpen", 0.0)
        mouth_width = np.hypot(
            landmarks[LEFT_MOUTH_CORNER].x - landmarks[RIGHT_MOUTH_CORNER].x,
            landmarks[LEFT_MOUTH_CORNER].y - landmarks[RIGHT_MOUTH_CORNER].y,
        )
        if mouth_width <= 1e-6:
            return float(blendshape_score)
        mouth_height = np.hypot(
            landmarks[UPPER_INNER_LIP].x - landmarks[LOWER_INNER_LIP].x,
            landmarks[UPPER_INNER_LIP].y - landmarks[LOWER_INNER_LIP].y,
        )
        geometric_score = float(np.clip((mouth_height / mouth_width - 0.05) / 0.15, 0.0, 1.0))
        return float(max(blendshape_score, geometric_score))

    def _compute_blink_score(self, result, landmarks) -> float:
        """Combine MediaPipe eye closure scores with geometric eye openness."""
        bs = self.extract_blendshapes(result)
        left = bs.get("eyeBlinkLeft", 0.0)
        right = bs.get("eyeBlinkRight", 0.0)
        blendshape_score = (left + right) / 2

        left_ear = self._eye_aspect_ratio(landmarks, LEFT_EYE_LANDMARKS)
        right_ear = self._eye_aspect_ratio(landmarks, RIGHT_EYE_LANDMARKS)
        ear = (left_ear + right_ear) / 2
        geometric_score = float(np.clip((0.23 - ear) / 0.18, 0.0, 1.0))
        return float(max(blendshape_score, geometric_score))

    @staticmethod
    def _eye_aspect_ratio(landmarks, indices: tuple[int, ...]) -> float:
        outer, upper_a, upper_b, inner, lower_a, lower_b = (
            landmarks[index] for index in indices
        )
        horizontal = np.hypot(outer.x - inner.x, outer.y - inner.y)
        if horizontal <= 1e-6:
            return 1.0
        vertical = (
            np.hypot(upper_a.x - lower_b.x, upper_a.y - lower_b.y)
            + np.hypot(upper_b.x - lower_a.x, upper_b.y - lower_a.y)
        )
        return float(vertical / (2 * horizontal))

    def _compute_lighting_mean(self, frame, landmarks, w: int, h: int) -> float:
        xs = [lm.x for lm in landmarks]
        ys = [lm.y for lm in landmarks]
        x1 = max(0, int(min(xs) * w))
        y1 = max(0, int(min(ys) * h))
        x2 = min(w, int(max(xs) * w))
        y2 = min(h, int(max(ys) * h))
        face_crop = frame[y1:y2, x1:x2]
        if face_crop.size == 0:
            return 0.0
        return float(cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY).mean())

    def _spoof_decision(self, texture_var: float, z_std: float, face_width: int, face_height: int) -> bool:
        """Reject spoof only when the face crop is large enough and the texture/depth signal is clearly implausible."""
        if face_width < 80 or face_height < 80:
            return False

        texture_low = texture_var < SPOOF_TEXTURE_MIN
        z_low = z_std < SPOOF_Z_STD_MIN

        # Tiny real faces and small webcam crops often look artificially low-texture.
        # Require a plausible face size before rejecting as spoof.
        if face_width < 120 or face_height < 120:
            return False

        # Strong spoof signal: both low texture and low depth variance at a realistic face scale.
        if texture_low and z_low:
            return texture_var < 25.0 and z_std < 0.006

        return False

    def _check_spoof(self, frame, landmarks, w: int, h: int):
        xs = [lm.x for lm in landmarks]
        ys = [lm.y for lm in landmarks]
        x1 = max(0, int(min(xs) * w) - 10)
        y1 = max(0, int(min(ys) * h) - 10)
        x2 = min(w, int(max(xs) * w) + 10)
        y2 = min(h, int(max(ys) * h) + 10)

        face_crop = frame[y1:y2, x1:x2]
        if face_crop.size == 0:
            return 0.0, 0.0, False

        gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
        texture_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

        z_values = [lm.z for lm in landmarks]
        z_std = float(np.std(z_values))

        face_width = max(1, x2 - x1)
        face_height = max(1, y2 - y1)
        is_spoof = self._spoof_decision(texture_var, z_std, face_width, face_height)
        return texture_var, z_std, is_spoof

    def extract_forehead_rgb(self, frame, landmarks, w: int, h: int):
        """
        Sample mean R, G, B from the forehead region — a thin strip just above
        the eyebrows, sized relative to actual face dimensions.

        Returns (r, g, b, x1_norm, y1_norm, x2_norm, y2_norm) or None.

        Geometry rationale:
          - WIDTH: use temple-to-temple distance (landmarks 127 ↔ 356), then
            take the inner ~55%. This is the actual face width, not the much
            smaller inner-brow distance we used before.
          - HEIGHT: a strip starting just above the brow line and extending
            upward by ~25% of the inter-ocular distance. This stays on skin
            even when the user has bangs/heavy hair that covers most of the
            upper forehead. Reaching all the way up to the forehead apex (10)
            sampled hair on people with bangs and produced garbage signal.
          - CENTER X: midpoint between the two pupils (landmarks 33 ↔ 263)
            so the box stays centered even when the head yaws slightly.

        Landmarks used:
          127, 356 → left/right temples (face width)
          33,  263 → left/right outer eye corners (centering + scale)
          107, 336 → top of left/right eyebrow (vertical anchor)
        """
        lm_temple_l = landmarks[127]
        lm_temple_r = landmarks[356]
        lm_eye_l    = landmarks[33]
        lm_eye_r    = landmarks[263]
        lm_brow_l   = landmarks[107]
        lm_brow_r   = landmarks[336]

        # Pixel coords
        temple_xl = lm_temple_l.x * w
        temple_xr = lm_temple_r.x * w
        eye_xl    = lm_eye_l.x * w
        eye_xr    = lm_eye_r.x * w

        face_width   = abs(temple_xr - temple_xl)
        if face_width < 30:  # Face too small / too far away
            return None

        eye_dist     = abs(eye_xr - eye_xl)
        center_x_pix = (eye_xl + eye_xr) / 2.0

        # Width: 55% of face width, centered between the eyes
        half_w = face_width * 0.275

        # Vertical strip: from just above the brows, going up by ~30% of eye dist
        brow_y_pix = ((lm_brow_l.y + lm_brow_r.y) / 2.0) * h
        strip_h    = max(8.0, eye_dist * 0.30)

        x1 = int(max(0, center_x_pix - half_w))
        x2 = int(min(w, center_x_pix + half_w))
        y2 = int(max(0, brow_y_pix - 4))            # 4px gap above the brow
        y1 = int(max(0, y2 - strip_h))

        if x2 - x1 < 8 or y2 - y1 < 4:
            return None

        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            return None

        b_mean = float(roi[:, :, 0].mean())
        g_mean = float(roi[:, :, 1].mean())
        r_mean = float(roi[:, :, 2].mean())

        return r_mean, g_mean, b_mean, x1 / w, y1 / h, x2 / w, y2 / h

    def close(self):
        self.detector.close()
