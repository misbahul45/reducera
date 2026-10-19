from __future__ import annotations

from typing import Any, Iterable, Mapping

from v1.episodes.dto import EpisodeCitation
from v1.learning.dto import CitationDto


def citation_of(result: Mapping[str, Any]) -> CitationDto | None:
    metadata = result.get("metadata", {}) or {}
    score = float(result.get("score", 0.0))
    concept_ids = metadata.get("concept_ids") or []
    if score <= 0.0:
        return None
    if not (metadata.get("lesson_id") or concept_ids or metadata.get("resource_id")):
        return None
    return CitationDto(
        lesson_id=metadata.get("lesson_id"),
        concept_id=concept_ids[0] if concept_ids else None,
        resource_id=metadata.get("resource_id"),
        chunk_id=metadata.get("chunk_id"),
        score=score,
        source=metadata.get("source", "reducera-embedding"),
        snippet=(result.get("text", "") or "")[:200],
    )


def citations_of(results: Iterable[Mapping[str, Any]]) -> list[CitationDto]:
    found: list[CitationDto] = []
    for result in results:
        try:
            citation = citation_of(result)
        except Exception:
            continue
        if citation is not None:
            found.append(citation)
    return found


def _topic_chunk(item: Mapping[str, Any]) -> str | None:
    ref_type, ref_id = item.get("refType"), item.get("refId")
    return f"{ref_type}:{ref_id}" if ref_type and ref_id else None


def episode_citations(items: Iterable[CitationDto | Mapping[str, Any]], lesson_id: str | None = None) -> list[EpisodeCitation]:
    cited: list[EpisodeCitation] = []
    for item in items:
        if isinstance(item, CitationDto):
            data = item.model_dump(by_alias=False)
        else:
            topic_chunk = _topic_chunk(item)
            data = {
                "lesson_id": item.get("lessonId") or item.get("lesson_id") or (lesson_id if topic_chunk else None),
                "chunk_id": item.get("chunkId") or item.get("chunk_id") or topic_chunk,
                "score": item.get("score"),
                "source": item.get("source") or ("topic-database" if item.get("kind") == "TOPIC" else None),
            }
        if not data.get("lesson_id"):
            continue
        cited.append(
            EpisodeCitation(
                lesson_id=data["lesson_id"],
                chunk_id=data.get("chunk_id"),
                score=data.get("score"),
                source=data.get("source"),
            )
        )
    return cited


__all__ = ["citation_of", "citations_of", "episode_citations"]
