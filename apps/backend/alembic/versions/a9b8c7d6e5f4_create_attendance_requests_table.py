"""create attendance requests table

Revision ID: a9b8c7d6e5f4
Revises: f3b7c9d1a245
Create Date: 2026-11-10 04:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a9b8c7d6e5f4"
down_revision: Union[str, Sequence[str], None] = "f3b7c9d1a245"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "attendance_requests",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "employee_id",
            sa.Integer(),
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column(
            "request_type",
            sa.Enum(
                "FORGOT_CHECKIN",
                "LATE_EXPLANATION",
                "EARLY_LEAVE",
                "LEAVE",
                name="attendance_request_type",
            ),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("requested_check_in", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_check_out", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING",
                "APPROVED",
                "REJECTED",
                name="attendance_request_status",
            ),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("admin_note", sa.String(length=500), nullable=True),
        sa.Column(
            "reviewed_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index("ix_attendance_requests_id", "attendance_requests", ["id"])
    op.create_index(
        "ix_attendance_requests_employee_id",
        "attendance_requests",
        ["employee_id"],
    )
    op.create_index("ix_attendance_requests_date", "attendance_requests", ["date"])


def downgrade() -> None:
    op.drop_index("ix_attendance_requests_date", table_name="attendance_requests")
    op.drop_index(
        "ix_attendance_requests_employee_id", table_name="attendance_requests"
    )
    op.drop_index("ix_attendance_requests_id", table_name="attendance_requests")
    op.drop_table("attendance_requests")

