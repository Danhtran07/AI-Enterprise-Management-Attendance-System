from app.core.timezone import to_utc_time, to_vietnam_time
import calendar
import asyncio
import json
from datetime import date, datetime, timezone

import httpx
import websockets
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, WebSocket, status
from fastapi.websockets import WebSocketDisconnect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.attendance import Attendance, AttendanceStatus
from app.models.attendance_request import (
    AttendanceRequest,
    AttendanceRequestStatus,
    AttendanceRequestType,
)
from app.models.employee import Employee
from app.models.face_data import FaceData
from app.models.user import User, UserRole
from app.schemas.attendance import (
    AIBiometricsMetricsResponse,
    AttendanceCreate,
    AttendanceCalendarResponse,
    AttendanceCalendarDay,
    AttendanceRequestCreate,
    AttendanceRequestResponse,
    AttendanceRequestReview,
    AttendanceResponse,
    AttendanceRecognitionData,
    AttendanceRecognitionEmployee,
    AttendanceRecognitionResponse,
    AttendanceUpdate,
    MonthlyTimesheetReportResponse,
    MonthlyTimesheetRow,
)
from app.schemas.ai import AIRecognitionCandidate
from app.services.ai_client import (
    AIRecognitionClient,
    AIServiceRejectedError,
    AIServiceResponseError,
    AIServiceTimeoutError,
    AIServiceUnavailableError,
)
from app.services.attendance_recognition import (
    AttendancePersistenceError,
    RecognitionRejectedError,
    record_recognition_attendance,
)
from app.services.attendance_policy import (
    calculate_attendance_metrics,
    calculate_attendance_status,
)
from app.services.shift_resolver import resolve_shift, resolve_shift_for_punch


router = APIRouter(
    prefix="/api/attendance",
    tags=["Attendance"],
)


def _compute_status(
    db: Session,
    employee_id: int,
    check_in,
    check_out=None,
    explicit_status=None,
):
    if explicit_status is not None:
        return explicit_status

    if check_in is None:
        return AttendanceStatus.ABSENT

    local_date = to_vietnam_time(check_in).date()
    local_now = to_vietnam_time(check_in)
    shift, _shift_date, _continuation = resolve_shift_for_punch(
        db,
        employee_id,
        local_now,
    )
    return calculate_attendance_status(check_in, shift)


def _get_ai_client():
    client = AIRecognitionClient()
    try:
        yield client
    finally:
        client.close()


def _get_employee_for_current_user(db: Session, current_user: User):
    return (
        db.query(Employee)
        .filter(Employee.user_id == current_user.id)
        .first()
    )


def _get_calendar_employee(
    db: Session,
    current_user: User,
    employee_id: int | None,
) -> Employee:
    if current_user.role == UserRole.EMPLOYEE:
        employee = _get_employee_for_current_user(db, current_user)
        if employee is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee profile not found",
            )
        if employee_id is not None and employee_id != employee.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only view your own attendance calendar",
            )
        return employee

    if employee_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="employee_id is required for admin users",
        )

    employee = (
        db.query(Employee)
        .filter(Employee.id == employee_id)
        .first()
    )
    if employee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found",
        )
    return employee


