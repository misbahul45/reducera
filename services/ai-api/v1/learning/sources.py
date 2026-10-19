from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable, Mapping
from urllib.parse import urlparse

from config.prompt_segmentation import segment_retrieved

MAX_MATERIAL_SOURCES = 6
MAX_WEB_SOURCES = 4
SNIPPET_LENGTH = 240
TITLE_LENGTH = 120
DERIVED_TITLE_LENGTH = 70
MATERIAL_FALLBACK_TITLE = "Materi ReduCera"

KIND_MATERIAL = "MATERIAL"
KIND_WEB = "WEB"
KIND_TOPIC = "TOPIC"

CITATION_MARKER = re.compile(r"(\s?)\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()")


@dataclass(frozen=True)
class Source:
    index: int
    kind: str
    title: str
    text: str
    url: str | None = None
    lesson_id: str | None = None
    ref_type: str | None = None
    ref_id: str | None = None
    via: tuple[str, ...] = ()

    def as_citation(self) -> dict[str, Any]:
        citation: dict[str, Any] = {"index": self.index, "kind": self.kind, "title": self.title}
        snippet = " ".join(self.text.split())[:SNIPPET_LENGTH]
        if snippet:
            citation["snippet"] = snippet
        if self.kind == KIND_WEB and self.url:
            citation["url"] = self.url
        if self.lesson_id:
            citation["lessonId"] = self.lesson_id[:64]
        if self.ref_type and self.ref_id:
            citation["refType"] = self.ref_type
            citation["refId"] = self.ref_id[:64]
        if self.via:
            citation["via"] = list(self.via)
        return citation


def _clean(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit].strip()


def material_title(result: Mapping[str, Any]) -> str:
    metadata = result.get("metadata") or {}
    for key in ("title", "lesson_title", "resource_title"):
        title = _clean(metadata.get(key), TITLE_LENGTH)
        if title:
            return title
    text = _clean(result.get("text"), DERIVED_TITLE_LENGTH)
    return f"{MATERIAL_FALLBACK_TITLE}: {text}…" if text else MATERIAL_FALLBACK_TITLE


def web_title(item: Mapping[str, Any]) -> str:
    title = _clean(item.get("title"), TITLE_LENGTH)
    if title:
        return title
    return urlparse(str(item.get("url") or "")).netloc[:TITLE_LENGTH] or "Sumber web"


def build_sources(rag_results: Iterable[Mapping[str, Any]], web_results: Iterable[Mapping[str, Any]]) -> list[Source]:
    sources: list[Source] = []
    for result in rag_results or []:
        text = str(result.get("text") or "").strip()
        if not text or len([s for s in sources if s.kind == KIND_MATERIAL]) >= MAX_MATERIAL_SOURCES:
            continue
        lesson_id = (result.get("metadata") or {}).get("lesson_id")
        sources.append(
            Source(
                index=len(sources) + 1,
                kind=KIND_MATERIAL,
                title=material_title(result),
                text=text,
                lesson_id=str(lesson_id) if lesson_id else None,
            )
        )
    for item in web_results or []:
        url = str(item.get("url") or "")
        if not url.lower().startswith(("http://", "https://")) or len([s for s in sources if s.kind == KIND_WEB]) >= MAX_WEB_SOURCES:
            continue
        sources.append(
            Source(index=len(sources) + 1, kind=KIND_WEB, title=web_title(item), text=str(item.get("snippet") or ""), url=url[:500])
        )
    return sources


def render_sources(sources: Iterable[Source], kind: str | tuple[str, ...]) -> str:
    kinds = (kind,) if isinstance(kind, str) else kind
    chosen = [source for source in sources if source.kind in kinds]
    rendered = []
    for source in chosen:
        origin = "tavily-web" if source.kind == KIND_WEB else "topic-database" if source.kind == KIND_TOPIC else "reducera-embedding"
        rendered.append(
            segment_retrieved([{"id": str(source.index), "text": f"{source.title}\n{source.text}"}], source=origin, trust="derived" if source.kind == KIND_TOPIC else "untrusted")
        )
    return "\n\n".join(rendered)


def apply_citations(text: str, sources: Iterable[Source]) -> tuple[str, list[dict[str, Any]]]:
    by_index = {source.index: source for source in sources}
    used: list[int] = []

    def known_numbers(match: re.Match[str]) -> list[int]:
        numbers = [int(part) for part in re.split(r"\s*,\s*", match.group(2))]
        return [number for number in dict.fromkeys(numbers) if number in by_index]

    def register(match: re.Match[str]) -> str:
        for number in known_numbers(match):
            if number not in used:
                used.append(number)
        return match.group(0)

    CITATION_MARKER.sub(register, text or "")
    renumbered = {old: position for position, old in enumerate(used, start=1)}

    def replace(match: re.Match[str]) -> str:
        valid = [renumbered[number] for number in known_numbers(match)]
        if not valid:
            return ""
        return f"{match.group(1)}[{', '.join(str(number) for number in dict.fromkeys(valid))}]"

    cleaned = CITATION_MARKER.sub(replace, text or "")
    citations = [{**by_index[number].as_citation(), "index": renumbered[number]} for number in used]
    return cleaned, citations


__all__ = [
    "KIND_MATERIAL",
    "KIND_TOPIC",
    "KIND_WEB",
    "Source",
    "apply_citations",
    "build_sources",
    "render_sources",
]
