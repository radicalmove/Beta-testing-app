"""Add user display names.

Revision ID: 20260710_08
Revises: 20260710_07
"""
import sqlalchemy as sa
from alembic import op

revision = "20260710_08"
down_revision = "20260710_07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.String(length=100), nullable=True))
    connection = op.get_bind()
    users = sa.table("users", sa.column("id"), sa.column("email"), sa.column("display_name"))
    for row in connection.execute(sa.select(users.c.id, users.c.email)):
        local = (row.email or "").split("@", 1)[0].strip()
        connection.execute(users.update().where(users.c.id == row.id).values(display_name=(local[:100] or "User")))
    with op.batch_alter_table("users") as batch:
        batch.alter_column("display_name", existing_type=sa.String(length=100), nullable=False)
        batch.create_check_constraint("ck_users_display_name_length", "length(trim(display_name)) BETWEEN 1 AND 100")


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("ck_users_display_name_length", type_="check")
        batch.drop_column("display_name")
