"""HTTP behaviour: validation, errors, limits, headers and the page."""

import pytest
from fastapi.testclient import TestClient

from sqlforge.main import create_app


@pytest.fixture
def site(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log(1)")
    (tmp_path / "index.html").write_text("<!doctype html><title>SQLForge</title>")
    (tmp_path / "favicon.ico").write_bytes(b"\0\0\1\0")
    (tmp_path.parent / "secret.txt").write_text("nope")
    return tmp_path


@pytest.fixture
def client(site):
    return TestClient(create_app(static_dir=str(site), analytics_origins="https://stats.example"))


def test_format(client):
    r = client.post("/api/format", json={"sql": "select 1; select 2", "dialect": "mysql"})
    assert r.status_code == 200
    assert r.json() == {"formatted": "SELECT\n  1;\n\nSELECT\n  2;", "dialect": "mysql"}
    assert r.headers["cache-control"] == "no-store"


def test_transpile(client):
    r = client.post("/api/transpile", json={"sql": "select nvl(a, 0) from t", "source_dialect": "hive", "target_dialect": "postgres"})
    body = r.json()
    assert r.status_code == 200
    assert "COALESCE" in body["result"]
    assert body["rewritten_functions"] == ["NVL"]
    assert body["warnings"] == []
    assert body["source_dialect"] == "hive"


def test_analyze(client):
    r = client.post("/api/analyze", json={"sql": "select a from t", "target_sql": "select a from t", "target_dialect": "postgres"})
    body = r.json()
    assert r.status_code == 200
    assert body["ast"]["type"] == "Select"
    assert body["diff"] == {"changes": [], "summary": {"kept": body["diff"]["summary"]["kept"], "removed": 0, "inserted": 0, "moved": 0, "updated": 0}}


def test_old_endpoints_still_answer(client):
    assert client.post("/api/parse", json={"sql": "select a from t"}).json()["tables"] == ["t"]
    assert client.post("/api/diff", json={"source_sql": "select a", "target_sql": "select b"}).status_code == 200
    assert client.post("/api/lineage", json={"sql": "select a from t"}).json()["mappings"][0]["source_table"] == "t"
    assert "hive" in client.get("/api/dialects").json()["dialects"]


def test_parse_error_points_at_the_spot(client):
    r = client.post("/api/format", json={"sql": "select a\nfrom t\nwhere (x = 1"})
    assert r.status_code == 422
    body = r.json()
    assert body["detail"] == "Expecting )"
    assert body["errors"][0]["line"] == 3


def test_unknown_dialect(client):
    r = client.post("/api/format", json={"sql": "select 1", "dialect": "nosuch"})
    assert r.status_code == 422
    assert "unknown dialect" in r.json()["detail"]


def test_sql_too_long(client):
    r = client.post("/api/format", json={"sql": "x" * 100_001})
    assert r.status_code == 422
    assert r.json()["detail"].startswith("sql:")


def test_missing_target(client):
    r = client.post("/api/transpile", json={"sql": "select 1"})
    assert r.status_code == 422
    assert "target_dialect" in r.json()["detail"]


def test_rate_limit(site):
    client = TestClient(create_app(static_dir=str(site), rate=0.001, burst=2))
    for _ in range(2):
        assert client.post("/api/format", json={"sql": "select 1"}).status_code == 200
    r = client.post("/api/format", json={"sql": "select 1"})
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) > 0
    assert client.get("/health").status_code == 200  # only API posts count


def test_rate_limit_uses_the_proxy_header(site):
    client = TestClient(create_app(static_dir=str(site), client_ip_header="X-Real-IP", rate=0.001, burst=1))
    assert client.post("/api/format", json={"sql": "select 1"}, headers={"X-Real-IP": "1.1.1.1"}).status_code == 200
    assert client.post("/api/format", json={"sql": "select 1"}, headers={"X-Real-IP": "2.2.2.2"}).status_code == 200
    assert client.post("/api/format", json={"sql": "select 1"}, headers={"X-Real-IP": "1.1.1.1"}).status_code == 429


def test_page_and_headers(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"
    csp = r.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in csp
    assert "script-src 'self' https://stats.example" in csp
    assert r.headers["x-content-type-options"] == "nosniff"


def test_head(client):
    assert client.head("/").status_code == 200
    assert client.head("/favicon.ico").status_code == 200


def test_hashed_assets_are_immutable(client):
    r = client.get("/assets/index-abc123.js")
    assert r.status_code == 200
    assert "immutable" in r.headers["cache-control"]
    assert client.get("/assets/missing.js").status_code == 404


def test_top_level_files(client):
    assert client.get("/favicon.ico").headers["cache-control"] == "public, max-age=86400"


@pytest.mark.parametrize("path", ["/nope", "/index.html/../secret.txt", "/..%2fsecret.txt", "/assets/..%2f..%2fsecret.txt"])
def test_nothing_else_is_served(client, path):
    r = client.get(path)
    assert r.status_code == 404
    assert b"nope" not in r.content


def test_docs_have_their_own_csp(client):
    r = client.get("/api/docs")
    assert r.status_code == 200
    assert "cdn.jsdelivr.net" in r.headers["content-security-policy"]