@router.get(
    "/calendar",
    response_model=AttendanceCalendarResponse,
)
def get_attendance_calendar(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    employee_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    employee = _get_calendar_employee(db, current_user, employee_id)
    total_days = calendar.monthrange(year, month)[1]
    first_day = date(year, month, 1)
    last_day = date(year, month, total_days)

    records = (
        db.query(Attendance)
        .filter(
            Attendance.employee_id == employee.id,
            Attendance.date >= first_day,
            Attendance.date <= last_day,
        )
        .all()
    )
    records_by_date = {record.date: record for record in records}

    days = []
    for day_number in range(1, total_days + 1):
        current_date = date(year, month, day_number)
        record = records_by_date.get(current_date)
        days.append(
            AttendanceCalendarDay(
                date=current_date,
                day_of_week=current_date.isoweekday(),
                is_weekend=current_date.weekday() >= 5,
                attendance_id=record.id if record else None,
                status=record.status if record else AttendanceStatus.ABSENT,
                has_record=record is not None,
                check_in=record.check_in if record else None,
                check_out=record.check_out if record else None,
                late_minutes=record.late_minutes if record else 0,
                early_leave_minutes=record.early_leave_minutes if record else 0,
                working_minutes=record.working_minutes if record else 0,
                overtime_minutes=record.overtime_minutes if record else 0,
                face_similarity=record.face_similarity if record else None,
                liveness_score=record.liveness_score if record else None,
                verification_status=record.verification_status if record else None,
            )
        )

    return AttendanceCalendarResponse(
        employee_id=employee.id,
        year=year,
        month=month,
        total_days=total_days,
        days=days,
    )


@router.get(
    "",
    response_model=list[AttendanceResponse],
)
def get_attendance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == UserRole.EMPLOYEE:
        employee = _get_employee_for_current_user(db, current_user)
        if employee is None:
            return []
        return (
            db.query(Attendance)
            .filter(Attendance.employee_id == employee.id)
            .all()
        )

    return db.query(Attendance).all()


@router.post(
    "/recognize",
    response_model=AttendanceRecognitionResponse,
    status_code=status.HTTP_201_CREATED,
)
def recognize_attendance(
    image: UploadFile = File(...),
    liveness_session_id: str | None = Form(default=None),
    fast_mode: bool = Form(default=True),
    db: Session = Depends(get_db),
    ai_client: AIRecognitionClient = Depends(_get_ai_client),
    current_user: User = Depends(get_current_user),
):
    del current_user
    image_bytes = image.file.read()
    if not image_bytes or not (image.content_type or "").startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid image file is required",
        )

    candidates = [
        AIRecognitionCandidate(
            employee_id=face_data.employee_id,
            embedding=face_data.embedding,
        )
        for face_data in db.query(FaceData).all()
    ]

    try:
        recognition = ai_client.recognize(
            image_bytes,
            candidates,
            fast_mode=fast_mode,
            liveness_session_id=liveness_session_id,
        )
    except AIServiceTimeoutError as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
    except AIServiceUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except AIServiceResponseError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except AIServiceRejectedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    if recognition.error_code == "NO_FACE":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No face detected")
    if recognition.error_code == "MULTIPLE_FACES":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Multiple faces detected")
    if recognition.error_code == "FACE_NOT_RECOGNIZED":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Face was not recognized")
    if recognition.error_code == "AMBIGUOUS_MATCH":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Multiple employees have similarly matching faces",
        )
    if recognition.error_code == "LOW_LIGHT":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Lighting is insufficient for fast attendance",
        )
    if not recognition.liveness:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Liveness validation failed")

    try:
        attendance = record_recognition_attendance(db, recognition)
    except RecognitionRejectedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except AttendancePersistenceError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    return AttendanceRecognitionResponse(
        success=True,
        employee=AttendanceRecognitionEmployee(
            id=attendance.employee.id,
            name=attendance.employee.full_name,
        ),
        attendance=attendance,
        recognition=AttendanceRecognitionData(
            matched=recognition.matched,
            confidence=recognition.confidence,
            liveness=recognition.liveness,
            liveness_score=recognition.liveness_score,
            verification_status=recognition.verification_status,
            session_id=recognition.session_id,
        ),
    )


@router.post("/liveness/session")
def create_liveness_session(
    image: UploadFile | None = File(default=None),
    identity_only: bool = Form(default=False),
    db: Session = Depends(get_db),
    ai_client: AIRecognitionClient = Depends(_get_ai_client),
    current_user: User = Depends(get_current_user),
):
    del current_user
    initial_face_image = None
    candidates = None
    if image is not None:
        if not image.content_type or not image.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="A valid image file is required")
        initial_face_image = image.file.read()
        if not initial_face_image:
            raise HTTPException(status_code=400, detail="Empty image data")
        candidates = [
            AIRecognitionCandidate(
                employee_id=face_data.employee_id,
                embedding=face_data.embedding,
            )
            for face_data in db.query(FaceData).all()
        ]
    try:
        if initial_face_image is None:
            return ai_client.create_liveness_session()
        return ai_client.create_liveness_session(
            initial_face_image, candidates, identity_only=identity_only
        )
    except AIServiceTimeoutError as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
    except AIServiceUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except AIServiceResponseError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except AIServiceRejectedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.websocket("/liveness/{session_id}")
