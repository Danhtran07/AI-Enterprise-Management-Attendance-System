from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies.auth import get_current_user
from app.core.database import get_db
from app.models.employee import Employee
from app.models.schedule_assignment import ScheduleAssignment
from app.models.schedule_rule import ScheduleRule
from app.models.shift import Shift
from app.models.user import User, UserRole
from app.models.work_schedule import WorkSchedule
from app.schemas.schedule import (
    EmployeeScheduleResponse,
    EmployeeWeekScheduleResponse,
    ScheduleAssignmentCreate,
    ScheduleAssignmentResponse,
    ScheduleCreate,
    ScheduleResponse,
    ScheduleUpdate,
    ShiftCreate,
    ShiftResponse,
    ShiftUpdate,
    WeekDayScheduleResponse,
    overnight_from_hours,
)
from app.services.shift_resolver import resolve_shift


router = APIRouter(tags=["Schedules"])


def _require_admin(current_user: User) -> None:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can manage schedules",
        )


def _shift_query(db: Session):
    return db.query(Shift)


def _schedule_query(db: Session):
    return db.query(WorkSchedule).options(
        joinedload(WorkSchedule.rules).joinedload(ScheduleRule.shift)
    )


def _get_shift_or_404(db: Session, shift_id: int) -> Shift:
    shift = db.query(Shift).filter(Shift.id == shift_id).first()
    if shift is None:
        raise HTTPException(status_code=404, detail="Shift not found")
    return shift


def _get_schedule_or_404(db: Session, schedule_id: int) -> WorkSchedule:
    schedule = (
        _schedule_query(db)
        .filter(WorkSchedule.id == schedule_id)
        .first()
    )
    if schedule is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return schedule


def _ensure_unique_shift_code(db: Session, code: str, shift_id: int | None = None) -> None:
    query = db.query(Shift).filter(Shift.code == code)
    if shift_id is not None:
        query = query.filter(Shift.id != shift_id)
    if query.first() is not None:
        raise HTTPException(status_code=409, detail="Shift code already exists")


def _ensure_unique_schedule_code(
    db: Session,
    code: str,
    schedule_id: int | None = None,
) -> None:
    query = db.query(WorkSchedule).filter(WorkSchedule.code == code)
    if schedule_id is not None:
        query = query.filter(WorkSchedule.id != schedule_id)
    if query.first() is not None:
        raise HTTPException(status_code=409, detail="Schedule code already exists")


def _replace_rules(db: Session, schedule: WorkSchedule, rules) -> None:
    db.query(ScheduleRule).filter(ScheduleRule.schedule_id == schedule.id).delete()
    for rule in rules:
        if rule.shift_id is not None:
            _get_shift_or_404(db, rule.shift_id)
        db.add(
            ScheduleRule(
                schedule_id=schedule.id,
                day_of_week=rule.day_of_week,
                shift_id=rule.shift_id,
            )
        )


def _apply_shift_hours(shift: Shift, start_time, end_time) -> None:
    shift.start_time = start_time
    shift.end_time = end_time
    shift.is_overnight = overnight_from_hours(start_time, end_time)


@router.get("/api/shifts", response_model=list[ShiftResponse])
def get_shifts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    return _shift_query(db).order_by(Shift.start_time, Shift.name).all()


