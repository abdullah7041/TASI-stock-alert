"""Tests for the data layer: symbol mapping + Yahoo->SAHMK fallback. No network."""
import data


def test_yahoo_symbol_mapping():
    assert data.yahoo_symbol("2222") == "2222.SR"
    assert data.yahoo_symbol("8313") == "8313.SR"


def test_period_for_days():
    assert data._period_for_days(20) == "1mo"
    assert data._period_for_days(90) == "3mo"
    assert data._period_for_days(120) == "6mo"
    assert data._period_for_days(300) == "1y"
    assert data._period_for_days(900) == "2y"


class _FakeTickerOK:
    def __init__(self, sym):
        self.fast_info = {"last_price": 25.5}


class _FakeYFOK:
    Ticker = _FakeTickerOK


class _FakeTickerFail:
    def __init__(self, sym):
        raise RuntimeError("yahoo down")


class _FakeYFFail:
    Ticker = _FakeTickerFail


class _FakeSahmk:
    def quote(self, symbol):
        return {"symbol": symbol, "price": 30.0, "is_delayed": True}


def test_quote_uses_yahoo_when_available(monkeypatch):
    monkeypatch.setattr(data, "yf", _FakeYFOK)
    p = data.DataProvider(sahmk=_FakeSahmk())
    q = p.quote("2222")
    assert q["price"] == 25.5 and q["source"] == "yahoo"


def test_quote_falls_back_to_sahmk(monkeypatch):
    monkeypatch.setattr(data, "yf", _FakeYFFail)
    p = data.DataProvider(sahmk=_FakeSahmk())
    q = p.quote("2222")
    assert q["price"] == 30.0 and q["source"] == "sahmk"


def test_quote_none_when_all_fail(monkeypatch):
    monkeypatch.setattr(data, "yf", _FakeYFFail)
    p = data.DataProvider(sahmk=None)
    assert p.quote("2222") is None


def test_history_empty_on_failure(monkeypatch):
    monkeypatch.setattr(data, "yf", _FakeYFFail)
    p = data.DataProvider()
    assert p.history_closes("2222", 120) == []
