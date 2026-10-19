from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_TEMPLATE_CHARS = 20000
MAX_TEXT_CHARS = 4000

Behavior = Literal["ANSWER", "HINT_ONLY", "NOT_COVERED", "REFUSE_REDIRECT", "REDIRECT", "CLARIFY", "SUPPORT"]
CitationMode = Literal["REQUIRED", "OPTIONAL", "NONE"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FactGroup(Strict):
    id: str = Field(min_length=1, max_length=60)
    anyOf: list[str] = Field(min_length=1, max_length=12)


class CitationExpectation(Strict):
    mode: CitationMode
    mustCite: list[int] = Field(default_factory=list, max_length=6)
    mustNotCite: list[int] = Field(default_factory=list, max_length=6)


class Expectation(Strict):
    behavior: Behavior
    requiredFacts: list[FactGroup] = Field(default_factory=list, max_length=12)
    forbiddenFacts: list[FactGroup] = Field(default_factory=list, max_length=12)
    citation: CitationExpectation
    rubric: str = Field(min_length=1, max_length=1000)


class SourceInput(Strict):
    kind: Literal["TOPIC", "MATERIAL"]
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)


class TurnInput(Strict):
    role: Literal["learner", "core"]
    text: str = Field(min_length=1, max_length=1000)


class CaseInput(Strict):
    id: str = Field(min_length=1, max_length=40)
    category: str = Field(min_length=1, max_length=40)
    risk: Literal["standard", "high"]
    stepTitle: str = Field(min_length=1, max_length=200)
    learnerName: str = Field(default="", max_length=40)
    message: str = Field(min_length=1, max_length=2000)
    currentMaterial: str = Field(default="", max_length=MAX_TEXT_CHARS)
    conversation: list[TurnInput] = Field(default_factory=list, max_length=12)
    sources: list[SourceInput] = Field(default_factory=list, max_length=8)
    strategy: dict[str, Any] | None = None
    expect: Expectation


class TemplateInput(Strict):
    label: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=1, max_length=MAX_TEMPLATE_CHARS)


class RunCaseRequest(Strict):
    template: TemplateInput
    case: CaseInput
    protectedPhrases: list[str] = Field(default_factory=list, max_length=30)
    judge: bool = True


__all__ = [
    "Behavior",
    "CaseInput",
    "CitationExpectation",
    "CitationMode",
    "Expectation",
    "FactGroup",
    "RunCaseRequest",
    "SourceInput",
    "TemplateInput",
    "TurnInput",
]
