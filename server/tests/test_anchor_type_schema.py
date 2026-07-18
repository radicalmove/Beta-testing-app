from sqlalchemy import CheckConstraint, String

from app.models import PageLocation


def test_anchor_type_model_uses_a_bounded_string_and_matching_database_check():
    column = PageLocation.__table__.c.anchor_type

    assert isinstance(column.type, String)
    assert column.type.length == 32
    checks = [constraint for constraint in PageLocation.__table__.constraints if isinstance(constraint, CheckConstraint)]
    assert any("text_highlight" in str(check.sqltext) and "visual_pin" in str(check.sqltext) for check in checks)
