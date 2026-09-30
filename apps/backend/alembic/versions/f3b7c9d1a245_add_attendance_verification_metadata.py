"""add attendance verification metadata

Revision ID: f3b7c9d1a245
Revises: e8c9d0a1b2c3
Create Date: 2026-09-30 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f3b7c9d1a245"
down_revision: Union[str, Sequence[str], None] = "e8c9d0a1b2c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("attendance", sa.Column("timestamp", sa.DateTime(timezone=True), nullable=True))
    op.add_column("attendance", sa.Column("face_similarity", sa.Float(), nullable=True))
    op.add_column("attendance", sa.Column("liveness_score", sa.Float(), nullable=True))
    op.add_column(
        "attendance",
        sa.Column(
            "verification_status",
            sa.String(length=24),
            nullable=False,
            server_default="LEGACY",
        ),
    )
    op.add_column("attendance", sa.Column("session_id", sa.String(length=64), nullable=True))
    op.create_index("ix_attendance_session_id", "attendance", ["session_id"], unique=False)

    op.execute(sa.text(
        "UPDATE attendance "
        "SET timestamp = COALESCE(check_in, created_at, CURRENT_TIMESTAMP) "
        "WHERE timestamp IS NULL"
    ))
    with op.batch_alter_table("attendance") as batch_op:
        batch_op.alter_column(
            "timestamp",
            existing_type=sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        )


def downgrade() -> None:
    op.drop_index("ix_attendance_session_id", table_name="attendance")
    with op.batch_alter_table("attendance") as batch_op:
        batch_op.drop_column("session_id")
        batch_op.drop_column("verification_status")
        batch_op.drop_column("liveness_score")
        batch_op.drop_column("face_similarity")
        batch_op.drop_column("timestamp")
