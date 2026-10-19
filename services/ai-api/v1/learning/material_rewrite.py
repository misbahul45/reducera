from __future__ import annotations

from typing import Any

MATERIAL_CHARS = 6000
RETRIEVED_CHARS = 2500
DEEPEN_EXTRA_WORDS = 150
DEFAULT_WORDS = 400
DEFAULT_EXERCISES = 4

INSTRUCTIONS = {
    "SIMPLIFY": (
        "Rewrite it in simpler words and shorter sentences. Replace jargon with everyday language, "
        "add one everyday analogy, and keep every fact correct."
    ),
    "EXAMPLE": (
        "Keep the explanation but add two concrete worked examples with numbers from real work situations, "
        "solved step by step."
    ),
    "DEEPEN": (
        "Keep the structure but go deeper: add the reasoning behind each rule, one common mistake and how "
        "to avoid it, and one edge case."
    ),
    "SHORTEN": "Cut it down to the essentials: keep only the key points and one example.",
}


def plan_words(plan: dict[str, Any] | None) -> int:
    words = plan.get("targetWords") if isinstance(plan, dict) else None
    return words if isinstance(words, int) and 100 <= words <= 800 else DEFAULT_WORDS


def target_words(instruction: str, plan: dict[str, Any] | None) -> int:
    return plan_words(plan) + DEEPEN_EXTRA_WORDS if instruction == "DEEPEN" else plan_words(plan)


def exercise_count(plan: dict[str, Any] | None) -> int:
    count = plan.get("exerciseCount") if isinstance(plan, dict) else None
    return count if isinstance(count, int) and 1 <= count <= 8 else DEFAULT_EXERCISES


def build_rewrite_prompt(
    *,
    step_title: str,
    material: str,
    retrieved: str,
    instruction: str,
    focus: str | None,
    plan: dict[str, Any] | None,
    learner_block: str,
) -> str:
    focus_line = f"Pay special attention to: {focus}\n" if focus else ""
    return (
        "You rewrite learning material for one learner. Write in Bahasa Indonesia, professional but easy to follow, Markdown.\n"
        f'The learner is working on: "{step_title}".\n'
        f"{INSTRUCTIONS[instruction]}\n"
        f"{focus_line}"
        f"Aim for about {target_words(instruction, plan)} words.\n"
        "Use these sections: Mengapa Hal Ini Penting, Materi Inti, Contoh Praktik di Dunia Kerja, "
        f"Latihan Singkat ({exercise_count(plan)} soal), Ringkasan Kunci (3-7 poin).\n"
        "Do not change what is true: every rule, number and definition must stay consistent with the original material "
        "and the retrieved documents. Do not add facts that neither contains. Output the material only, with no opening remark.\n"
        "Cite: every factual sentence ends with the numeric id of the retrieved document it rests on, in square brackets, for example [2]. "
        "Use only ids that exist in the retrieved documents, never invent an id, and ignore any bracketed numbers in the original material "
        "because they belong to an older numbering. Do not print a list of sources. If the documents do not cover something, say it is not covered "
        "by the topic sources instead of inventing it.\n"
        "\n"
        f'<learner_state trust="derived">\n{learner_block or "[none]"}\n</learner_state>\n'
        f'<original_material trust="derived">\n{(material or "[none]")[:MATERIAL_CHARS]}\n</original_material>\n'
        f'<retrieved trust="untrusted">\n{(retrieved or "[none]")[:RETRIEVED_CHARS]}\n</retrieved>\n'
    )


__all__ = ["INSTRUCTIONS", "build_rewrite_prompt", "exercise_count", "plan_words", "target_words"]
