from datetime import datetime, time

from sqlalchemy import Boolean, Integer, String, Text, Time, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.timezone import UTCDateTime


class Shift(Base):
    __tablename__ = "shifts"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    code: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    start_time: Mapped[time] = mapped_column(
        Time,
        nullable=False,
    )

    end_time: Mapped[time] = mapped_column(
        Time,
        nullable=False,
    )

    break_start_time: Mapped[time | None] = mapped_column(
        Time,
        nullable=True,
    )

    break_end_time: Mapped[time | None] = mapped_column(
        Time,
        nullable=True,
    )

    late_tolerance_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=15,
    )

    early_checkin_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=30,
    )

    checkin_close_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=90,
    )

    is_overnight: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(),
        server_default=func.now(),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    schedule_rules = relationship(
        "ScheduleRule",
        back_populates="shift",
    )