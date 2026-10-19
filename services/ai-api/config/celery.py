"""Celery configuration for AI pipeline workers.

Broker & backend default ke environment variable agar bisa di-override
dari docker-compose / .env. Fallback ``redis://localhost:6379/0`` tetap
disediakan untuk development di host langsung (tanpa Docker).
"""
import os
from celery import Celery
from celery.signals import worker_init


def _broker_url() -> str:
    return os.getenv(
        "CELERY_BROKER_URL",
        os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    )


def _result_backend() -> str:
    return os.getenv(
        "CELERY_RESULT_BACKEND",
        os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    )


DEFAULT_QUEUE = "celery"
CHAT_QUEUE = "chat"
CHAT_TASKS = (
    "v1.learning.generate_new_content",
    "v1.learning.run_chat_action",
)

celery_app = Celery(
    "worker",
    broker=_broker_url(),
    backend=_result_backend(),
    include=[
        "v1.resources.workers",
        "v1.users_steps.workers",
        "v1.learning.workers",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_default_queue=DEFAULT_QUEUE,
    task_routes={name: {"queue": CHAT_QUEUE} for name in CHAT_TASKS},
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
)


@celery_app.on_after_configure.connect
def debug_startup(sender, **kwargs):
    print("[CELERY] Worker started, included modules:", sender.conf.include)
    print(f"[CELERY] Broker: {sender.conf.broker_url}")


@worker_init.connect
def preload_local_embedding(**kwargs):
    from config.envs import ENVS

    if ENVS["EMBEDDING_PROVIDER"] != "local" or not ENVS["LOCAL_EMBEDDING_PRELOAD"]:
        return
    from config.embedding_pipeline import embed_model

    embed_model.warm_up()
