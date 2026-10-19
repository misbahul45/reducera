from __future__ import annotations

import logging
from typing import Optional


from config.agent_session import AgentSession
from config.internal_client import InternalApiClient
from errors.types import CrossServiceError, RetrievalError
from v1.domain.governance import retrieval_scope
from v1.learning.hybrid import rank_hybrid
from v1.learning.sources import KIND_MATERIAL, KIND_TOPIC, apply_citations, render_sources
from v1.learning.topic_sources import fetch_topic_sources
from v1.users_steps.streaming import FinalEvent, SourcesEvent, StageEvent, chunk_text
from v1.users_steps.dto import (
    LearningStyleProfileBase,
    StepBase,
    TopicBase,
)


logger = logging.getLogger(__name__)

def get_steps(lesson_id: str, session: AgentSession) -> list[StepBase]:
    data = InternalApiClient(session).get(
        "/internal/steps",
        params={"lessonId": lesson_id, "sort": "sortOrder:asc"},
    )
    return [StepBase(**item) for item in (data or {}).get("data", [])]


def get_step(step_id: str, session: AgentSession) -> StepBase:
    return StepBase(**InternalApiClient(session).get(f"/internal/steps/{step_id}"))


def get_topic(topic_id: str, session: AgentSession) -> TopicBase:
    data = InternalApiClient(session).get("/curriculum/topics", params={"id": topic_id})
    items = (data or {}).get("data", [])
    if not items:
        raise CrossServiceError("topic not found", details={"topicId": topic_id})
    return TopicBase(**items[0])


def get_learning_style(
    learning_style_id: str, session: AgentSession
) -> LearningStyleProfileBase:
    data = InternalApiClient(session).get(f"/internal/learning-styles/{learning_style_id}")
    return LearningStyleProfileBase(**data)


def create_personality_quiz(payload: dict, session: AgentSession) -> dict:
    return InternalApiClient(session).send(
        "POST", "/internal/personality-quizzes", json_body=payload
    )


def get_personality_quiz(
    lesson_id: str, user_id: str, session: AgentSession
) -> Optional[dict]:
    try:
        data = InternalApiClient(session).get(
            "/internal/personality-quizzes",
            params={"lessonId": lesson_id, "userId": user_id},
        )
    except CrossServiceError as exc:
        logger.error("[PERSONALITY_QUIZ] API Request failed: %s", exc.message)
        return None

    data_list = (data or {}).get("data", [])
    if not data_list:
        logger.warning("[PERSONALITY_QUIZ] No quiz found for user %s", user_id)
        return None
    return data_list[0]


def classify_learning_style(description: str | None) -> Optional[str]:
    if not description:
        return None
    text = description.lower()
    if any(k in text for k in ["lihat", "visual", "gambar", "diagram", "video"]):
        return "visual"
    if any(k in text for k in ["dengar", "audio", "penjelasan lisan", "ceramah"]):
        return "auditory"
    if any(k in text for k in ["baca", "menulis", "catatan", "teks"]):
        return "reading_writing"
    if any(
        k in text
        for k in ["praktek", "langsung", "contoh nyata", "kinestetik", "kinesthetic"]
    ):
        return "kinesthetic"
    return None


NO_INTRO_SOURCES = "[Tidak ada sumber topik di database untuk pelajaran ini]"
INTRO_CITATION_RULES = (
    "- Setiap kalimat faktual diberi penanda sumber berupa nomor dokumen dalam kurung siku, misalnya [2], mengikuti id pada retrieved_document.\n"
    "- Hanya pakai id yang benar-benar ada, jangan membuat id, dan jangan menulis daftar sumber karena aplikasi yang menampilkannya.\n"
    "- Bila sumber tidak memuat sesuatu, jangan mengarangnya.\n"
)


