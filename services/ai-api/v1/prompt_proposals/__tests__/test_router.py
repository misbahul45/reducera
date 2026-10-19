from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from config import service_auth
from errors.types import LLMError
from v1.learning.chat_template import BUILTIN_CHAT_TEMPLATE
from v1.prompt_proposals.proposer import ProposalRejected

SECRET = "api-to-ai-test-secret"
NOW_MS = 1_800_000_000_000
TARGET = "/ai/v1/prompt-proposals"
BODY = {
    "name": "tutor-chat",
    "template": BUILTIN_CHAT_TEMPLATE,
    "metrics": {"episodes": 80, "outcomes": 30, "successRate": 0.5},
    "themes": [{"strategy": "HINT", "attempts": 10, "failures": 6}],
    "samples": [{"strategy": "HINT", "grounded": False, "reply": "Coba lagi ya."}],
}
PROPOSAL = {"template": BUILTIN_CHAT_TEMPLATE + " ", "rationale": "Menambah pertanyaan penjelasan.", "changes": [], "similarity": 0.99, "model": "m", "tokensIn": 1, "tokensOut": 1}


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
    with patch("v1.prompt_proposals.router.propose") as propose:
        response = client.post(TARGET, json=BODY, headers={"Idempotency-Key": "idem-key-0001"})

    assert response.status_code == 401
    propose.assert_not_called()


def test_a_user_bearer_token_is_not_a_credential_here(client):
    with patch("v1.prompt_proposals.router.propose") as propose:
        response = client.post(TARGET, json=BODY, headers={"Authorization": "Bearer user-token", "Idempotency-Key": "idem-key-0001"})

    assert response.status_code == 401
    propose.assert_not_called()


def test_a_signature_made_with_another_secret_is_refused(client):
    with patch("v1.prompt_proposals.router.propose") as propose:
        response = post(client, secret="not-the-secret")

    assert response.status_code == 401
    propose.assert_not_called()


def test_only_the_api_may_call_it(client):
    with patch("v1.prompt_proposals.router.propose") as propose:
        response = post(client, caller="web")

    assert response.status_code == 401
    propose.assert_not_called()


def test_it_needs_an_idempotency_key(client):
    raw, headers = signed(BODY)
    headers.pop("Idempotency-Key", None)
    headers.pop(service_auth.IDEMPOTENCY_KEY_HEADER, None)

    with patch("v1.prompt_proposals.router.propose") as propose:
        response = client.post(TARGET, content=raw, headers=headers)

    assert response.status_code == 400
    propose.assert_not_called()


def test_a_signed_call_gets_the_proposal_for_the_acting_admin(client):
    with patch("v1.prompt_proposals.router.propose", return_value=PROPOSAL) as propose:
        response = post(client, acting="admin-7")

    assert response.status_code == 200
    assert response.json()["rationale"] == "Menambah pertanyaan penjelasan."
    assert propose.call_args.kwargs["subject"] == "admin-7"
    assert propose.call_args.args[0].name == "tutor-chat"


def test_a_body_with_a_field_the_contract_does_not_know_is_refused(client):
    with patch("v1.prompt_proposals.router.propose") as propose:
        response = post(client, payload={**BODY, "userInput": "what the learner typed"})

    assert response.status_code == 422
    propose.assert_not_called()


def test_a_rejected_proposal_answers_422_with_the_problems(client):
    with patch("v1.prompt_proposals.router.propose", side_effect=ProposalRejected(["A protected sentence was removed: x"])):
        response = post(client)

    assert response.status_code == 422
    assert response.json()["details"]["problems"] == ["A protected sentence was removed: x"]


def test_a_failing_model_answers_503(client):
    with patch("v1.prompt_proposals.router.propose", side_effect=LLMError("down")):
        response = post(client)

    assert response.status_code == 503