async def liveness_proxy(websocket: WebSocket, session_id: str):
    access_token = websocket.query_params.get("access_token")
    if not access_token:
        await websocket.close(code=1008, reason="Authentication required")
        return
    try:
        token_payload = decode_access_token(access_token)
        if token_payload.get("sub") is None:
            raise ValueError("Missing token subject")
    except ValueError:
        await websocket.close(code=1008, reason="Invalid authentication")
        return

    await websocket.accept()
    ai_ws_url = f"{settings.AI_SERVICE_WS_URL.rstrip('/')}/ws/liveness/{session_id}"

    try:
        async with websockets.connect(ai_ws_url, open_timeout=settings.AI_SERVICE_TIMEOUT_SECONDS) as ai_socket:
            async def forward_to_ai():
                while True:
                    message = await websocket.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    if message.get("bytes"):
                        await ai_socket.send(message["bytes"])
                    elif message.get("text"):
                        await ai_socket.send(message["text"])

            async def forward_to_frontend():
                async for message in ai_socket:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(message)

            await asyncio.gather(forward_to_ai(), forward_to_frontend())
    except (WebSocketDisconnect, websockets.exceptions.ConnectionClosed):
        pass
    except Exception as exc:
        try:
            await websocket.send_text(json.dumps({"error": "Liveness service unavailable", "detail": str(exc)}))
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


def _ensure_requests_table(db: Session) -> None:
    try:
        AttendanceRequest.__table__.create(bind=db.get_bind(), checkfirst=True)
    except Exception:
        pass


