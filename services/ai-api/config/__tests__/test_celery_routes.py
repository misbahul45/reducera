from __future__ import annotations

import importlib

from config.celery import CHAT_QUEUE, CHAT_TASKS, DEFAULT_QUEUE, celery_app


def _queue_of(task_name: str) -> str:
    return celery_app.amqp.router.route({}, task_name)["queue"].name


def test_chat_replies_and_chat_actions_have_a_queue_of_their_own():
    assert {_queue_of(name) for name in CHAT_TASKS} == {CHAT_QUEUE}


def test_heavy_background_work_never_shares_the_chat_queue():
    heavy = [
        "v1.learning.generate_content_material",
        "v1.user_steps.generate_personality_quiz",
        "v1.resources.workers.extract_task",
        "v1.resources.workers.embedding_task",
    ]

    assert {_queue_of(name) for name in heavy} == {DEFAULT_QUEUE}


def test_every_registered_task_is_routed_somewhere_known():
    for module in ("v1.learning.workers", "v1.resources.workers", "v1.users_steps.workers"):
        importlib.import_module(module)

    names = [name for name in celery_app.tasks if name.startswith("v1.")]

    assert names
    assert {_queue_of(name) for name in names} <= {DEFAULT_QUEUE, CHAT_QUEUE}
    assert set(CHAT_TASKS) <= set(names)
