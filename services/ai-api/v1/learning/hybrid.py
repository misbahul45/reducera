from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from v1.learning.sources import (
    KIND_MATERIAL,
    KIND_TOPIC,
    KIND_WEB,
    MAX_MATERIAL_SOURCES,
    MAX_WEB_SOURCES,
    Source,
    material_title,
    web_title,
)

MAX_TOTAL_SOURCES = 10
KIND_ORDER = {KIND_TOPIC: 0, KIND_MATERIAL: 1, KIND_WEB: 2}
TOPIC_FLOOR = 3
RRF_K = 60
BM25_K1 = 1.5
BM25_B = 0.75
WEIGHT_LEXICAL = 1.0
WEIGHT_SEMANTIC = 1.0
WEIGHT_WEB = 0.6
MIN_TOKEN = 3
MIN_STEM = 4

VIA_LEXICAL = "LEXICAL"
VIA_SEMANTIC = "SEMANTIC"
VIA_WEB = "WEB"
VIA_SCOPE = "SCOPE"

STOPWORDS = frozenset(
    "yang dan di ke dari untuk dengan pada adalah itu ini atau juga akan dapat dalam oleh sebagai karena agar bisa "
    "apa siapa kapan mengapa bagaimana tidak ada para suatu saya aku kamu anda kita mereka the and for with that this are was from".split()
)
PREFIXES = ("meng", "meny", "mem", "men", "me", "ber", "ter", "per", "pen", "peng", "di", "ke", "se")
SUFFIXES = ("kan", "an", "i", "nya", "lah")

_WORD = re.compile(r"[^\W_]+", re.UNICODE)


def _stem(word: str) -> str:
    for suffix in SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= MIN_STEM:
            word = word[: -len(suffix)]
            break
    for prefix in PREFIXES:
        if word.startswith(prefix) and len(word) - len(prefix) >= MIN_STEM:
            word = word[len(prefix) :]
            break
    return word


def tokenize(text: str) -> list[str]:
    tokens = []
    for match in _WORD.finditer((text or "").lower()):
        word = match.group(0)
        if len(word) < MIN_TOKEN or word in STOPWORDS or word.isdigit():
            continue
        tokens.append(_stem(word))
    return tokens


def bm25(query: list[str], documents: list[list[str]]) -> list[float]:
    if not query or not documents:
        return [0.0] * len(documents)
    count = len(documents)
    average = sum(len(document) for document in documents) / count or 1.0
    frequency = Counter(token for document in documents for token in set(document))
    scores = []
    for document in documents:
        counts = Counter(document)
        length = len(document) or 1
        score = 0.0
        for token in set(query):
            tf = counts.get(token, 0)
            if tf == 0:
                continue
            idf = math.log(1 + (count - frequency[token] + 0.5) / (frequency[token] + 0.5))
            score += idf * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * length / average))
        scores.append(score)
    return scores


def rrf(rankings: Iterable[tuple[float, list[str]]]) -> dict[str, float]:
    fused: dict[str, float] = {}
    for weight, ranking in rankings:
        for position, key in enumerate(ranking, start=1):
            fused[key] = fused.get(key, 0.0) + weight / (RRF_K + position)
    return fused


@dataclass
class _Candidate:
    key: str
    kind: str
    title: str
    text: str
    url: str | None = None
    lesson_id: str | None = None
    ref_type: str | None = None
    ref_id: str | None = None
    via: set[str] | None = None

    def add_via(self, value: str) -> None:
        self.via = (self.via or set()) | {value}


def _topic_candidates(topic: Iterable[Mapping[str, Any]]) -> list[_Candidate]:
    found = []
    for item in topic or []:
        text = str(item.get("text") or "").strip()
        ref_id = str(item.get("refId") or "")
        if not text or not ref_id:
            continue
        found.append(
            _Candidate(
                key=f"topic:{ref_id}",
                kind=KIND_TOPIC,
                title=" ".join(str(item.get("title") or "Sumber topik").split())[:120],
                text=text,
                ref_type=str(item.get("refType") or "")[:20] or None,
                ref_id=ref_id,
            )
        )
    return found


