from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from config import service_auth
from errors.types import LLMError
from v1.benchmark.runner import BenchmarkRejected
from v1.learning.chat_template import BUILTIN_CHAT_TEMPLATE

SECRET = "api-to-ai-test-secret"
NOW_MS = 1_800_000_000_000
TARGET = "/ai/v1/benchmark/run-case"
BODY = {
    "template": {"label": "tutor-chat-builtin-3", "body": BUILTIN_CHAT_TEMPLATE},
    "case": {
        "id": "TC-01",
        "category": "concept",
        "risk": "standard",
        "stepTitle": "Aset",
        "learnerName": "Rani",
        "message": "Apa itu aset?",
        "currentMaterial": "",
        "conversation": [],
        "sources": [{"kind": "TOPIC", "title": "Persamaan", "text": "Aset adalah sumber daya."}],
        "strategy": None,
        "expect": {
            "behavior": "ANSWER",
            "requiredFacts": [{"id": "aset", "anyOf": ["sumber daya"]}],
            "forbiddenFacts": [],
            "citation": {"mode": "OPTIONAL", "mustCite": [], "mustNotCite": []},
            "rubric": "Singkat.",
        },
    },
    "protectedPhrases": ["domain_taxonomy"],
    "judge": True,
}
RESULT = {"caseId": "TC-01", "text": "Aset adalah sumber daya.", "dimensions": {"correctness": True}}


@pytest.fixture(autouse=True)
def caller_secret(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", SECRET)
    monkeypatch.setattr("config.service_identity.time.time", lambda: NOW_MS / 1000)


@pytest.fixture()
def client():
    import main

    with TestClient(main.app) as test_client:
        yield test_client


def signed(payload, *, acting="admin-1", caller="api", secret=SECRET, idempotency="idem-key-0001"):
    raw = json.dumps(payload).encode()
    headers = service_auth.signed_headers("POST", TARGET, raw, secret=secret, timestamp=str(NOW_MS), acting_user_id=acting, idempotency_key=idempotency)
    headers[service_auth.SERVICE_ID_HEADER] = caller
    headers["content-type"] = "application/json"
    return raw, headers


def post(client, payload=BODY, **options):
    raw, headers = signed(payload, **options)
    return client.post(TARGET, content=raw, headers=headers)


def test_a_call_without_service_credentials_is_refused_and_never_reaches_the_model(client):
    with patch("v1.benchmark.router.run_case") as run:
        response = client.post(TARGET, json=BODY, headers={"Idempotency-Key": "idem-key-0001"})

    assert response.status_code == 401
    run.assert_not_called()


def test_a_user_bearer_token_is_not_a_service_identity(client):
    with patch("v1.benchmark.router.run_case") as run:
        response = client.post(TARGET, json=BODY, headers={"Authorization": "Bearer user-token", "Idempotency-Key": "idem-key-0001"})

    assert response.status_code in (401, 403)
    run.assert_not_called()


def test_only_the_api_may_call_it(client):
    with patch("v1.benchmark.router.run_case") as run:
        response = post(client, caller="web")

    assert response.status_code in (401, 403)
    run.assert_not_called()


def test_a_signed_call_runs_the_case_for_the_acting_user(client):
    with patch("v1.benchmark.router.run_case", return_value=RESULT) as run:
        response = post(client)

    assert response.status_code == 200
    assert response.json() == RESULT
    assert run.call_args.kwargs["subject"] == "admin-1"
    assert run.call_args.args[0].case.id == "TC-01"


def test_the_blocking_model_call_runs_off_the_event_loop_so_other_requests_are_not_starved(client):
    seen = {}

    async def spy(function, *args, **kwargs):
        seen["function"] = function
        return RESULT

    with patch("v1.benchmark.router.run_in_threadpool", spy):
        response = post(client)

    assert response.status_code == 200
    assert seen["function"].__name__ == "run_case"


def test_a_body_with_an_unknown_field_is_refused(client):
    with patch("v1.benchmark.router.run_case") as run:
        response = post(client, {**BODY, "extra": 1})

    assert response.status_code == 422
    run.assert_not_called()


def test_a_template_that_breaks_the_contract_answers_422_with_the_problems(client):
    with patch("v1.benchmark.router.run_case", side_effect=BenchmarkRejected(["Missing required placeholder {{rag}}"])):
        response = post(client)

    assert response.status_code == 422
    assert response.json()["details"]["problems"] == ["Missing required placeholder {{rag}}"]


def test_a_model_failure_answers_503_and_never_a_made_up_result(client):
    with patch("v1.benchmark.router.run_case", side_effect=LLMError("down")):
        response = post(client)

    assert response.status_code == 503
    assert "caseId" not in response.text
