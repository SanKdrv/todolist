from fastapi.testclient import TestClient

import app.main as main_module


def test_health_liveness(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_ready_when_database_is_available(client: TestClient) -> None:
    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_health_ready_returns_503_without_database(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(main_module, "check_db_connection", lambda: False)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"detail": "Database is unavailable"}