def rank_hybrid(
    query: str,
    topic: Iterable[Mapping[str, Any]],
    rag_results: Iterable[Mapping[str, Any]] = (),
    web_results: Iterable[Mapping[str, Any]] = (),
    *,
    include_web: bool = False,
    max_total: int = MAX_TOTAL_SOURCES,
    topic_floor: int = TOPIC_FLOOR,
) -> list[Source]:
    candidates = _topic_candidates(topic)
    by_key = {candidate.key: candidate for candidate in candidates}
    by_resource = {candidate.ref_id: candidate for candidate in candidates if candidate.ref_type == "RESOURCE"}

    query_tokens = tokenize(query)
    scores = bm25(query_tokens, [tokenize(f"{candidate.title} {candidate.text}") for candidate in candidates])
    lexical = [candidates[i].key for i in sorted(range(len(candidates)), key=lambda i: -scores[i]) if scores[i] > 0]
    for key in lexical:
        by_key[key].add_via(VIA_LEXICAL)

    semantic: list[str] = []
    for index, result in enumerate(rag_results or []):
        text = str(result.get("text") or "").strip()
        if not text:
            continue
        metadata = result.get("metadata") or {}
        resource_id = str(metadata.get("resource_id") or "")
        match = by_resource.get(resource_id)
        if match is not None:
            match.add_via(VIA_SEMANTIC)
            semantic.append(match.key)
            continue
        if len([key for key in by_key if by_key[key].kind == KIND_MATERIAL]) >= MAX_MATERIAL_SOURCES:
            continue
        key = f"rag:{metadata.get('chunk_id') or index}"
        if key in by_key:
            continue
        lesson_id = metadata.get("lesson_id")
        candidate = _Candidate(
            key=key,
            kind=KIND_MATERIAL,
            title=material_title(result),
            text=text,
            lesson_id=str(lesson_id) if lesson_id else None,
            via={VIA_SEMANTIC},
        )
        by_key[key] = candidate
        semantic.append(key)

    web: list[str] = []
    if include_web:
        for index, item in enumerate(web_results or []):
            url = str(item.get("url") or "")
            if not url.lower().startswith(("http://", "https://")) or len(web) >= MAX_WEB_SOURCES:
                continue
            key = f"web:{index}"
            by_key[key] = _Candidate(
                key=key,
                kind=KIND_WEB,
                title=web_title(item),
                text=str(item.get("snippet") or ""),
                url=url[:500],
                via={VIA_WEB},
            )
            web.append(key)

    fused = rrf([(WEIGHT_LEXICAL, lexical), (WEIGHT_SEMANTIC, semantic), (WEIGHT_WEB, web)])
    ranked = sorted(fused, key=lambda key: -fused[key])

    topic_keys = [candidate.key for candidate in candidates]
    matched_topic = [key for key in ranked if key in by_key and by_key[key].kind == KIND_TOPIC]
    unmatched_topic = [key for key in topic_keys if key not in matched_topic]
    guaranteed = (matched_topic + unmatched_topic)[: min(topic_floor, len(topic_keys))]
    for key in guaranteed:
        if key not in fused:
            by_key[key].add_via(VIA_SCOPE)

    rest = [key for key in ranked if key not in guaranteed]
    chosen = guaranteed + rest[: max(0, max_total - len(guaranteed))]

    ordered = sorted(
        chosen,
        key=lambda key: (KIND_ORDER[by_key[key].kind], -fused.get(key, 0.0), topic_keys.index(key) if key in topic_keys else len(topic_keys)),
    )
    sources = []
    for number, key in enumerate(ordered, start=1):
        candidate = by_key[key]
        sources.append(
            Source(
                index=number,
                kind=candidate.kind,
                title=candidate.title,
                text=candidate.text,
                url=candidate.url,
                lesson_id=candidate.lesson_id,
                ref_type=candidate.ref_type,
                ref_id=candidate.ref_id,
                via=tuple(sorted(candidate.via or ())),
            )
        )
    return sources


__all__ = ["bm25", "rank_hybrid", "rrf", "tokenize"]
