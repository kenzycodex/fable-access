"""Huawei MaaS writes the explanation wording on the Forge cluster, never the decision."""
from types import SimpleNamespace


def test_huawei_client_sends_the_team_key_in_the_apikey_header(monkeypatch):
    from core import ai_clients

    monkeypatch.setenv("FORGE_MAAS_BASE_URL", "http://maas.test/openai/v1")
    monkeypatch.setenv("GATEWAY_KEY", "team-key-for-test")
    client = ai_clients.huawei(5)
    assert client is not None
    assert str(client.base_url).startswith("http://maas.test/openai/v1")
    assert client.default_headers.get("apikey") == "team-key-for-test"
    assert ai_clients.huawei_model() == "glm-5.2"


def test_no_huawei_client_off_the_cluster(monkeypatch):
    from core import ai_clients

    monkeypatch.delenv("FORGE_MAAS_BASE_URL", raising=False)
    assert ai_clients.huawei(5) is None


def test_explanation_turns_thinking_off_and_falls_back_on_error(monkeypatch):
    from agents.shield import explainer
    from core import ai_clients

    seen = {}

    def create(**kwargs):
        seen.update(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Paused: new payee, unusual amount."))])

    fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(ai_clients, "huawei", lambda _t=30: fake)
    assert explainer._try_huawei("decision") == "Paused: new payee, unusual amount."
    assert seen["extra_body"] == {"chat_template_kwargs": {"thinking": False}}
    assert seen["model"] == "glm-5.2"

    def boom(**_kw):
        raise RuntimeError("gateway down")

    fake.chat.completions.create = boom
    assert explainer._try_huawei("decision") is None
