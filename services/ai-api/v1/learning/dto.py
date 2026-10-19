from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from v1.users_steps.dto import (
    LearningStyleProfileBase,
    StepBase,
    TopicBase,
)


def _to_camel(s: str) -> str:
    parts = s.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


class CitationDto(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    lesson_id: Optional[str] = None
    concept_id: Optional[str] = None
    resource_id: Optional[str] = None
    chunk_id: Optional[str] = None
    score: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    label: Optional[str] = None
    source: Optional[str] = None
    snippet: Optional[str] = None

    @model_validator(mode="after")
    def _needs_a_locator(self):
        if not (self.lesson_id or self.concept_id or self.resource_id):
            raise ValueError("a citation needs a lesson, concept or resource id")
        return self


class SourceCitationDto(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True, extra="forbid")

    index: int = Field(ge=1, le=50)
    kind: Literal["MATERIAL", "WEB", "TOPIC"]
    title: str = Field(min_length=1, max_length=200)
    url: Optional[str] = Field(default=None, max_length=500)
    snippet: Optional[str] = Field(default=None, max_length=300)
    lesson_id: Optional[str] = Field(default=None, max_length=64)
    ref_type: Optional[Literal["RESOURCE", "CONCEPT", "TOPIC", "SUBTOPIC"]] = None
    ref_id: Optional[str] = Field(default=None, max_length=64)
    via: Optional[List[Literal["LEXICAL", "SEMANTIC", "WEB", "SCOPE"]]] = Field(default=None, max_length=4)

    @model_validator(mode="after")
    def _kind_needs_its_locator(self):
        if self.kind == "WEB":
            if not (self.url and self.url.lower().startswith(("http://", "https://"))):
                raise ValueError("a web citation needs an http or https link")
        elif self.url:
            raise ValueError("only a web citation has a link")
        if self.kind == "TOPIC" and not (self.ref_type and self.ref_id):
            raise ValueError("a topic citation names the record it comes from")
        return self


class GenerateContentMaterialResponseDto(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        from_attributes=True,
        json_schema_extra={
            "example": {
                "chatId": "a1234567-89ab-4cde-f012-3456789abcde",
                "chatMessageId": "b2345678-90cd-4ef1-2345-6789abcdef01",
                "data": "sample",
                "citations": [],
                "metadata": {},
            }
        },
    )

    chat_id: str
    chat_message_id: str
    data: Any
    citations: Optional[List[Union[CitationDto, SourceCitationDto]]] = []
    metadata: Optional[Dict[str, Any]] = None


class UserStepBase(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    id: str
    user_id: str
    is_unlocked: bool
    order: int
    step_template_id: Optional[str] = None
    title: str
    is_done: bool
    quiz_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class LessonBase(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    id: str
    title: str
    description: Optional[str] = None
    sort_order: int = 0
    sub_topic_id: str
    theme_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class GenerateContentMaterialPipeline(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    user_id: str
    step_id: str
    user_step_id: str
    topic_id: str
    lesson_id: str
    learning_style_id: str
    message_id: str
    chat_id: str

    session_id: str
    acting_user_id: str
    tenant_id: str
    trace_id: str
    idempotency_key: str

    topic: Optional[TopicBase] = None
    learning_style: Optional[LearningStyleProfileBase] = None
    step: Optional[StepBase] = None
    lesson: Optional[Any] = None
    user_step: Optional[UserStepBase] = None
    generate: Optional[Union[GenerateContentMaterialResponseDto, dict]] = None

    context: Optional[str] = None
    memory: Optional[str] = None
    analysis: Optional[str] = None
    snapshot: Optional[dict] = None
    routed: Optional[Any] = None


__all__ = [
    "CitationDto",
    "GenerateContentMaterialResponseDto",
    "UserStepBase",
    "LessonBase",
    "GenerateContentMaterialPipeline",
]