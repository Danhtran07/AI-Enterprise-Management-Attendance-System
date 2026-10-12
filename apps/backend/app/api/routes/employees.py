import math

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user
from app.core.database import get_db
from app.models.employee import Employee
from app.models.face_data import FaceData
from app.models.user import User, UserRole


def _validate_enrollment_quality(embeddings: list[list[float]]) -> None:
    if len(embeddings) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 3 valid face frames are required for a strong enrollment profile.",
        )


FACE_DUPLICATE_THRESHOLD = 0.75


def _cosine_similarity(first: list[float], second: list[float]) -> float:
    if len(first) != len(second) or not first:
        return -1.0
    first_norm = math.sqrt(sum(value * value for value in first))
    second_norm = math.sqrt(sum(value * value for value in second))
    if first_norm == 0 or second_norm == 0:
        return -1.0
    return sum(left * right for left, right in zip(first, second)) / (
        first_norm * second_norm
    )


def _find_duplicate_employee(
    db: Session,
    employee_id: int,
    embeddings: list[list[float]],
) -> tuple[int, float] | None:
    existing_faces = (
        db.query(FaceData)
        .filter(FaceData.employee_id != employee_id)
        .all()
    )
    best_match: tuple[int, float] | None = None
    for new_embedding in embeddings:
        for face_data in existing_faces:
            similarity = _cosine_similarity(new_embedding, face_data.embedding)
            if similarity < FACE_DUPLICATE_THRESHOLD:
                continue
            if best_match is None or similarity > best_match[1]:
                best_match = (face_data.employee_id, similarity)
    return best_match
from app.schemas.employee import (
    EmployeeCreate,
    EmployeeResponse,
    EmployeeUpdate,
)
from app.services.ai_client import (
    AIRecognitionClient,
    AIServiceResponseError,
    AIServiceTimeoutError,
    AIServiceUnavailableError,
)


router = APIRouter(
    prefix="/api/employees",
    tags=["Employees"],
)


def _require_admin(current_user: User) -> None:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can manage employees",
        )


@router.get(
    "",
    response_model=list[EmployeeResponse],
)
def get_employees(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    return db.query(Employee).all()


@router.post("/{employee_id}/face", status_code=status.HTTP_201_CREATED)
def enroll_employee_face(
    employee_id: int,
    images: list[UploadFile] | None = File(default=None),
    image: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    enrollment_images = list(images or [])
    if image is not None:
        enrollment_images.append(image)
    if not enrollment_images:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one image file is required")

    client = AIRecognitionClient()
    embeddings: list[list[float]] = []
    try:
        for enrollment_image in enrollment_images:
            image_bytes = enrollment_image.file.read()
            if not image_bytes or not (enrollment_image.content_type or "").startswith("image/"):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="All files must be valid images")
            result = client.enroll_face(image_bytes)
            if result.embedding is not None:
                embeddings.append(result.embedding)
    except AIServiceTimeoutError as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
    except AIServiceUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except AIServiceResponseError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    finally:
        client.close()

    if not embeddings:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No usable face was found")

    _validate_enrollment_quality(embeddings)

    duplicate = _find_duplicate_employee(db, employee_id, embeddings)
    if duplicate is not None:
        duplicate_employee_id, similarity = duplicate
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This face is already enrolled for another employee "
                f"(employee_id={duplicate_employee_id}, similarity={similarity:.3f})"
            ),
        )

    db.query(FaceData).filter(FaceData.employee_id == employee_id).delete()
    db.add_all(
        FaceData(employee_id=employee_id, embedding=embedding, model_name="insightface")
        for embedding in embeddings
    )
    db.commit()
    return {"success": True, "employee_id": employee_id, "embeddings_saved": len(embeddings)}


@router.get(
    "/{employee_id}",
    response_model=EmployeeResponse,
)
def get_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
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


@router.post(
    "",
    response_model=EmployeeResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    user = (
        db.query(User)
        .filter(User.id == payload.user_id)
        .first()
    )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    existing_employee = (
        db.query(Employee)
        .filter(
            (Employee.user_id == payload.user_id)
            | (Employee.employee_code == payload.employee_code)
            | (Employee.email == payload.email)
        )
        .first()
    )

    if existing_employee is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Employee already exists",
        )

    employee = Employee(
        user_id=payload.user_id,
        employee_code=payload.employee_code,
        full_name=payload.full_name,
        email=payload.email,
        department=payload.department,
    )

    db.add(employee)
    db.commit()
    db.refresh(employee)

    return employee


@router.put(
    "/{employee_id}",
    response_model=EmployeeResponse,
)
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
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

    update_data = payload.model_dump(exclude_unset=True)

    if "employee_code" in update_data:
        existing = (
            db.query(Employee)
            .filter(
                Employee.employee_code == update_data["employee_code"],
                Employee.id != employee_id,
            )
            .first()
        )

        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Employee code already exists",
            )

    if "email" in update_data:
        existing = (
            db.query(Employee)
            .filter(
                Employee.email == update_data["email"],
                Employee.id != employee_id,
            )
            .first()
        )

        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already exists",
            )

    for field, value in update_data.items():
        setattr(employee, field, value)

    db.commit()
    db.refresh(employee)

    return employee


@router.delete(
    "/{employee_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
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

    db.delete(employee)
    db.commit()

    return None