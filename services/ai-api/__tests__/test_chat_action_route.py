from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

CALLER = {"id": "user-a", "role": "STUDENT"}
IDEMPOTENCY = {"Idempotency-Key": "idem-key-654321"}
BODY = {"chatId": "c1", "messageId": "m1", "userStepId": "s1", "action": {"type": "QUIZ", "count": 5}}


def _profile_response(status: int = 200) -> MagicMock:
    response = MagicMock()
    response.status_code = status
    response.ok = 200 <= status < 300
    response.json.return_value = {"data": CALLER}
    return response


@pytest.fixture()
def client():
    import main

    with TestClient(main.app) as test_client:
        yield test_client


def _post(client, *, headers=None, body=None):
    return client.post("/ai/v1/learning/chat/action", json=body or BODY, headers={**IDEMPOTENCY, **(headers or {})})


def test_it_rejects_a_caller_with_no_credentials(client):
    with patch("v1.learning.router.run_chat_action_task") as task:
        response = _post(client)

    assert response.status_code == 401
    task.delay.assert_not_called()


def test_it_rejects_acting_as_another_user(client):
    with patch("config.user_auth.requests.get", return_value=_profile_response()), patch("v1.learning.router.run_chat_action_task") as task:
        response = _post(client, headers={"Authorization": "Bearer ok"}, body={**BODY, "userId": "victim"})

    assert response.status_code == 403
    task.delay.assert_not_called()


@pytest.mark.parametrize(
    "action",
    [{"type": "NOTE", "title": "t", "body": "b"}, {"type": "OPEN_QUIZ", "quizId": "x"}, {"type": "QUIZ", "count": 99}, {"type": "QUIZ", "count": 5, "userId": "x"}, "QUIZ", None],
)
def test_it_refuses_an_action_the_server_does_not_run(client, action):
    with patch("config.user_auth.requests.get", return_value=_profile_response()), patch("v1.learning.router.run_chat_action_task") as task:
        response = _post(client, headers={"Authorization": "Bearer ok"}, body={**BODY, "action": action})

    assert response.status_code == 422
    task.delay.assert_not_called()


def test_it_needs_an_idempotency_key(client):
    with patch("config.user_auth.requests.get", return_value=_profile_response()), patch("v1.learning.router.run_chat_action_task") as task:
        response = client.post("/ai/v1/learning/chat/action", json=BODY, headers={"Authorization": "Bearer ok"})

    assert response.status_code == 400
    task.delay.assert_not_called()


def test_it_queues_the_validated_action_for_the_authenticated_user(client):
    with patch("config.user_auth.requests.get", return_value=_profile_response()), patch("v1.learning.router.run_chat_action_task") as task:
        task.delay.return_value = MagicMock(id="task-7")
        response = _post(client, headers={"Authorization": "Bearer ok"})

    assert response.status_code == 200
    assert response.json()["status"] == "processing"
    payload = task.delay.call_args.args[0]
    assert payload["acting_user_id"] == "user-a"
    assert payload["action"] == {"type": "QUIZ", "count": 5}
    assert (payload["chatId"], payload["userStepId"], payload["messageId"]) == ("c1", "s1", "m1")
