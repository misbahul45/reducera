from __future__ import annotations

import random
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from config.llm_output import parse_json_object
from v1.learning.sources import Source

MISCONCEPTION_CODES = (
    "debit_credit_swap",
    "normal_balance_confusion",
    "contra_account_confusion",
    "accounting_equation_imbalance",
    "trial_balance_imbalance",
    "adjusting_entry_error",
    "accrual_cash_confusion",
    "financial_statement_mapping_error",
    "missing_credit_side",
)

MIN_QUESTIONS = 3
MAX_SOURCES_PER_QUESTION = 3
OPTIONS_PER_QUESTION = 4
MATERIAL_CHARS = 4000
RETRIEVED_CHARS = 2500


class GeneratedQuestion(BaseModel):
    model_config = ConfigDict(extra="ignore")

    question: str = Field(min_length=1, max_length=600)
    options: list[str]
    correctAnswer: str = Field(min_length=1, max_length=240)
    distractors: dict[str, str] = Field(default_factory=dict)
    sources: list[int] = Field(default_factory=list)


class GeneratedQuiz(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(min_length=1, max_length=160)
    questions: list[dict[str, Any]]


def build_quiz_prompt(
    *,
    step_title: str,
    material: str,
    retrieved: str,
    count: int,
    focus: str | None,
    learner_block: str,
    difficulty: float | None,
) -> str:
    codes = ", ".join(MISCONCEPTION_CODES)
    level = "easy" if difficulty is None or difficulty < 0.4 else "medium" if difficulty < 0.7 else "hard"
    focus_line = f"Focus the questions on: {focus}\n" if focus else ""
    return (
        "You write practice questions for a learner. Write the questions in Bahasa Indonesia.\n"
        f'The learner is working on: "{step_title}".\n'
        f"{focus_line}"
        f"Create exactly {count} multiple-choice questions at {level} difficulty that check understanding of the material below.\n"
        "\n"
        "Rules:\n"
        f"- Each question has exactly {OPTIONS_PER_QUESTION} options and exactly one correct option. correctAnswer repeats the text of that option.\n"
        "- Every question must be answerable from the numbered retrieved documents or the material. Do not test facts that are not covered.\n"
        "- Each question lists in sources the numeric ids of the retrieved documents it is based on (1 to 3 ids). Use only ids that exist. A question without a real source is not allowed.\n"
        "- Test application and reasoning, not only recall. No \"all of the above\", no \"none of the above\".\n"
        "- Wrong options must be plausible. Each wrong option should come from one common misunderstanding.\n"
        f"- distractors maps the exact text of a wrong option to a misunderstanding code from this closed list: {codes}. "
        "Leave a wrong option out of distractors when none of the codes fits. Never use a code outside the list. Never put the correct option in distractors.\n"
        "- Put the correct option in different positions across questions.\n"
        "\n"
        'Reply with JSON only, no other text: {"title": "short title", "questions": [{"question": "...", '
        '"options": ["...", "...", "...", "..."], "correctAnswer": "...", "distractors": {"wrong option text": "code"}, "sources": [1]}]}\n'
        "\n"
        f"<learner_state trust=\"derived\">\n{learner_block or '[none]'}\n</learner_state>\n"
        f"<material trust=\"derived\">\n{(material or '[none]')[:MATERIAL_CHARS]}\n</material>\n"
        f"<retrieved trust=\"untrusted\">\n{(retrieved or '[none]')[:RETRIEVED_CHARS]}\n</retrieved>\n"
    )


def _cited(question: GeneratedQuestion, by_index: dict[int, Source]) -> list[dict[str, Any]]:
    seen: list[int] = []
    for number in question.sources:
        if number in by_index and number not in seen:
            seen.append(number)
    return [by_index[number].as_citation() for number in seen[:MAX_SOURCES_PER_QUESTION]]


def _clean(question: GeneratedQuestion) -> dict[str, Any] | None:
    options = [" ".join(option.split()) for option in question.options]
    correct = " ".join(question.correctAnswer.split())
    lowered = [option.lower() for option in options]
    if len(options) != OPTIONS_PER_QUESTION or len(set(lowered)) != OPTIONS_PER_QUESTION:
        return None
    if any(not option or len(option) > 240 for option in options) or correct not in options:
        return None
    tags = {
        " ".join(option.split()): code
        for option, code in question.distractors.items()
        if code in MISCONCEPTION_CODES
    }
    tags = {option: code for option, code in tags.items() if option in options and option != correct}
    return {"question": " ".join(question.question.split()), "options": options, "correctAnswer": correct, "distractors": tags}


def parse_quiz(text: str, seed: str, wanted: int, sources: list[Source] | None = None) -> dict[str, Any]:
    by_index = {source.index: source for source in sources or []}
    try:
        generated = GeneratedQuiz.model_validate(parse_json_object(text))
    except (ValueError, ValidationError) as exc:
        raise ValueError("the quiz is not valid JSON of the expected shape") from exc

    questions: list[dict[str, Any]] = []
    for raw in generated.questions:
        try:
            cleaned = _clean(GeneratedQuestion.model_validate(raw))
        except ValidationError:
            continue
        if cleaned is None:
            continue
        cited = _cited(GeneratedQuestion.model_validate(raw), by_index) if by_index else []
        if by_index and not cited:
            continue
        if cited:
            cleaned["sources"] = cited
        questions.append(cleaned)
    questions = questions[:wanted]
    if len(questions) < MIN_QUESTIONS:
        raise ValueError(f"only {len(questions)} usable questions, at least {MIN_QUESTIONS} are needed")

    for index, question in enumerate(questions):
        random.Random(f"{seed}:{index}").shuffle(question["options"])
    return {"title": " ".join(generated.title.split()), "questions": questions}


__all__ = ["MISCONCEPTION_CODES", "GeneratedQuiz", "build_quiz_prompt", "parse_quiz"]
