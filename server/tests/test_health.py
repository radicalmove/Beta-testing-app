import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


def test_health_returns_ok(client):
    assert client.get("/health").json() == {"status": "ok"}
