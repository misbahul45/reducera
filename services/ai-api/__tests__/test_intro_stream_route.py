from __future__ import annotations

import asyncio
import inspect
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from v1.users_steps.streaming import FinalEvent, SourcesEvent, StageEvent

CALLER = {"id": "user-a", "role": "STUDENT"}
HEADERS = {"Authorization": "Bearer ok", "Idempotency-Key": "idem-key-intro-1"}
QUERY = "lessonId=lesson-1&topicId=topic-1&learningStyleId=style-1&userId=user-a"
CITATION = {"index": 1, "kind": "TOPIC", "title": "Topik: Akuntansi Dasar", "refType": "TOPIC", "refId": "t1"}


def _profile() -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.ok = True
    response.json.return_value = {"data": CALLER}
    return response


@pytest.fixture()
def client():
    import main

    with TestClient(main.app) as test_client:
        yield test_client


async def _good_stream(*args, **kwargs):
    yield StageEvent("context", "done", {"steps": 1})
    yield SourcesEvent([CITATION])
    yield "Akuntansi mencatat transaksi [1]. "
    yield FinalEvent("Akuntansi mencatat transaksi [1].", [CITATION])


async def _empty_stream(*args, **kwargs):
    yield StageEvent("context", "done", {"steps": 1})
    yield FinalEvent("", [])


def _events(response) -> list[tuple[str, str]]:
    found, name = [], None
    for line in response.text.splitlines():
        if line.startswith("event:"):
            name = line.split(":", 1)[1].strip()
        elif line.startswith("data:") and name:
            found.append((name, line.split(":", 1)[1].strip()))
    return found


class Harness:
    def __init__(self, stream=_good_stream, locks=None, quiz_exists=False, owner=True):
        self.quiz_exists = quiz_exists
        self.locks = locks if locks is not None else {"quiz": True}
        self.owner = list(owner) if isinstance(owner, (list, tuple)) else [owner]
        self.claimed: list[str] = []
        self.unlocked: list[str] = []
        self.renewed: list[str] = []
        self.api = MagicMock()
        self.quiz = MagicMock()
        self.stream = stream

    def _claim(self, kind, *args):
        self.claimed.append(kind)
        return "token-new"

    def _owns(self, kind, user_id, lesson_id, token):
        return self.owner.pop(0) if len(self.owner) > 1 else self.owner[0]

    def __enter__(self):
        self.patches = [
            patch("config.user_auth.requests.get", return_value=_profile()),
            patch("v1.users_steps.router._lock", side_effect=lambda kind, *a: self.locks[kind]),
            patch("v1.users_steps.router._unlock", side_effect=lambda *a: None),
            patch("v1.users_steps.router._claim", side_effect=self._claim),
            patch("v1.users_steps.router._owns", side_effect=self._owns),
            patch("v1.users_steps.router._release_owned", side_effect=lambda kind, *a: self.unlocked.append(kind)),
            patch("v1.users_steps.router._renew_owned", side_effect=lambda kind, *a: self.renewed.append(kind)),
            patch("v1.users_steps.router.generate_personality_quiz", self.quiz),
            patch("v1.users_steps.router.get_steps", return_value=[SimpleNamespace(title="Apa itu akuntansi", description="d")]),
            patch("v1.users_steps.router.get_learning_style", return_value=None),
            patch("v1.users_steps.router.InternalApiClient", return_value=self.api),
            patch("v1.users_steps.router._quiz_exists", return_value=self.quiz_exists),
            patch("v1.users_steps.service.build_learning_introduction_llm", self.stream),
        ]
        for item in self.patches:
            item.start()
        return self

    def __exit__(self, *exc):
        for item in self.patches:
            item.stop()


def test_a_newer_request_takes_over_so_the_older_stream_stops_without_saving_anything(client):
    with Harness(owner=False) as h:
        response = client.get(f"/ai/v1/users-steps/generate-question?{QUERY}", headers=HEADERS)

    names = [name for name, _ in _events(response) if name != "status"]
    assert names == ["superseded"]
    h.api.put.assert_not_called()


def test_every_request_claims_the_lesson_instead_of_waiting_behind_an_older_one(client):
    with Harness() as h:
        client.get(f"/ai/v1/users-steps/generate-question?{QUERY}", headers=HEADERS)

    assert h.claimed == ["intro"]


def test_losing_the_lesson_right_before_saving_drops_the_text_instead_of_overwriting_the_newer_one(client):
    with Harness(owner=[True, True, False]) as h:
        response = client.get(f"/ai/v1/users-steps/generate-question?{QUERY}", headers=HEADERS)

    names = [name for name, _ in _events(response)]
    assert names[-1] == "superseded" and "end" not in names
    h.api.put.assert_not_called()


def test_the_quiz_is_queued_once_even_when_the_introduction_is_asked_again(client):
    with Harness(locks={"quiz": False}) as h:
        client.get(f"/ai/v1/users-steps/generate-question?{QUERY}", headers=HEADERS)

    h.quiz.delay.assert_not_called()


