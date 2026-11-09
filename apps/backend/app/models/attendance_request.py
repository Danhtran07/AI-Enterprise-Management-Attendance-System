from datetime import date, datetime
from enum import Enum

from sqlalchemy import (
    Date,
    Enum as SQLEnum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.timezone import UTCDateTime


class AttendanceRequestType(str, Enum):
    FORGOT_CHECKIN = "FORGOT_CHECKIN"
    LATE_EXPLANATION = "LATE_EXPLANATION"
    EARLY_LEAVE = "EARLY_LEAVE"
    LEAVE = "LEAVE"


class AttendanceRequestStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class AttendanceRequest(Base):
    __tablename__ = "attendance_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    request_type: Mapped[AttendanceRequestType] = mapped_column(
        SQLEnum(AttendanceRequestType, name="attendance_request_type"),
        nullable=False,
        default=AttendanceRequestType.FORGOT_CHECKIN,
    )

    reason: Mapped[str] = mapped_column(Text, nullable=False)

    requested_check_in: Mapped[datetime | None] = mapped_column(
        UTCDateTime(),
        nullable=True,
    )

    requested_check_out: Mapped[datetime | None] = mapped_column(
        UTCDateTime(),
        nullable=True,
    )

    status: Mapped[AttendanceRequestStatus] = mapped_column(
        SQLEnum(AttendanceRequestStatus, name="attendance_request_status"),
        nullable=False,
        default=AttendanceRequestStatus.PENDING,
    )

    admin_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    reviewed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    reviewed_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime(),
        nullable=True,
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

    employee: Mapped["Employee"] = relationship("Employee")

