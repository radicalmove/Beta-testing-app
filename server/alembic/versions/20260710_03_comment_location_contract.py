"""Enforce approved comment categories and complete anchor locations.

Revision ID: 20260710_03
Revises: 20260710_02
"""

from alembic import op
import sqlalchemy as sa


revision = "20260710_03"
down_revision = "20260710_02"
branch_labels = None
depends_on = None


_CATEGORY_MAP = {
    "content": "learning_design_content_flow",
    "design": "learning_design_content_flow",
    "assessment": "assessment",
    "accessibility": "accessibility",
    "technical": "technical_link_media_interaction",
    "other": "general",
}
_NEW_CATEGORIES = tuple(dict.fromkeys(_CATEGORY_MAP.values()))


def _category_case() -> str:
    return "CASE category::text " + " ".join(f"WHEN '{old}' THEN '{new}'" for old, new in _CATEGORY_MAP.items()) + " END"


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE commentcategory RENAME TO commentcategory_legacy")
        op.execute("CREATE TYPE commentcategory AS ENUM (" + ", ".join(f"'{item}'" for item in _NEW_CATEGORIES) + ")")
        op.execute("ALTER TABLE comments ALTER COLUMN category TYPE commentcategory USING (" + _category_case() + ")::commentcategory")
        op.execute("DROP TYPE commentcategory_legacy")
    else:
        for old, new in _CATEGORY_MAP.items():
            op.execute(sa.text("UPDATE comments SET category = :new WHERE category = :old").bindparams(old=old, new=new))

    op.add_column("page_locations", sa.Column("page_title", sa.String(length=512), nullable=True))
    op.add_column("page_locations", sa.Column("anchor_type", sa.String(length=32), nullable=True))
    op.execute("UPDATE page_locations SET page_title = page_url WHERE page_title IS NULL OR trim(page_title) = ''")
    op.execute("UPDATE page_locations SET anchor_type = CASE WHEN relative_x IS NOT NULL AND relative_y IS NOT NULL THEN 'visual_pin' ELSE 'text_highlight' END WHERE anchor_type IS NULL")
    with op.batch_alter_table("page_locations") as batch_op:
        batch_op.alter_column("page_title", existing_type=sa.String(length=512), nullable=False)
        batch_op.alter_column("anchor_type", existing_type=sa.String(length=32), nullable=False)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE commentcategory RENAME TO commentcategory_new")
        op.execute("CREATE TYPE commentcategory AS ENUM ('content', 'design', 'assessment', 'accessibility', 'technical', 'other')")
        op.execute("ALTER TABLE comments ALTER COLUMN category TYPE commentcategory USING (CASE category::text WHEN 'language_grammar' THEN 'content' WHEN 'learning_design_content_flow' THEN 'design' WHEN 'assessment' THEN 'assessment' WHEN 'accessibility' THEN 'accessibility' WHEN 'technical_link_media_interaction' THEN 'technical' WHEN 'general' THEN 'other' END)::commentcategory")
        op.execute("DROP TYPE commentcategory_new")
    else:
        reverse_map = {
            "language_grammar": "content", "learning_design_content_flow": "design", "assessment": "assessment",
            "accessibility": "accessibility", "technical_link_media_interaction": "technical", "general": "other",
        }
        for old, new in reverse_map.items():
            op.execute(sa.text("UPDATE comments SET category = :new WHERE category = :old").bindparams(old=old, new=new))
    with op.batch_alter_table("page_locations") as batch_op:
        batch_op.drop_column("anchor_type")
        batch_op.drop_column("page_title")