def test_the_first_request_queues_the_quiz_streams_and_saves_the_verified_text_on_the_server(client):
    with Harness() as h:
        response = client.get(f"/ai/v1/users-steps/generate-question?{QUERY}", headers=HEADERS)

    names = [name for name, _ in _events(response) if name != "status"]
    assert names[:2] == ["stage", "sources"] and names[-1] == "end"
    assert "introduction_chunk" in names
    h.quiz.delay.assert_called_once()

    path = h.api.put.call_args.args[0]
    body = h.api.put.call_args.kwargs["json_body"]
    assert path == "/internal/lessons/lesson-1/introduction"
    assert body == {"introduction": "Akuntansi mencatat transaksi [1].", "citations": [CITATION]}

    end = json.loads(dict(_events(response))["end"])
    assert end == {"text": "Akuntansi mencatat transaksi [1].", "citations": [CITATION], "persisted": True}
    assert h.unlocked == ["intro"]


def test_when_the_text_could_not_be_saved_the_learner_is_told_so_instead_of_losing_it_silently(client):
    with Harness() as h:
        h.api.put.side_effect = RuntimeError("api down")
        response = client.get(f"/ai/v1/users-steps/generate-question?{QUERY}", headers=HEADERS)

    end = json.loads(dict(_events(response))["end"])
    assert end["persisted"] is False and end["text"]


def test_an_empty_introduction_is_an_error_and_frees_the_lock_so_the_learner_can_retry(client):
    with Harness(stream=_empty_stream) as h:
        response = client.get(f"/ai/v1/users-steps/generate-question?{QUERY}", headers=HEADERS)

    assert [name for name, _ in _events(response)][-1] == "error"
    h.api.put.assert_not_called()
    assert h.unlocked == ["intro"]


def test_a_failing_upstream_read_frees_the_lock_and_answers_400(client):
    with Harness() as h:
        with patch("v1.users_steps.router.get_steps", side_effect=RuntimeError("down")):
            response = client.get(f"/ai/v1/users-steps/generate-question?{QUERY}", headers=HEADERS)

    assert response.status_code == 400
    assert h.unlocked == ["intro"]


async def _stalled_stream(*args, **kwargs):
    yield StageEvent("context", "done", {"steps": 1})
    await asyncio.sleep(30)
    yield FinalEvent("Tidak pernah sampai.", [])


def _open_stream_directly():
    from v1.users_steps import router

    endpoint = inspect.unwrap(router.generate_question_sse)
    request = SimpleNamespace(state=SimpleNamespace(idempotency_key="idem-key-intro-1", trace_id="trace-1"))
    return endpoint(
        request=request,
        lessonId="lesson-1",
        topicId="topic-1",
        learningStyleId="style-1",
        userId="user-a",
        user=CALLER,
    )


def test_a_learner_who_leaves_mid_stream_frees_the_lock_so_a_reload_can_start_again():
    async def scenario():
        response = await _open_stream_directly()
        iterator = response.body_iterator
        await iterator.__anext__()
        await iterator.__anext__()
        await iterator.aclose()

    with Harness(stream=_stalled_stream) as h:
        asyncio.run(scenario())

    assert h.unlocked == ["intro"]


def test_the_lock_is_renewed_on_every_stage_so_a_live_stream_keeps_it_and_a_dead_one_loses_it(client):
    with Harness() as h:
        client.get(f"/ai/v1/users-steps/generate-question?{QUERY}", headers=HEADERS)

    assert h.renewed == ["intro", "intro"]


def test_a_quiz_queue_that_fails_frees_the_lock_instead_of_blocking_the_lesson_for_minutes(client):
    with Harness() as h:
        h.quiz.delay.side_effect = RuntimeError("broker down")
        response = client.get(f"/ai/v1/users-steps/generate-question?{QUERY}", headers=HEADERS)

    assert response.status_code == 400
    assert h.unlocked.count("intro") == 1


def test_a_quiz_that_already_exists_is_not_queued_again_even_when_the_lock_has_expired(client):
    with Harness(quiz_exists=True) as h:
        client.get(f"/ai/v1/users-steps/generate-question?{QUERY}", headers=HEADERS)

    h.quiz.delay.assert_not_called()


BODY = {"lessonId": "lesson-1", "topicId": "topic-1", "learningStyleId": "style-1"}


def _post(client, body=None, headers=None):
    return client.post("/ai/v1/users-steps/personality-quiz", json=BODY if body is None else body, headers=headers or HEADERS)


def test_the_quiz_alone_can_be_queued_again_without_touching_the_introduction(client):
    with Harness() as h:
        response = _post(client)

    assert response.status_code == 200 and response.json()["status"] == "queued"
    h.quiz.delay.assert_called_once()
    h.api.put.assert_not_called()
    assert h.quiz.delay.call_args.args[0]["lessonId"] == "lesson-1"
    assert h.quiz.delay.call_args.args[0]["userId"] == "user-a"


def test_asking_again_while_the_quiz_is_running_or_already_there_queues_nothing(client):
    with Harness(locks={"quiz": False}) as running:
        assert _post(client).json()["status"] == "running"
    running.quiz.delay.assert_not_called()

    with Harness(quiz_exists=True) as existing:
        assert _post(client).json()["status"] == "exists"
    existing.quiz.delay.assert_not_called()


def test_the_request_needs_the_three_ids_and_authentication_and_cannot_act_as_another_user(client):
    with Harness() as h:
        assert _post(client, {"lessonId": "lesson-1"}).status_code == 422
        assert _post(client, {**BODY, "userId": "victim"}).status_code == 403
        assert client.post("/ai/v1/users-steps/personality-quiz", json=BODY, headers={"Idempotency-Key": "idem-key-intro-1"}).status_code == 401
    h.quiz.delay.assert_not_called()
