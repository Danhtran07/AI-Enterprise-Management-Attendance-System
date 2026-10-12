from dataclasses import dataclass
from datetime import datetime, time, timedelta
from enum import Enum

from app.core.timezone import to_vietnam_time
from app.models.shift import Shift


class ShiftKind(str, Enum):
    DAY = "DAY"
    EVENING = "EVENING"
    NIGHT = "NIGHT"


class CheckInWindowState(str, Enum):
    TOO_EARLY = "TOO_EARLY"
    OPEN = "OPEN"
    CLOSED = "CLOSED"


@dataclass(frozen=True)
class ShiftWindow:
    starts_at: datetime
    ends_at: datetime


@dataclass(frozen=True)
class CheckInWindow:
    state: CheckInWindowState
    opens_at: datetime
    closes_at: datetime


def is_overnight_hours(start_time: time, end_time: time) -> bool:
    return end_time <= start_time


def classify_shift_kind(
    start_time: time,
    end_time: time,
    overnight: bool | None = None,
) -> ShiftKind:
    overnight = is_overnight_hours(start_time, end_time) if overnight is None else overnight
    if overnight or start_time.hour >= 16:
        return ShiftKind.NIGHT
    return ShiftKind.DAY


def shift_duration_minutes(start_time: time, end_time: time) -> int:
    start = datetime.combine(datetime.min.date(), start_time)
    end = datetime.combine(datetime.min.date(), end_time)
    if end <= start:
        end += timedelta(days=1)
    return int((end - start).total_seconds() // 60)


def format_clock(value: datetime) -> str:
    return to_vietnam_time(value).strftime("%H:%M")


def shift_window_for_local_time(shift: Shift, local_now: datetime) -> ShiftWindow:
    naive = local_now.replace(tzinfo=None)
    start = datetime.combine(naive.date(), shift.start_time)
    if shift.is_overnight and naive.time() < shift.end_time:
        start -= timedelta(days=1)
    end = start + timedelta(
        minutes=shift_duration_minutes(shift.start_time, shift.end_time)
    )
    return ShiftWindow(starts_at=start, ends_at=end)


def get_shift_check_in_window(shift: Shift, server_now: datetime) -> CheckInWindow:
    local_now = to_vietnam_time(server_now).replace(tzinfo=None)
    window = shift_window_for_local_time(shift, local_now)
    opens_at = window.starts_at - timedelta(minutes=shift.early_checkin_minutes)
    close_after_start = getattr(shift, "checkin_close_minutes", 90) or 90
    closes_at = window.starts_at + timedelta(minutes=close_after_start)
    if local_now < opens_at:
        state = CheckInWindowState.TOO_EARLY
    elif local_now > closes_at:
        state = CheckInWindowState.CLOSED
    else:
        state = CheckInWindowState.OPEN
    return CheckInWindow(state=state, opens_at=opens_at, closes_at=closes_at)
