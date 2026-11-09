from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ROOT_DIR = _BACKEND_DIR.parent.parent


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./faceattend.db"
    AI_SERVICE_URL: str = "http://ai-service:8000"
    AI_SERVICE_TIMEOUT_SECONDS: float = 10.0
    AI_SERVICE_WS_URL: str = "ws://ai-service:8000"

    JWT_SECRET_KEY: str = "development-secret-key"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    model_config = SettingsConfigDict(
        env_file=(str(_ROOT_DIR / ".env"), str(_BACKEND_DIR / ".env"), ".env"),
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()