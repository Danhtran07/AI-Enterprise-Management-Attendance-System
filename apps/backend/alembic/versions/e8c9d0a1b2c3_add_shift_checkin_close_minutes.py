"""add shift check-in close window

Revision ID: e8c9d0a1b2c3
Revises: d7a8b9c0e1f2
Create Date: 2026-09-11 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e8c9d0a1b2c3"
down_revision: Union[str, Sequence[str], None] = "d7a8b9c0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "shifts",
        sa.Column(
            "checkin_close_minutes",
            sa.Integer(),
            nullable=False,
            server_default="90",
        ),
    )


def downgrade() -> None:
    op.drop_column("shifts", "checkin_close_minutes")