@router.post("/api/shifts", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED)
def create_shift(
    payload: ShiftCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    _ensure_unique_shift_code(db, payload.code)
    shift = Shift(
        name=payload.name,
        code=payload.code,
        description=payload.description,
        start_time=payload.start_time,
        end_time=payload.end_time,
        break_start_time=payload.break_start_time,
        break_end_time=payload.break_end_time,
        late_tolerance_minutes=payload.late_tolerance_minutes,
        early_checkin_minutes=payload.early_checkin_minutes,
        checkin_close_minutes=payload.checkin_close_minutes,
        is_overnight=overnight_from_hours(payload.start_time, payload.end_time),
        is_active=payload.is_active,
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return shift


@router.put("/api/shifts/{shift_id}", response_model=ShiftResponse)
def update_shift(
    shift_id: int,
    payload: ShiftUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    shift = _get_shift_or_404(db, shift_id)
    data = payload.model_dump(exclude_unset=True)
    if "code" in data:
        _ensure_unique_shift_code(db, data["code"], shift.id)
    start_time = data.pop("start_time", shift.start_time)
    end_time = data.pop("end_time", shift.end_time)
    for key, value in data.items():
        setattr(shift, key, value)
    _apply_shift_hours(shift, start_time, end_time)
    db.commit()
    db.refresh(shift)
    return shift


@router.delete("/api/shifts/{shift_id}", response_model=ShiftResponse)
def deactivate_shift(
    shift_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    shift = _get_shift_or_404(db, shift_id)
    shift.is_active = False
    db.commit()
    db.refresh(shift)
    return shift


@router.get("/api/schedules", response_model=list[ScheduleResponse])
def get_schedules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    return _schedule_query(db).order_by(WorkSchedule.name).all()


@router.post(
    "/api/schedules",
    response_model=ScheduleResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_schedule(
    payload: ScheduleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    _ensure_unique_schedule_code(db, payload.code)
    schedule = WorkSchedule(
        name=payload.name.strip(),
        code=payload.code,
        description=payload.description,
        is_active=payload.is_active,
    )
    db.add(schedule)
    db.flush()
    _replace_rules(db, schedule, payload.rules)
    db.commit()
    return _get_schedule_or_404(db, schedule.id)


@router.put("/api/schedules/{schedule_id}", response_model=ScheduleResponse)
def update_schedule(
    schedule_id: int,
    payload: ScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    schedule = _get_schedule_or_404(db, schedule_id)
    data = payload.model_dump(exclude_unset=True)
    rules = data.pop("rules", None)
    if "code" in data and data["code"] is not None:
        _ensure_unique_schedule_code(db, data["code"], schedule.id)
    if "name" in data and data["name"] is not None:
        data["name"] = data["name"].strip()
    for key, value in data.items():
        setattr(schedule, key, value)
    if rules is not None:
        _replace_rules(db, schedule, payload.rules or [])
    db.commit()
    return _get_schedule_or_404(db, schedule.id)


def _get_employee_schedule(
    db: Session,
    employee_id: int,
    target_date: date,
) -> EmployeeScheduleResponse:
    assignment = (
        db.query(ScheduleAssignment)
        .options(
            joinedload(ScheduleAssignment.schedule)
            .joinedload(WorkSchedule.rules)
            .joinedload(ScheduleRule.shift)
        )
        .filter(
            ScheduleAssignment.employee_id == employee_id,
            ScheduleAssignment.is_active.is_(True),
            ScheduleAssignment.effective_from <= target_date,
            (
                ScheduleAssignment.effective_to.is_(None)
                | (ScheduleAssignment.effective_to >= target_date)
            ),
        )
        .order_by(ScheduleAssignment.effective_from.desc())
        .first()
    )
    if assignment is None or not assignment.schedule.is_active:
        return EmployeeScheduleResponse(
            employee_id=employee_id,
            target_date=target_date,
        )

    return EmployeeScheduleResponse(
        employee_id=employee_id,
        target_date=target_date,
        assignment_id=assignment.id,
        schedule=assignment.schedule,
        shift=resolve_shift(db, employee_id, target_date),
    )


@router.get(
    "/api/employees/{employee_id}/schedule",
    response_model=EmployeeScheduleResponse,
)
def get_employee_schedule(
    employee_id: int,
    target_date: date = Query(default_factory=date.today),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    if db.query(Employee).filter(Employee.id == employee_id).first() is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    return _get_employee_schedule(db, employee_id, target_date)


@router.get(
    "/api/schedules/me",
    response_model=EmployeeScheduleResponse,
)
def get_my_schedule(
    target_date: date = Query(default_factory=date.today),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    employee = db.query(Employee).filter(Employee.user_id == current_user.id).first()
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee profile not found")
    return _get_employee_schedule(db, employee.id, target_date)


@router.get(
    "/api/schedules/me/week",
    response_model=EmployeeWeekScheduleResponse,
)
def get_my_week_schedule(
    start_date: date = Query(default_factory=date.today),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    employee = db.query(Employee).filter(Employee.user_id == current_user.id).first()
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee profile not found")
    days = []
    for offset in range(7):
        current = start_date + timedelta(days=offset)
        shift = resolve_shift(db, employee.id, current)
        days.append(
            WeekDayScheduleResponse(
                date=current,
                day_of_week=current.isoweekday(),
                shift=shift,
                is_off=shift is None,
            )
        )
    return EmployeeWeekScheduleResponse(
        employee_id=employee.id,
        start_date=start_date,
        days=days,
    )


@router.post(
    "/api/schedule-assignments",
    response_model=ScheduleAssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
def assign_schedule(
    payload: ScheduleAssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    employee = db.query(Employee).filter(Employee.id == payload.employee_id).first()
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    schedule = _get_schedule_or_404(db, payload.schedule_id)
    if not schedule.is_active:
        raise HTTPException(status_code=422, detail="Cannot assign an inactive schedule")

    previous = (
        db.query(ScheduleAssignment)
        .filter(
            ScheduleAssignment.employee_id == payload.employee_id,
            ScheduleAssignment.is_active.is_(True),
            ScheduleAssignment.effective_from <= payload.effective_from,
            (
                ScheduleAssignment.effective_to.is_(None)
                | (ScheduleAssignment.effective_to >= payload.effective_from)
            ),
        )
        .all()
    )
    for assignment in previous:
        assignment.effective_to = payload.effective_from - timedelta(days=1)
        if assignment.effective_to < assignment.effective_from:
            assignment.is_active = False

    created = ScheduleAssignment(
        employee_id=payload.employee_id,
        schedule_id=payload.schedule_id,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
        is_active=True,
    )
    db.add(created)
    db.commit()
    db.refresh(created)
    created.schedule = schedule
    return created
