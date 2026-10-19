from __future__ import annotations

import json
import re
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, ValidationError

MAX_PROPOSED_ACTIONS = 3
ACTIONS_TAG = re.compile(r"<actions>(.*?)</actions>", re.S | re.I)
UNCLOSED_TAG = re.compile(r"<actions>.*\Z", re.S | re.I)

Text200 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Text8000 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8000)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QuizAction(_Strict):
    type: Literal["QUIZ"]
    count: int = Field(ge=3, le=10)
    focus: Text200 | None = None


class ImproveMaterialAction(_Strict):
    type: Literal["IMPROVE_MATERIAL"]
    instruction: Literal["SIMPLIFY", "EXAMPLE", "DEEPEN", "SHORTEN"]
    focus: Text200 | None = None


class NoteAction(_Strict):
    type: Literal["NOTE"]
    title: Text200
    body: Text8000


ProposedAction = Annotated[Union[QuizAction, ImproveMaterialAction, NoteAction], Field(discriminator="type")]
_ADAPTER: TypeAdapter[ProposedAction] = TypeAdapter(ProposedAction)


def validate_action(item: Any) -> dict[str, Any] | None:
    try:
        return _ADAPTER.validate_python(item).model_dump(exclude_none=True)
    except ValidationError:
        return None


def extract_actions(text: str) -> tuple[str, list[dict[str, Any]]]:
    proposed: dict[str, dict[str, Any]] = {}
    for match in ACTIONS_TAG.finditer(text or ""):
        try:
            raw = json.loads(match.group(1))
        except ValueError:
            continue
        for item in raw if isinstance(raw, list) else [raw]:
            action = validate_action(item)
            if action is not None and action["type"] not in proposed:
                proposed[action["type"]] = action
    cleaned = UNCLOSED_TAG.sub("", ACTIONS_TAG.sub("", text or "")).rstrip()
    return cleaned, list(proposed.values())[:MAX_PROPOSED_ACTIONS]


__all__ = ["MAX_PROPOSED_ACTIONS", "extract_actions", "validate_action"]
