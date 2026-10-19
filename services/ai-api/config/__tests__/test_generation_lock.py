from __future__ import annotations

import pytest

from config import generation_lock, redis_client
from config.redis_client import configure_redis_client


@pytest.fixture(autouse=True)
def restore_redis_client():
    previous = redis_client._client
    yield
    redis_client._client = previous


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}
        self.ttl: dict[str, int] = {}

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.store:
            return None
        self.store[key] = value
        if ex is not None:
            self.ttl[key] = ex
        return True

    def get(self, key):
        return self.store.get(key)

    def delete(self, key):
        return 1 if self.store.pop(key, None) is not None else 0

    def eval(self, script, numkeys, key, *args):
        token = args[0]
        if self.store.get(key) != token:
            return 0
        if script == generation_lock.RELEASE_IF_OWNER:
            del self.store[key]
            return 1
        self.ttl[key] = int(args[1])
        return 1


class BrokenRedis:
    def __getattr__(self, name):
        raise ConnectionError("redis is down")


def _use(client):
    configure_redis_client(client)
    return client


def test_a_newer_claim_takes_the_lesson_over_and_the_older_owner_notices():
    redis = _use(FakeRedis())

    older = generation_lock.claim("intro", "u1", "l1", 120)
    newer = generation_lock.claim("intro", "u1", "l1", 120)

    assert older != newer
    assert not generation_lock.owns("intro", "u1", "l1", older)
    assert generation_lock.owns("intro", "u1", "l1", newer)
    assert redis.ttl["gen:intro:u1:l1"] == 120


def test_the_older_owner_cannot_free_or_extend_the_lock_of_the_newer_one():
    redis = _use(FakeRedis())
    older = generation_lock.claim("intro", "u1", "l1", 120)
    newer = generation_lock.claim("intro", "u1", "l1", 120)

    generation_lock.release_owned("intro", "u1", "l1", older)
    generation_lock.renew_owned("intro", "u1", "l1", older, 999)

    assert generation_lock.owns("intro", "u1", "l1", newer)
    assert redis.ttl["gen:intro:u1:l1"] == 120


def test_the_owner_frees_and_extends_its_own_lock():
    redis = _use(FakeRedis())
    token = generation_lock.claim("intro", "u1", "l1", 120)

    generation_lock.renew_owned("intro", "u1", "l1", token, 90)
    assert redis.ttl["gen:intro:u1:l1"] == 90

    generation_lock.release_owned("intro", "u1", "l1", token)
    assert "gen:intro:u1:l1" not in redis.store


def test_locks_of_different_lessons_and_kinds_do_not_touch_each_other():
    redis = _use(FakeRedis())
    first = generation_lock.claim("intro", "u1", "l1", 120)
    generation_lock.claim("intro", "u1", "l2", 120)
    assert generation_lock.acquire("quiz", "u1", "l1", 900)
    assert not generation_lock.acquire("quiz", "u1", "l1", 900)

    assert generation_lock.owns("intro", "u1", "l1", first)
    assert len(redis.store) == 3


def test_when_redis_is_down_generation_still_runs_and_nothing_raises():
    _use(BrokenRedis())

    token = generation_lock.claim("intro", "u1", "l1", 120)

    assert token
    assert generation_lock.owns("intro", "u1", "l1", token)
    generation_lock.release_owned("intro", "u1", "l1", token)
    generation_lock.renew_owned("intro", "u1", "l1", token, 10)
    assert generation_lock.acquire("quiz", "u1", "l1", 900)
