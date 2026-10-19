from __future__ import annotations

from unittest.mock import MagicMock, patch

from langchain_core.messages import AIMessage

from v1.learning.dto import CitationDto
from v1.learning.service import CHAT_PROMPT_VERSION, ChatPrompt

PAYLOAD = {
    "chatId": "c-1",
    "userStepId": "us-1",
    "messageId": "m-1",
    "userId": "u-1",
    "query": "kenapa debit bertambah?",
    "session_id": "sess-1",
    "acting_user_id": "u-1",
    "tenant_id": "tenant-1",
    "trace_id": "trace-1",
    "idempotency_key": "k-1",
}

SNAPSHOT = {
    "concepts": [{"conceptId": "c2"}, {"conceptId": "c3"}],
    "next": None,
    "strategy": {
        "conceptId": "c2",
        "intent": "DOUBT",
        "strategy": "WORKED_EXAMPLE",
        "hintLevel": 0,
        "scaffoldLevel": "HIGH",
        "difficultyTarget": 0.4,
        "maxAttempts": 1,
        "reasonCodes": ["LOW_MASTERY"],
        "policyVersion": "teaching-policy-v2",
    },
}

REPLY = AIMessage(content="Jawaban lengkap tutor.", usage_metadata={"input_tokens": 120, "output_tokens": 45, "total_tokens": 165})


def _run(scripted_llm, prompt: ChatPrompt):
    from v1.learning import workers

    scripted_llm.reply("flash", REPLY)
    with patch.object(workers, "pipeline", MagicMock()), patch(
        "v1.learning.service.build_chat_prompt", return_value=prompt
    ), patch.object(workers, "update_message_chat") as update, patch.object(
        workers, "write_episode"
    ) as write_episode, patch.object(workers, "write_decision_trace") as write_trace:
        workers.generating_new_content.run(dict(PAYLOAD))
    return update, write_episode.call_args.args[0], write_trace.call_args.args[0]


def test_the_learner_receives_the_whole_tutor_answer_not_a_placeholder(scripted_llm):
    update, _, _ = _run(scripted_llm, ChatPrompt(text="prompt", snapshot=SNAPSHOT))

    assert update.call_args.args[2] == {"text": "Jawaban lengkap tutor.", "status": "COMPLETED", "citations": [], "actions": []}


def test_the_episode_records_versions_usage_and_latency_of_the_turn(scripted_llm):
    _, episode, _ = _run(scripted_llm, ChatPrompt(text="prompt", snapshot=SNAPSHOT))

    assert episode.prompt_version == CHAT_PROMPT_VERSION
    assert episode.policy_version == "routing-test"
    assert (episode.tokens_in, episode.tokens_out) == (120, 45)
    assert episode.latency_ms is not None and episode.latency_ms >= 0
    assert episode.response_excerpt == "Jawaban lengkap tutor."


def test_the_episode_names_the_teaching_strategy_and_the_concepts_it_was_chosen_for(scripted_llm):
    _, episode, _ = _run(scripted_llm, ChatPrompt(text="prompt", snapshot=SNAPSHOT))

    assert episode.metadata["teachingStrategy"] == "WORKED_EXAMPLE"
    assert episode.metadata["strategyReasonCodes"] == ["LOW_MASTERY"]
    assert episode.metadata["conceptIds"] == ["c2", "c3"]
    assert episode.metadata["teachingPolicyVersion"] == "teaching-policy-v2"
    assert episode.metadata["modelMode"] == "flash"


def test_the_episode_carries_the_citations_the_prompt_was_built_from(scripted_llm):
    cited = [CitationDto(lesson_id="l-1", chunk_id="ch-1", score=0.8, source="reducera-embedding"), CitationDto(resource_id="r-9", score=0.5)]

    _, episode, _ = _run(scripted_llm, ChatPrompt(text="prompt", citations=cited, snapshot=SNAPSHOT))

    assert [(c.lesson_id, c.chunk_id) for c in episode.citations] == [("l-1", "ch-1")]


def test_the_decision_trace_states_the_real_reasons_instead_of_a_phase_label(scripted_llm):
    _, _, trace = _run(scripted_llm, ChatPrompt(text="prompt", snapshot=SNAPSHOT))

    assert trace.reason_codes == ["LOW_MASTERY"]
    assert trace.selected_action == "WORKED_EXAMPLE"
    assert trace.prompt_version == CHAT_PROMPT_VERSION
    assert trace.deterministic_outputs["teaching_strategy"] == "WORKED_EXAMPLE"
    assert trace.deterministic_outputs["difficulty_target"] == 0.4
    assert "PHASE_1_FOUNDATION" not in trace.reason_codes


def test_a_turn_without_learner_state_says_so_in_the_trace_and_names_no_strategy(scripted_llm):
    _, episode, trace = _run(scripted_llm, ChatPrompt(text="prompt", snapshot=None))

    assert trace.reason_codes == ["NO_LEARNER_STATE"]
    assert trace.selected_action is None
    assert "teachingStrategy" not in episode.metadata
    assert episode.metadata["conceptIds"] == []


def test_the_decision_trace_carries_the_model_usage_and_latency_of_the_turn(scripted_llm):
    _, _, trace = _run(scripted_llm, ChatPrompt(text="prompt", snapshot=SNAPSHOT))

    assert trace.policy_version == "routing-test"
    assert (trace.tokens_in, trace.tokens_out) == (120, 45)
    assert trace.latency_ms is not None and trace.latency_ms >= 0
    assert trace.model == "unknown-v0"


def test_the_turn_is_recorded_under_the_label_and_arm_of_the_prompt_that_was_used(scripted_llm):
    _, episode, trace = _run(scripted_llm, ChatPrompt(text="prompt", snapshot=SNAPSHOT, label="tutor-chat@4", arm="canary"))

    assert episode.prompt_version == "tutor-chat@4"
    assert trace.prompt_version == "tutor-chat@4"
    assert episode.metadata["promptArm"] == "canary"


def test_the_episode_names_the_chunk_class_so_a_later_quiz_can_be_credited_to_it(scripted_llm):
    snapshot = {
        **SNAPSHOT,
        "strategy": {**SNAPSHOT["strategy"], "microlearning": {"chunkClass": "SHORT", "targetWords": 250, "exerciseCount": 3, "policyVersion": "microlearning-v1"}},
    }

    _, episode, _ = _run(scripted_llm, ChatPrompt(text="prompt", snapshot=snapshot))

    assert episode.metadata["chunkClass"] == "SHORT"
    assert episode.metadata["microlearningPolicyVersion"] == "microlearning-v1"


def test_an_unknown_chunk_class_is_not_recorded(scripted_llm):
    snapshot = {**SNAPSHOT, "strategy": {**SNAPSHOT["strategy"], "microlearning": {"chunkClass": "ENORMOUS"}}}

    _, episode, _ = _run(scripted_llm, ChatPrompt(text="prompt", snapshot=snapshot))

    assert "chunkClass" not in episode.metadata
