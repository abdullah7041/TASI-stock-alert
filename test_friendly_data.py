import importlib
import pytest
import requests
import llm
import news
import explain

def test_blank_provider_and_model_use_gemini_defaults(monkeypatch):
    with monkeypatch.context() as m:
        m.setenv('TASI_LLM_PROVIDERS', '  ')
        m.setenv('TASI_LLM_MODEL_GEMINI', '')
        m.setenv('TASI_LLM_MODEL', '')
        importlib.reload(llm)
        assert llm.PROVIDER_ORDER == ('gemini',)
        assert llm.GEMINI_MODEL == 'gemini-flash-latest'
    importlib.reload(llm)

def test_explicit_provider_order_and_model_preserved(monkeypatch):
    with monkeypatch.context() as m:
        m.setenv('TASI_LLM_PROVIDERS','openrouter,gemini')
        m.setenv('TASI_LLM_MODEL_GEMINI','chosen-model')
        importlib.reload(llm)
        assert llm.PROVIDER_ORDER == ('openrouter','gemini')
        assert llm.GEMINI_MODEL == 'chosen-model'
    importlib.reload(llm)

def test_arabic_news_survives_english_failure(monkeypatch):
    def fetch(url,limit):
        if 'hl=en' in url: raise requests.ConnectionError('offline')
        return [{'title':'Arabic headline','link':'https://example.com','published':''}]
    monkeypatch.setattr(news,'_fetch_rss',fetch)
    result=news.get_news('Company','1303')
    assert result.ok
    assert result.status=='partial'
    assert len(result.headlines)==1
    assert result.errors==['en: ConnectionError']

@pytest.mark.parametrize('failed,expected',[(False,'empty'),(True,'failed')])
def test_empty_and_failed_news_are_distinct(monkeypatch,failed,expected):
    def fetch(*args):
        if failed: raise requests.ConnectionError('offline')
        return []
    monkeypatch.setattr(news,'_fetch_rss',fetch)
    result=news.get_news('Company','1303')
    assert result.status==expected
    assert result.ok is not failed

def test_transient_news_request_retries_once(monkeypatch):
    calls=[]
    def get(*args,**kwargs):
        calls.append(1)
        if len(calls)==1: raise requests.Timeout('slow')
        response=requests.Response();response.status_code=200;response._content=b'<rss><channel><item><title>Recovered</title></item></channel></rss>';return response
    monkeypatch.setattr(requests,'get',get)
    monkeypatch.setattr(news.time,'sleep',lambda _:None)
    assert news._fetch_rss('https://example.com',1)[0]['title']=='Recovered'
    assert len(calls)==2

def test_overbought_missing_condition_is_not_called_failure_to_recover():
    message=explain.situation({'kind':'watchlist','rules_met':2,'rules_total':3,'rules':[{'rule':'rsi_band','actual':71,'passed':False}]})
    assert 'overbought' in message
    assert "hasn't started recovering" not in message
def test_shared_decision_records_are_used_by_discord():
    import artifacts
    import notify
    rec = {"code": "1234", "name": "Example", "kind": "holding", "action": "SELL (STOP)", "price": 90}
    artifact = artifacts.build_digest_artifact({"asOf": "2026-09-06T06:00:00Z"}, recs=[rec], lean_status={}, charts=[], scheduled_for=None)
    enriched = artifact["digestRecords"][0]
    assert enriched["decision"]["label"] == "Review stop"
    embed = notify.build_name_embed(enriched)
    assert embed["title"].startswith(enriched["decision"]["label"])
    assert enriched["decision"]["reason"] in embed["description"]
    assert "decision" not in rec


def test_partial_empty_news_is_not_complete_coverage():
    import notify
    assert "partial coverage" in notify._fmt_news({"ok": True, "status": "partial", "headlines": []})[0]
