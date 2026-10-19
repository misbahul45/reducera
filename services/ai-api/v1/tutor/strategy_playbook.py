from __future__ import annotations

import re
from typing import Any

STRATEGIES = (
    "EXPLAIN",
    "ASK",
    "HINT",
    "WORKED_EXAMPLE",
    "GUIDED_EXAMPLE",
    "SOCRATIC",
    "COUNTEREXAMPLE",
    "PRACTICE",
    "REMEDIATE",
    "REVIEW",
    "CHALLENGE",
    "TRANSFER",
)

INTENTS = ("NEW_LEARNING", "PRACTICE", "DOUBT", "CHALLENGE", "TRANSFER")
SCAFFOLD_LEVELS = ("MINIMAL", "MEDIUM", "HIGH")

PLAYBOOK = {
    "EXPLAIN": "Explain the idea directly in plain steps, then ask one short question to confirm understanding.",
    "ASK": "Lead with one targeted question that makes the learner retrieve what they already know, then give a brief answer.",
    "HINT": "Give a graded hint toward the answer without stating the final answer.",
    "WORKED_EXAMPLE": "Walk through one complete worked example step by step and name the rule used at each step.",
    "GUIDED_EXAMPLE": "Work an example together: show the first step, then leave the next step to the learner with a prompt.",
    "SOCRATIC": "Use a short sequence of guiding questions so the learner reaches the answer; keep each question brief.",
    "COUNTEREXAMPLE": "Show a case where the usual rule seems to apply but fails, and explain why it fails.",
    "PRACTICE": "Give one practice item at the stated difficulty and wait for the learner's attempt before revealing the solution.",
    "REMEDIATE": "Name the likely misunderstanding and repair it, revisiting the weakest prerequisite before building further.",
    "REVIEW": "Recap the key points of the concept in a few lines and test recall with one question.",
    "CHALLENGE": "Pose a harder problem that stretches the concept and give no hints unless the learner asks.",
    "TRANSFER": "Apply the concept to a new context the learner has not seen and ask them to adapt the method.",
}

REASON_CODE = re.compile(r"^[A-Z][A-Z_]{1,40}$")


def _bounded_int(value: Any, low: int, high: int) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return max(low, min(high, int(value)))


def _bounded_float(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return max(0.0, min(1.0, float(value)))


def render_strategy_lines(strategy: dict[str, Any] | None) -> list[str]:
    if not isinstance(strategy, dict):
        return []
    name = strategy.get("strategy")
    if name not in PLAYBOOK:
        return []

    parts = [f"teaching_strategy={name}"]
    if strategy.get("intent") in INTENTS:
        parts.append(f"intent={strategy['intent']}")
    hint_level = _bounded_int(strategy.get("hintLevel"), 0, 3)
    if hint_level is not None:
        parts.append(f"hint_level={hint_level}")
    if strategy.get("scaffoldLevel") in SCAFFOLD_LEVELS:
        parts.append(f"scaffold={strategy['scaffoldLevel']}")
    difficulty = _bounded_float(strategy.get("difficultyTarget"))
    if difficulty is not None:
        parts.append(f"difficulty_target={difficulty:.2f}")
    max_attempts = _bounded_int(strategy.get("maxAttempts"), 1, 10)
    if max_attempts is not None:
        parts.append(f"max_attempts={max_attempts}")
    reasons = [code for code in (strategy.get("reasonCodes") or []) if isinstance(code, str) and REASON_CODE.match(code)]
    parts.append(f"reasons=[{', '.join(reasons)}]")

    return [" ".join(parts), f"strategy_playbook: {PLAYBOOK[name]}"]


__all__ = ["INTENTS", "PLAYBOOK", "REASON_CODE", "SCAFFOLD_LEVELS", "STRATEGIES", "render_strategy_lines"]