def _serialize_request(item: AttendanceRequest) -> AttendanceRequestResponse:
    employee = item.employee
    return AttendanceRequestResponse(
        id=item.id,
        employee_id=item.employee_id,
        employee_name=employee.full_name if employee else None,
        employee_code=employee.employee_code if employee else None,
        department=employee.department if employee else None,
        date=item.date,
        request_type=item.request_type,
        reason=item.reason,
        requested_check_in=item.requested_check_in,
        requested_check_out=item.requested_check_out,
        status=item.status,
        admin_note=item.admin_note,
        reviewed_by=item.reviewed_by,
        reviewed_at=item.reviewed_at,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get(
    "/report",
    response_model=MonthlyTimesheetReportResponse,
)
def get_monthly_timesheet_report(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    department: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can generate company timesheet reports",
        )

    total_days = calendar.monthrange(year, month)[1]
    first_day = date(year, month, 1)
    last_day = date(year, month, total_days)

    emp_query = db.query(Employee)
    if department and department.strip():
        emp_query = emp_query.filter(Employee.department == department.strip())
    employees = emp_query.order_by(Employee.employee_code).all()

    records = (
        db.query(Attendance)
        .filter(
            Attendance.date >= first_day,
            Attendance.date <= last_day,
        )
        .all()
    )
    by_employee: dict[int, list[Attendance]] = {}
    for record in records:
        by_employee.setdefault(record.employee_id, []).append(record)

    rows: list[MonthlyTimesheetRow] = []
    for emp in employees:
        emp_records = by_employee.get(emp.id, [])
        present_days = sum(1 for r in emp_records if r.status == AttendanceStatus.PRESENT)
        late_days = sum(1 for r in emp_records if r.status == AttendanceStatus.LATE)
        absent_days = sum(1 for r in emp_records if r.status == AttendanceStatus.ABSENT)
        total_working = sum(r.working_minutes or 0 for r in emp_records)
        total_late = sum(r.late_minutes or 0 for r in emp_records)
        total_early = sum(r.early_leave_minutes or 0 for r in emp_records)
        total_ot = sum(r.overtime_minutes or 0 for r in emp_records)
        similarities = [r.face_similarity for r in emp_records if r.face_similarity is not None]
        liveness_scores = [r.liveness_score for r in emp_records if r.liveness_score is not None]
        rows.append(
            MonthlyTimesheetRow(
                employee_id=emp.id,
                employee_code=emp.employee_code,
                full_name=emp.full_name,
                department=emp.department,
                present_days=present_days,
                late_days=late_days,
                absent_days=absent_days,
                total_working_minutes=total_working,
                total_late_minutes=total_late,
                total_early_leave_minutes=total_early,
                total_overtime_minutes=total_ot,
                avg_face_similarity=(
                    round(sum(similarities) / len(similarities), 4)
                    if similarities
                    else None
                ),
                avg_liveness_score=(
                    round(sum(liveness_scores) / len(liveness_scores), 4)
                    if liveness_scores
                    else None
                ),
            )
        )

    return MonthlyTimesheetReportResponse(
        year=year,
        month=month,
        total_employees=len(rows),
        rows=rows,
    )


@router.get(
    "/ai-metrics",
    response_model=AIBiometricsMetricsResponse,
)
def get_ai_biometrics_metrics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    del current_user
    records = db.query(Attendance).all()
    face_rows = db.query(FaceData).all()

    similarities = [r.face_similarity for r in records if r.face_similarity is not None]
    liveness_scores = [r.liveness_score for r in records if r.liveness_score is not None]
    verified_count = sum(
        1
        for r in records
        if r.face_similarity is not None or r.verification_status not in ("UNVERIFIED", "LEGACY")
    )
    enrolled_employee_ids = {f.employee_id for f in face_rows}

    engine_attempts = 0
    engine_matched = 0
    engine_rejected = 0
    engine_frr = 0.0
    rejection_breakdown: dict[str, int] = {}

    try:
        resp = httpx.get(
            f"{settings.AI_SERVICE_URL.rstrip('/')}/metrics/recognition",
            timeout=2.0,
        )
        if resp.status_code == 200:
            payload = resp.json()
            engine_attempts = int(payload.get("attempts", 0))
            engine_matched = int(payload.get("matched", 0))
            engine_rejected = int(payload.get("rejected", 0))
            engine_frr = float(payload.get("false_rejection_rate", 0.0))
            raw_breakdown = payload.get("rejection_reasons") or {}
            if isinstance(raw_breakdown, dict):
                rejection_breakdown = {str(k): int(v) for k, v in raw_breakdown.items()}
    except Exception:
        pass

    return AIBiometricsMetricsResponse(
        total_verifications=len(records),
        verified_count=verified_count,
        avg_face_similarity=(
            round(sum(similarities) / len(similarities), 4) if similarities else 0.0
        ),
        avg_liveness_score=(
            round(sum(liveness_scores) / len(liveness_scores), 4)
            if liveness_scores
            else 0.0
        ),
        enrolled_employees=len(enrolled_employee_ids),
        total_face_embeddings=len(face_rows),
        engine_attempts=engine_attempts or verified_count,
        engine_matched=engine_matched or verified_count,
        engine_rejected=engine_rejected,
        engine_false_Reject_rate=engine_frr,
        rejection_breakdown=rejection_breakdown,
    )


@router.get(
    "/requests",
    response_model=list[AttendanceRequestResponse],
)
def get_attendance_requests(
    status_filter: AttendanceRequestStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_requests_table(db)
    query = db.query(AttendanceRequest)

    if current_user.role == UserRole.EMPLOYEE:
        employee = _get_employee_for_current_user(db, current_user)
        if employee is None:
            return []
        query = query.filter(AttendanceRequest.employee_id == employee.id)

    if status_filter is not None:
        query = query.filter(AttendanceRequest.status == status_filter)

    items = query.order_by(AttendanceRequest.created_at.desc()).all()
    return [_serialize_request(item) for item in items]


@router.post(
    "/requests",
    response_model=AttendanceRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_attendance_request(
    payload: AttendanceRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_requests_table(db)
    employee = _get_employee_for_current_user(db, current_user)
    if employee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee profile not found for your account",
        )

    if (
        payload.requested_check_in is not None
        and payload.requested_check_out is not None
        and to_utc_time(payload.requested_check_out) < to_utc_time(payload.requested_check_in)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="requested_check_out must be after requested_check_in",
        )

    item = AttendanceRequest(
        employee_id=employee.id,
        date=payload.date,
        request_type=payload.request_type,
        reason=payload.reason.strip(),
        requested_check_in=payload.requested_check_in,
        requested_check_out=payload.requested_check_out,
        status=AttendanceRequestStatus.PENDING,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _serialize_request(item)


@router.put(
    "/requests/{request_id}/review",
    response_model=AttendanceRequestResponse,
)
def review_attendance_request(
    request_id: int,
    payload: AttendanceRequestReview,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can review attendance requests",
        )

    _ensure_requests_table(db)
    item = (
        db.query(AttendanceRequest)
        .filter(AttendanceRequest.id == request_id)
        .first()
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendance request not found",
        )

    if payload.status not in (
        AttendanceRequestStatus.APPROVED,
        AttendanceRequestStatus.REJECTED,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Review status must be APPROVED or REJECTED",
        )

    item.status = payload.status
    item.admin_note = payload.admin_note.strip() if payload.admin_note else None
    item.reviewed_by = current_user.id
    item.reviewed_at = datetime.now(timezone.utc)

    if payload.status == AttendanceRequestStatus.APPROVED:
        attendance = (
            db.query(Attendance)
            .filter(
                Attendance.employee_id == item.employee_id,
                Attendance.date == item.date,
            )
            .first()
        )
        shift = resolve_shift(db, item.employee_id, item.date)
        check_in = item.requested_check_in or (attendance.check_in if attendance else None)
        check_out = item.requested_check_out or (attendance.check_out if attendance else None)
        metrics = calculate_attendance_metrics(check_in, check_out, shift)

        if attendance is None:
            attendance = Attendance(
                employee_id=item.employee_id,
                shift_id=shift.id if shift else None,
                date=item.date,
                check_in=check_in,
                check_out=check_out,
                status=AttendanceStatus.PRESENT,
                late_minutes=0 if item.request_type == AttendanceRequestType.LATE_EXPLANATION else metrics.late_minutes,
                early_leave_minutes=0 if item.request_type == AttendanceRequestType.EARLY_LEAVE else metrics.early_leave_minutes,
                working_minutes=metrics.working_minutes or (480 if item.request_type == AttendanceRequestType.LEAVE else 0),
                overtime_minutes=metrics.overtime_minutes,
                verification_status="ADMIN_APPROVED",
            )
            db.add(attendance)
        else:
            if item.requested_check_in is not None:
                attendance.check_in = item.requested_check_in
            if item.requested_check_out is not None:
                attendance.check_out = item.requested_check_out
            attendance.status = AttendanceStatus.PRESENT
            attendance.late_minutes = (
                0
                if item.request_type == AttendanceRequestType.LATE_EXPLANATION
                else metrics.late_minutes
            )
            attendance.early_leave_minutes = (
                0
                if item.request_type == AttendanceRequestType.EARLY_LEAVE
                else metrics.early_leave_minutes
            )
            attendance.working_minutes = metrics.working_minutes or (
                480 if item.request_type == AttendanceRequestType.LEAVE else attendance.working_minutes
            )
            attendance.overtime_minutes = metrics.overtime_minutes
            attendance.verification_status = "ADMIN_APPROVED"

    db.commit()
    db.refresh(item)
    return _serialize_request(item)


@router.get(
    "/{attendance_id}",
    response_model=AttendanceResponse,
)
def get_attendance_record(
    attendance_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    attendance = (
        db.query(Attendance)
        .filter(Attendance.id == attendance_id)
        .first()
    )

    if attendance is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendance record not found",
        )

    if current_user.role == UserRole.EMPLOYEE:
        employee = _get_employee_for_current_user(db, current_user)
        if employee is None or attendance.employee_id != employee.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only view your own attendance records",
            )

    return attendance


@router.post(
    "",
    response_model=AttendanceResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_attendance(
    payload: AttendanceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == UserRole.EMPLOYEE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Employees can only record attendance through face recognition",
        )

    employee = (
        db.query(Employee)
        .filter(Employee.id == payload.employee_id)
        .first()
    )

    if employee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found",
        )

    if current_user.role == UserRole.EMPLOYEE:
        current_employee = _get_employee_for_current_user(db, current_user)
        if current_employee is None or payload.employee_id != current_employee.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only create attendance for your own employee record",
            )

    existing_attendance = (
        db.query(Attendance)
        .filter(
            Attendance.employee_id == payload.employee_id,
            Attendance.date == payload.date,
        )
        .first()
    )

    if existing_attendance is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attendance record already exists for this employee and date",
        )

    if payload.check_out is not None and payload.check_in is not None:
        if to_utc_time(payload.check_out) < to_utc_time(payload.check_in):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="check_out must be after check_in",
            )

    computed_status = _compute_status(
        db,
        payload.employee_id,
        payload.check_in,
        payload.check_out,
        payload.status,
    )
    shift = resolve_shift(db, payload.employee_id, payload.date)
    metrics = calculate_attendance_metrics(
        payload.check_in,
        payload.check_out,
        shift,
    )

    attendance = Attendance(
        employee_id=payload.employee_id,
        shift_id=shift.id if shift is not None else None,
        date=payload.date,
        check_in=payload.check_in,
        check_out=payload.check_out,
        status=computed_status,
        late_minutes=metrics.late_minutes,
        early_leave_minutes=metrics.early_leave_minutes,
        working_minutes=metrics.working_minutes,
        overtime_minutes=metrics.overtime_minutes,
    )

    db.add(attendance)

    try:
        db.commit()
        db.refresh(attendance)
    except IntegrityError:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attendance record already exists for this employee and date",
        )

    return attendance


