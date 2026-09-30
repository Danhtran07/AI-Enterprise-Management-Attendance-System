import base64
from typing import Any

import httpx

from app.core.config import settings
from app.schemas.ai import (
    AIRecognitionCandidate,
    AIRecognitionResult,
    AIEnrollmentResult,
    LivenessSessionResponse,
)


class AIServiceUnavailableError(Exception):
    pass


class AIServiceTimeoutError(Exception):
    pass


class AIServiceResponseError(Exception):
    pass


class AIServiceRejectedError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code


class AIRecognitionClient:
    def __init__(
        self,
        base_url: str = settings.AI_SERVICE_URL,
        timeout_seconds: float = settings.AI_SERVICE_TIMEOUT_SECONDS,
        client: httpx.Client | None = None,
    ) -> None:
        self._endpoint = f"{base_url.rstrip('/')}/face/recognize"
        self._client = client or httpx.Client(timeout=timeout_seconds)
        self._owns_client = client is None

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def recognize(
        self,
        face_image: bytes,
        candidates: list[AIRecognitionCandidate],
        threshold: float = 0.5,
        min_margin: float = 0.05,
        fast_mode: bool = False,
        liveness_session_id: str | None = None,
    ) -> AIRecognitionResult:
        payload = {
            "image": base64.b64encode(face_image).decode("ascii"),
            "candidates": [candidate.model_dump() for candidate in candidates],
            "threshold": threshold,
            "min_margin": min_margin,
            "fast_mode": fast_mode,
            "liveness_session_id": liveness_session_id,
        }

        try:
            response = self._client.post(self._endpoint, json=payload)
        except httpx.TimeoutException as exc:
            raise AIServiceTimeoutError("AI Service request timed out") from exc
        except httpx.RequestError as exc:
            raise AIServiceUnavailableError("AI Service is unavailable") from exc

        try:
            response_data = response.json()
        except (ValueError, TypeError) as exc:
            raise AIServiceResponseError("AI Service returned invalid JSON") from exc

        if not isinstance(response_data, dict):
            raise AIServiceResponseError("AI Service returned an invalid response")

        error_code = response_data.get("error_code")
        if error_code in {
            "NO_FACE",
            "MULTIPLE_FACES",
            "FACE_NOT_RECOGNIZED",
            "AMBIGUOUS_MATCH",
            "LOW_LIGHT",
            "LIVENESS_FAILED",
            "SESSION_IDENTITY_MISMATCH",
        }:
            response_data = {
                **response_data,
                "matched": False,
                "liveness": response_data.get("liveness", False),
            }

        try:
            return AIRecognitionResult.model_validate(response_data)
        except (TypeError, ValueError) as exc:
            raise AIServiceResponseError("AI Service returned an invalid recognition result") from exc

    def create_liveness_session(
        self,
        initial_face_image: bytes | None = None,
        candidates: list[AIRecognitionCandidate] | None = None,
    ) -> LivenessSessionResponse:
        payload = None
        if initial_face_image is not None:
            payload = {
                "image": base64.b64encode(initial_face_image).decode("ascii"),
                "candidates": [candidate.model_dump() for candidate in candidates or []],
            }
        try:
            endpoint = f"{self._endpoint.rsplit('/face/', 1)[0]}/session/create"
            response = (
                self._client.post(endpoint, json=payload)
                if payload is not None else self._client.post(endpoint)
            )
        except httpx.TimeoutException as exc:
            raise AIServiceTimeoutError("AI Service request timed out") from exc
        except httpx.RequestError as exc:
            raise AIServiceUnavailableError("AI Service is unavailable") from exc

        if response.is_error:
            try:
                detail = response.json().get("detail", "Liveness session could not be created")
            except (ValueError, AttributeError):
                detail = "Liveness session could not be created"
            if response.status_code < 500:
                raise AIServiceRejectedError(response.status_code, str(detail))
            raise AIServiceResponseError(str(detail))

        try:
            return LivenessSessionResponse.model_validate(response.json())
        except (TypeError, ValueError) as exc:
            raise AIServiceResponseError("AI Service returned an invalid liveness session") from exc

    def enroll_face(self, face_image: bytes) -> AIEnrollmentResult:
        payload = {"image": base64.b64encode(face_image).decode("ascii")}
        enroll_endpoint = f"{self._endpoint.rsplit('/face/', 1)[0]}/face/enroll"
        try:
            response = self._client.post(enroll_endpoint, json=payload)
        except httpx.TimeoutException as exc:
            raise AIServiceTimeoutError("AI Service request timed out") from exc
        except httpx.RequestError as exc:
            raise AIServiceUnavailableError("AI Service is unavailable") from exc

        try:
            result = AIEnrollmentResult.model_validate(response.json())
        except (TypeError, ValueError) as exc:
            raise AIServiceResponseError("AI Service returned an invalid enrollment result") from exc
        if not result.success or not result.embedding:
            raise AIServiceResponseError(result.message or "Face enrollment failed")
        return result

    def __enter__(self) -> "AIRecognitionClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()
