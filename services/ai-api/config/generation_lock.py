from __future__ import annotations

import logging
import uuid

from config.redis_client import get_redis_client

logger = logging.getLogger(__name__)

RELEASE_IF_OWNER = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0"
RENEW_IF_OWNER = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) end return 0"


def _key(kind: str, user_id: str, lesson_id: str) -> str:
    return f"gen:{kind}:{user_id}:{lesson_id}"


def acquire(kind: str, user_id: str, lesson_id: str, seconds: int) -> bool:
    try:
        return bool(get_redis_client().set(_key(kind, user_id, lesson_id), "1", nx=True, ex=seconds))
    except Exception:
        logger.warning("[LOCK] redis is unreachable, generation is not guarded", exc_info=True)
        return True


def release(kind: str, user_id: str, lesson_id: str) -> None:
    try:
        get_redis_client().delete(_key(kind, user_id, lesson_id))
    except Exception:
        logger.warning("[LOCK] the lock could not be released and will expire", exc_info=True)


def claim(kind: str, user_id: str, lesson_id: str, seconds: int) -> str:
    token = uuid.uuid4().hex
    try:
        get_redis_client().set(_key(kind, user_id, lesson_id), token, ex=seconds)
    except Exception:
        logger.warning("[LOCK] redis is unreachable, generation is not guarded", exc_info=True)
    return token


def owns(kind: str, user_id: str, lesson_id: str, token: str) -> bool:
    try:
        return get_redis_client().get(_key(kind, user_id, lesson_id)) == token
    except Exception:
        logger.warning("[LOCK] ownership could not be checked, assuming it is still held", exc_info=True)
        return True


def release_owned(kind: str, user_id: str, lesson_id: str, token: str) -> None:
    try:
        get_redis_client().eval(RELEASE_IF_OWNER, 1, _key(kind, user_id, lesson_id), token)
    except Exception:
        logger.warning("[LOCK] the lock could not be released and will expire", exc_info=True)


def renew_owned(kind: str, user_id: str, lesson_id: str, token: str, seconds: int) -> None:
    try:
        get_redis_client().eval(RENEW_IF_OWNER, 1, _key(kind, user_id, lesson_id), token, seconds)
    except Exception:
        logger.warning("[LOCK] the lock could not be renewed and will expire", exc_info=True)


__all__ = ["acquire", "claim", "owns", "release", "release_owned", "renew_owned"]
