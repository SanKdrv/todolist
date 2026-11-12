from fastapi.testclient import TestClient

SESSION_URL = "/api/v1/session"


def test_no_store_is_applied_to_every_response(client: TestClient) -> None:
    for path, expected_status in [
        ("/health", 200),
        (SESSION_URL, 200),
        ("/api/v1/does-not-exist", 404),
    ]:
        response = client.get(path)

        assert response.status_code == expected_status
        assert response.headers["cache-control"] == "no-store"
        # The middleware sets the header once; it must not be duplicated.
        assert len(response.headers.get_list("cache-control")) == 1
