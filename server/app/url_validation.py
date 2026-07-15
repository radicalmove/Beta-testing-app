from pydantic import AnyUrl, TypeAdapter, ValidationError


_ANY_URL = TypeAdapter(AnyUrl)


def canonical_https_url(value: str, field_name: str, *, max_length: int) -> str:
    if not value or len(value) > max_length or value != value.strip() or any(ord(character) <= 32 or ord(character) == 127 for character in value):
        raise ValueError(f"{field_name} must be a canonical HTTPS URL")
    try:
        parsed = _ANY_URL.validate_python(value)
    except (ValidationError, ValueError) as exc:
        raise ValueError(f"{field_name} must be a canonical HTTPS URL") from exc
    if parsed.scheme != "https" or parsed.host is None or parsed.username is not None or parsed.password is not None or str(parsed) != value:
        raise ValueError(f"{field_name} must be a canonical credential-free HTTPS URL")
    return value