@router.put(
    "/{attendance_id}",
    response_model=AttendanceResponse,
)
def update_attendance(
    attendance_id: int,
    payload: AttendanceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == UserRole.EMPLOYEE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Employees cannot manually update attendance",
        )

    attendance = (
        db.query(Attendance)
        .filter(Attendance.id == attendance_id)
        .first()
    )

    if attendance is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendance record not found",
        )

    if current_user.role == UserRole.EMPLOYEE:
        employee = _get_employee_for_current_user(db, current_user)
        if employee is None or attendance.employee_id != employee.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only update your own attendance records",
            )

    update_data = payload.model_dump(exclude_unset=True)

    if "check_in" in update_data:
        attendance.check_in = update_data["check_in"]

    if "check_out" in update_data and update_data["check_out"] is not None:
        if (
            attendance.check_in is not None
            and to_utc_time(update_data["check_out"])
            < to_utc_time(attendance.check_in)
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="check_out must be after check_in",
            )
        attendance.check_out = update_data["check_out"]

    metrics = calculate_attendance_metrics(
        attendance.check_in,
        attendance.check_out,
        attendance.shift,
    )
    attendance.late_minutes = metrics.late_minutes
    attendance.early_leave_minutes = metrics.early_leave_minutes
    attendance.working_minutes = metrics.working_minutes
    attendance.overtime_minutes = metrics.overtime_minutes

    if "status" in update_data and update_data["status"] is not None:
        attendance.status = update_data["status"]
    else:
        attendance.status = calculate_attendance_status(
            attendance.check_in,
            attendance.shift,
        )

    db.commit()
    db.refresh(attendance)

    return attendance


@router.delete(
    "/{attendance_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_attendance(
    attendance_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == UserRole.EMPLOYEE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Employees cannot manually delete attendance",
        )

    attendance = (
        db.query(Attendance)
        .filter(Attendance.id == attendance_id)
        .first()
    )

    if attendance is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendance record not found",
        )

    if current_user.role == UserRole.EMPLOYEE:
        employee = _get_employee_for_current_user(db, current_user)
        if employee is None or attendance.employee_id != employee.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only delete your own attendance records",
            )

    db.delete(attendance)
    db.commit()

    return None
