import json

import httpx
import pytest

from app.schemas.ai import AIRecognitionCandidate
from app.services.ai_client import (
    AIRecognitionClient,
    AIServiceResponseError,
    AIServiceTimeoutError,
    AIServiceUnavailableError,
)


def make_client(handler):
    transport = httpx.MockTransport(handler)
    return AIRecognitionClient(
        base_url="http://ai-service:8000",
        client=httpx.Client(transport=transport),
    )


def test_recognition_success_sends_expected_payload():
    def handler(request):
        body = json.loads(request.content)
        assert body["image"] == "aGVsbG8="
        assert body["candidates"] == [{"employee_id": 7, "embedding": [0.1, 0.2]}]
        return httpx.Response(
            200,
            json={"matched": True, "employee_id": 7, "confidence": 0.94, "liveness": True},
        )

    client = make_client(handler)
    result = client.recognize(
        b"hello",
        [AIRecognitionCandidate(employee_id=7, embedding=[0.1, 0.2])],
    )

    assert result.employee_id == 7
    assert result.confidence == 0.94
    assert result.matched is True
    assert result.liveness is True


@pytest.mark.parametrize(
    "response_body",
    [
        {"matched": False, "confidence": 0, "liveness": True, "error_code": "NO_FACE"},
        {"matched": False, "confidence": 0.31, "liveness": True, "error_code": "FACE_NOT_RECOGNIZED"},
    ],
)
def test_recognition_negative_results_are_returned(response_body):
    client = make_client(lambda request: httpx.Response(422, json=response_body))

    result = client.recognize(b"image", [])

    assert result.matched is False
    assert result.error_code in {"NO_FACE", "FACE_NOT_RECOGNIZED"}


def test_unavailable_ai_service_is_reported():
    def handler(request):
        raise httpx.ConnectError("connection refused", request=request)

    client = make_client(handler)

    with pytest.raises(AIServiceUnavailableError):
        client.recognize(b"image", [])


def test_ai_service_timeout_is_reported():
    def handler(request):
        raise httpx.ReadTimeout("timed out", request=request)

    client = make_client(handler)

    with pytest.raises(AIServiceTimeoutError):
        client.recognize(b"image", [])


def test_invalid_ai_response_is_reported():
    client = make_client(lambda request: httpx.Response(200, json={"matched": "yes"}))

    with pytest.raises(AIServiceResponseError):
        client.recognize(b"image", [])


def test_legacy_ai_error_response_is_normalized():
    client = make_client(
        lambda request: httpx.Response(
            200,
            json={"success": False, "error_code": "NO_FACE", "message": "No face detected"},
        )
    )

    result = client.recognize(b"image", [])

    assert result.matched is False
    assert result.liveness is False
    assert result.error_code == "NO_FACE"


def test_identity_bound_liveness_session_sends_initial_frame_and_gallery():
    def handler(request):
        body = json.loads(request.content)
        assert request.url.path == "/session/create"
        assert body["image"] == "c3RhcnQtZnJhbWU="
        assert body["candidates"] == [{"employee_id": 7, "embedding": [0.1, 0.2]}]
        return httpx.Response(
            200,
            json={"session_id": "session-x", "expires_at": "later",
                  "challenges": ["BLINK"], "employee_id": 7},
        )

    client = make_client(handler)
    session = client.create_liveness_session(
        b"start-frame",
        [AIRecognitionCandidate(employee_id=7, embedding=[0.1, 0.2])],
    )
    assert session.session_id == "session-x"
    assert session.employee_id == 7
