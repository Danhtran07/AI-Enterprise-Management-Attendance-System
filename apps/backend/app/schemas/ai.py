from pydantic import BaseModel


class AIRecognitionResult(BaseModel):
    employee_id: int | None = None
    confidence: float = 0.0
    matched: bool
    liveness: bool
    error_code: str | None = None
    message: str | None = None


class AIRecognitionCandidate(BaseModel):
    employee_id: int
    embedding: list[float]


class LivenessSessionResponse(BaseModel):
    session_id: str
    expires_at: str
    challenges: list[str]
    employee_id: int | None = None


class AIEnrollmentResult(BaseModel):
    success: bool
    embedding: list[float] | None = None
    error_code: str | None = None
    message: str | None = None