async def build_learning_introduction_llm(
    steps: list,
    pipeline,
    learning_style=None,
    session: AgentSession | None = None,
    lesson_id: str | None = None,
):
    from config.embedding_pipeline import EmbeddingPipeline
    if isinstance(learning_style, dict):
        dominant_style = learning_style.get("dominant_style")
    elif learning_style is not None:
        dominant_style = getattr(learning_style, "dominant_style", None)
    else:
        dominant_style = None

    style = classify_learning_style(dominant_style)

    style_map = {
        "visual": (
            "Gunakan penjelasan yang mudah divisualisasikan, pola yang jelas, "
            "struktur langkah yang rapi, serta asosiasi bentuk atau alur."
        ),
        "auditory": (
            "Gunakan aliran bahasa yang runtut seperti percakapan, ritme kalimat yang enak dibaca, "
            "dan penjelasan yang terasa seperti dijelaskan secara lisan."
        ),
        "reading_writing": (
            "Gunakan struktur kalimat informatif, definisi langsung, bullet point, "
            "dan narasi ringkas yang mudah dipindai pembaca."
        ),
        "kinesthetic": (
            "Gunakan contoh nyata, langkah aplikatif, dan konteks praktis yang dapat dibayangkan "
            "sebagai tindakan dunia nyata."
        ),
    }

    style_prompt = style_map.get(
        style,
        "Gunakan gaya netral, jelas, langsung pada inti, dan mudah dipahami.",
    )

    step_data = [
        {"title": s.title, "description": s.description or ""}
        for s in steps
    ]

    yield StageEvent("context", "done", {"steps": len(steps), "titles": [s.title for s in steps[:3]]})
    yield StageEvent("profile", "done" if style else "skipped", {"style": style})

    scope = retrieval_scope(session.acting_user_id) if session else None
    queries = 0
    failed = 0
    rag_results: list[dict] = []
    for s in steps if scope else []:
        queries += 1
        try:
            results = pipeline.retrieve(query=s.title, scope=scope, top_k=5)
        except RetrievalError as exc:
            logger.warning("[INTRODUCTION] retrieval failed for a step: %s", exc.message)
            failed += 1
            results = []
        rag_results.extend(results)

    topic = fetch_topic_sources(session, lesson_id=lesson_id) if session and lesson_id else {"scope": {}, "sources": []}
    sources = rank_hybrid(
        " ".join(s.title for s in steps),
        topic["sources"],
        rag_results,
        [],
        include_web=False,
    )
    documents = render_sources(sources, (KIND_TOPIC, KIND_MATERIAL)) or NO_INTRO_SOURCES

    retrieval_state = "skipped" if not queries else "failed" if failed == queries else "done"
    topic_count = len([item for item in sources if item.kind == KIND_TOPIC])
    yield StageEvent(
        "retrieval",
        retrieval_state,
        {"queries": queries, "sources": len(sources) - topic_count, "topic": topic_count, "failed": failed},
    )
    yield SourcesEvent([item.as_citation() for item in sources])
    yield StageEvent("writing", "active", {})

    full_prompt = f"""
Kamu adalah AI Educator profesional. Tugasmu adalah membuat pengantar pembelajaran
berdasarkan langkah-langkah berikut:

{step_data}

Gunakan HANYA dokumen bernomor berikut sebagai sumber fakta:
{documents}

=== TUJUAN PENGANTAR ===
1. Menjelaskan isi setiap langkah dengan jelas.
2. Menunjukkan nilai atau manfaat praktis dari setiap langkah.
3. Memberikan gambaran alur pembelajaran.
4. Membuat pembelajar tertarik dan termotivasi.
5. Output dalam format Markdown singkat: satu judul, paragraf pendek, dan paling banyak lima bullet.
6. Panjang keseluruhan 120 sampai 180 kata. Ini pengantar mikro, bukan materi: jangan mengajarkan isi langkah.

=== GAYA PENULISAN ===
{style_prompt}

=== ATURAN PENULISAN TAMBAHAN ===
- Kalimat aktif dan friendly.
- Hindari jargon berlebihan namun tetap profesional.
- Tidak menyebut AI atau proses teknis.
- Buat alurnya ringkas: satu kalimat pembuka yang menarik, nilai praktisnya, lalu urutan langkah belajar.
- Jangan memakai emoji, garis pemisah, atau judul bertingkat.
- Teks harus enak dibaca saat di-streaming per chunk.
- Sertakan informasi bahwa setelah memahami tiap materi, pembelajar akan selalu di-test dengan quiz yang membantu memperdalam pemahaman.
{INTRO_CITATION_RULES}
Instruksi tambahan:
- Hanya gunakan informasi dari steps dan dokumen bernomor.
- Mulai dengan sapaan singkat, akhiri dengan satu kalimat ajakan untuk mulai.
"""

    written: list[str] = []
    stream = pipeline.llm.stream(full_prompt)
    if hasattr(stream, "__aiter__"):
        async for chunk in stream:
            piece = chunk_text(getattr(chunk, "text", None))
            if piece:
                written.append(piece)
                yield piece
    else:
        for chunk in stream:
            piece = chunk_text(getattr(chunk, "text", None))
            if piece:
                written.append(piece)
                yield piece

    final_text, citations = apply_citations("".join(written), sources)
    yield FinalEvent(final_text.strip(), citations)


def extract_quiz(result):
    quiz = result.get("quiz")
    if isinstance(quiz, list) and len(quiz) > 0 and hasattr(quiz[0], "question"):
        return quiz
    return []


async def _load_profile_and_steps(
    session: AgentSession,
    lesson_id: str,
    learning_style_id: str,
    topic_id: str | None = None,
):
    steps = get_steps(lesson_id, session)
    learning_style = get_learning_style(learning_style_id, session)
    topic = get_topic(topic_id, session) if topic_id else None
    return topic, steps, learning_style


__all__ = [
    "get_steps",
    "get_step",
    "get_topic",
    "get_learning_style",
    "create_personality_quiz",
    "get_personality_quiz",
    "classify_learning_style",
    "build_learning_introduction_llm",
    "extract_quiz",
    "_load_profile_and_steps",
]