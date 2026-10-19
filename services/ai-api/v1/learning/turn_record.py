from __future__ import annotations

from typing import Any

from config.model_router import RoutedResult
from v1.tutor.strategy_playbook import PLAYBOOK, REASON_CODE

UNKNOWN_MODEL = "unknown-v0"


def concept_ids_of(snapshot: dict[str, Any] | None) -> list[str]:
    if not snapshot:
        return []
    ids = [
        item["conceptId"]
        for item in snapshot.get("concepts") or []
        if isinstance(item, dict) and isinstance(item.get("conceptId"), str) and item["conceptId"]
    ]
    return list(dict.fromkeys(ids))


def strategy_of(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    strategy = (snapshot or {}).get("strategy")
    if isinstance(strategy, dict) and strategy.get("strategy") in PLAYBOOK:
        return strategy
    return None


CHUNK_CLASSES = ("SHORT", "MEDIUM", "LONG")


def micro_plan_of(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    strategy = strategy_of(snapshot)
    micro = (strategy or {}).get("microlearning")
    if isinstance(micro, dict) and micro.get("chunkClass") in CHUNK_CLASSES:
        return micro
    return None


def reason_codes_of(snapshot: dict[str, Any] | None) -> list[str]:
    if not snapshot:
        return ["NO_LEARNER_STATE"]
    strategy = strategy_of(snapshot)
    if strategy is None:
        return ["NO_STRATEGY"]
    codes = [code for code in strategy.get("reasonCodes") or [] if isinstance(code, str) and REASON_CODE.match(code)]
    return codes or ["NO_STRATEGY"]


def episode_metadata(snapshot: dict[str, Any] | None, routed: RoutedResult) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "conceptIds": concept_ids_of(snapshot),
        "modelMode": routed.mode,
        "escalated": routed.escalated,
        "modelAttempts": len(routed.attempts),
        "complexity": routed.complexity,
    }
    strategy = strategy_of(snapshot)
    if strategy is not None:
        metadata["teachingStrategy"] = strategy["strategy"]
        metadata["strategyReasonCodes"] = reason_codes_of(snapshot)
        if isinstance(strategy.get("conceptId"), str):
            metadata["strategyConceptId"] = strategy["conceptId"]
        if isinstance(strategy.get("policyVersion"), str):
            metadata["teachingPolicyVersion"] = strategy["policyVersion"]
        micro = micro_plan_of(snapshot)
        if micro is not None:
            metadata["chunkClass"] = micro["chunkClass"]
            metadata["microlearningPolicyVersion"] = micro.get("policyVersion")
    return metadata


def trace_outputs(snapshot: dict[str, Any] | None, user_step_id: str) -> dict[str, Any]:
    outputs: dict[str, Any] = {"user_step_id": user_step_id, "concept_ids": concept_ids_of(snapshot)}
    strategy = strategy_of(snapshot)
    if strategy is not None:
        outputs["teaching_strategy"] = strategy["strategy"]
        for source, target in (("difficultyTarget", "difficulty_target"), ("hintLevel", "hint_level"), ("scaffoldLevel", "scaffold_level")):
            if source in strategy:
                outputs[target] = strategy[source]
    return outputs


def selected_action_of(snapshot: dict[str, Any] | None) -> str | None:
    strategy = strategy_of(snapshot)
    return strategy["strategy"] if strategy else None


def latency_of(routed: RoutedResult) -> int:
    return max(0, int(round(routed.latency_ms)))


def trace_fields(routed: RoutedResult | None) -> dict[str, Any]:
    if routed is None:
        return {}
    return {
        "policy_version": routed.policy_version,
        "model": routed.model or UNKNOWN_MODEL,
        "latency_ms": latency_of(routed),
        "tokens_in": routed.tokens_in,
        "tokens_out": routed.tokens_out,
    }


def episode_fields(routed: RoutedResult | None, snapshot: dict[str, Any] | None, *, prompt_arm: str | None = None) -> dict[str, Any]:
    if routed is None:
        return {"metadata": {"conceptIds": concept_ids_of(snapshot)}}
    metadata = episode_metadata(snapshot, routed)
    if prompt_arm is not None:
        metadata["promptArm"] = prompt_arm
    return {
        "tokens_in": routed.tokens_in,
        "tokens_out": routed.tokens_out,
        "latency_ms": latency_of(routed),
        "policy_version": routed.policy_version,
        "model": routed.model or UNKNOWN_MODEL,
        "metadata": metadata,
    }


__all__ = [
    "UNKNOWN_MODEL",
    "concept_ids_of",
    "episode_fields",
    "episode_metadata",
    "latency_of",
    "micro_plan_of",
    "reason_codes_of",
    "selected_action_of",
    "strategy_of",
    "trace_fields",
    "trace_outputs",
]
