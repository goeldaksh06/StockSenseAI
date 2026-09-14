def test_health_check(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_index_page_serves_html(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]


def test_register_new_user(client):
    resp = client.post("/users/register", json={"email": "a@example.com", "password": "hunter2pass"})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


def test_register_duplicate_user_rejected(client):
    client.post("/users/register", json={"email": "dup@example.com", "password": "hunter2pass"})
    resp = client.post("/users/register", json={"email": "dup@example.com", "password": "other"})
    assert resp.status_code == 400


def test_login_wrong_password_rejected(client):
    client.post("/users/register", json={"email": "b@example.com", "password": "correctpass"})
    resp = client.post("/users/login", json={"email": "b@example.com", "password": "wrongpass"})
    assert resp.status_code == 401


def test_login_unknown_user_rejected(client):
    resp = client.post("/users/login", json={"email": "nobody@example.com", "password": "x"})
    assert resp.status_code == 404


def test_me_requires_auth(client):
    resp = client.get("/users/me")
    assert resp.status_code == 401


def test_me_with_valid_token(client):
    reg = client.post("/users/register", json={"email": "c@example.com", "password": "hunter2pass"})
    token = reg.json()["access_token"]
    resp = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "c@example.com"


def test_watchlist_add_and_get(client):
    reg = client.post("/users/register", json={"email": "d@example.com", "password": "hunter2pass"})
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    add_resp = client.post("/users/watchlist", json={"symbol": "aapl", "name": "Apple"}, headers=headers)
    assert add_resp.status_code == 200
    assert add_resp.json()["item"]["symbol"] == "AAPL"

    get_resp = client.get("/users/watchlist", headers=headers)
    assert get_resp.status_code == 200
    assert any(item["symbol"] == "AAPL" for item in get_resp.json()["watchlist"])


def test_stock_create_and_get(client):
    create_resp = client.post("/stocks/", params={"symbol": "MSFT", "company_name": "Microsoft"})
    assert create_resp.status_code == 200

    get_resp = client.get("/stocks/MSFT")
    assert get_resp.status_code == 200
    assert get_resp.json()["stock"]["symbol"] == "MSFT"


def test_stock_duplicate_rejected(client):
    client.post("/stocks/", params={"symbol": "GOOG", "company_name": "Alphabet"})
    resp = client.post("/stocks/", params={"symbol": "GOOG", "company_name": "Alphabet"})
    assert resp.status_code == 400


def test_stock_not_found(client):
    resp = client.get("/stocks/NOPE")
    assert resp.status_code == 404


def test_ml_predict_uses_pipeline_and_sentiment(client, monkeypatch):
    import backend.main as main_module

    monkeypatch.setattr(
        main_module,
        "predict_next_day",
        lambda symbol: {
            "symbol": symbol.upper(),
            "current_price": 150.0,
            "predicted_price": 152.0,
            "predicted_return_pct": 1.33,
            "direction": "up",
            "direction_confidence": 0.6,
            "indicators": {"rsi": 55, "macd": 1.2, "signal_line": 0.8, "ema_20": 148, "current_price": 150.0},
            "as_of_date": "2026-01-01",
        },
    )

    resp = client.post("/ml/predict", json={"symbol": "aapl", "headline": "Great quarter"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "AAPL"
    assert body["predicted_price"] == 152.0
    assert "sentiment_score" in body


def test_ml_predict_handles_prediction_failure(client, monkeypatch):
    import backend.main as main_module

    def _raise(symbol):
        raise ValueError("No data found for BADTICKER")

    monkeypatch.setattr(main_module, "predict_next_day", _raise)

    resp = client.post("/ml/predict", json={"symbol": "BADTICKER"})
    assert resp.status_code == 500


def test_briefing_degrades_without_llm_key(client, monkeypatch):
    import backend.routers.briefing_router as briefing_module

    monkeypatch.setattr(
        briefing_module,
        "predict_next_day",
        lambda symbol: {
            "symbol": symbol.upper(),
            "current_price": 100.0,
            "predicted_price": 101.0,
            "predicted_return_pct": 1.0,
            "direction": "up",
            "direction_confidence": 0.55,
            "indicators": {"rsi": 50, "macd": 0, "signal_line": 0, "ema_20": 100, "current_price": 100.0},
            "as_of_date": "2026-01-01",
        },
    )
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    resp = client.get("/briefing/AAPL")
    assert resp.status_code == 200
    assert resp.json()["briefing"]["available"] is False


def test_analysis_backtest_rejects_invalid_variant(client):
    resp = client.get("/analysis/backtest/AAPL", params={"model_variant": "bogus"})
    assert resp.status_code == 400
