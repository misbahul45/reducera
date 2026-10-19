from __future__ import annotations

import json

import pytest

from errors.types import LLMError
from v1.benchmark.dto import CaseInput, RunCaseRequest, TemplateInput
from v1.benchmark.runner import BenchmarkRejected, render_prompt, run_case
from v1.learning.chat_template import BUILTIN_CHAT_TEMPLATE

PROTECTED = ["domain_taxonomy", "strategy_playbook", "Never invent sources"]

CASE = {
    "id": "TC-13",
    "category": "worked_example",
    "risk": "standard",
    "stepTitle": "Jurnal pembelian peralatan",
    "learnerName": "Wulan Sari",
    "message": "Kalau beli peralatan Rp10.000.000 secara kredit, jurnalnya gimana?",
    "currentMaterial": "Pembelian aset secara kredit menambah aset dan liabilitas.",
    "conversation": [{"role": "learner", "text": "Halo"}, {"role": "core", "text": "Halo juga!"}],
    "sources": [
        {"kind": "TOPIC", "title": "Debit dan Kredit", "text": "Aset bertambah di debit. Liabilitas bertambah di kredit."},
        {"kind": "TOPIC", "title": "Jurnal Umum", "text": "Jurnal mencatat transaksi secara kronologis."},
    ],
    "strategy": {"strategy": "WORKED_EXAMPLE", "intent": "DOUBT", "hintLevel": 1, "scaffoldLevel": "MEDIUM", "difficultyTarget": 0.5, "maxAttempts": 4, "reasonCodes": ["LOW_MASTERY"]},
    "expect": {
        "behavior": "ANSWER",
        "requiredFacts": [
            {"id": "debit", "anyOf": ["debit.{0,40}peralatan"]},
            {"id": "kredit", "anyOf": ["kredit.{0,40}utang"]},
        ],
        "forbiddenFacts": [],
        "citation": {"mode": "REQUIRED", "mustCite": [1], "mustNotCite": [2]},
        "rubric": "Langkah demi langkah.",
    },
}

GOOD_REPLY = "Mantap, Wulan! Debit Peralatan Rp10.000.000 karena aset bertambah [1]. Kredit Utang Usaha karena kewajiban baru. Coba hitung totalnya?"
GOOD_VERDICT = {"behavior": 5, "pedagogy": 4, "grounding": 4, "unsafe": False, "notes": "Jelas dan singkat."}


def request(**overrides) -> RunCaseRequest:
    payload = {
        "template": {"label": "tutor-chat-builtin-3", "body": BUILTIN_CHAT_TEMPLATE},
        "case": CASE,
        "protectedPhrases": PROTECTED,
        "judge": True,
        **overrides,
    }
    return RunCaseRequest.model_validate(payload)


def test_the_prompt_is_built_with_the_product_renderers_from_the_frozen_context():
    prompt, sources = render_prompt(BUILTIN_CHAT_TEMPLATE, CaseInput.model_validate(CASE))

    assert "{{" not in prompt
    assert "Wulan" in prompt and "Sari" not in prompt
    assert "teaching_strategy=WORKED_EXAMPLE" in prompt and "hint_level=1" in prompt
    assert "Pembelian aset secara kredit" in prompt
    assert "Halo juga!" in prompt
    assert "Debit dan Kredit" in prompt and "Jurnal Umum" in prompt
    assert [source.index for source in sources] == [1, 2]
    assert "<user_input" in prompt and CASE["message"] in prompt


def test_a_case_without_sources_gets_the_product_placeholder_not_an_empty_block():
    prompt, sources = render_prompt(BUILTIN_CHAT_TEMPLATE, CaseInput.model_validate({**CASE, "sources": [], "expect": {**CASE["expect"], "citation": {"mode": "NONE"}}}))

    assert sources == []
    assert "[No RAG materials available]" in prompt


def test_a_case_without_a_strategy_has_no_learner_state_block():
    prompt, _ = render_prompt(BUILTIN_CHAT_TEMPLATE, CaseInput.model_validate({**CASE, "strategy": None}))

    assert "teaching_strategy=" not in prompt.split("**Teaching strategy**")[0]


def test_the_same_template_and_case_render_the_same_prompt():
    case = CaseInput.model_validate(CASE)

    assert render_prompt(BUILTIN_CHAT_TEMPLATE, case)[0] == render_prompt(BUILTIN_CHAT_TEMPLATE, case)[0]


def test_a_run_records_the_answer_the_checks_and_the_judge_and_never_invents_a_reply(scripted_llm):
    scripted_llm.reply("flash", GOOD_REPLY).reply("thinking", json.dumps(GOOD_VERDICT))

    result = run_case(request(), subject="admin-1")

    assert result["text"] == GOOD_REPLY
    assert result["templateLabel"] == "tutor-chat-builtin-3"
    assert len(result["templateHash"]) == 64
    assert result["citationsShown"] == [1]
    assert result["checks"]["facts"]["coverage"] == 1.0
    assert result["checks"]["citations"]["passed"] is True
    assert result["judge"]["verdict"] == {**GOOD_VERDICT}
    assert result["judge"]["version"] == "judge-v1"
    assert result["dimensions"] == {"correctness": True, "coverage": 1.0, "citation": True, "safety": True, "pedagogy": 4, "behavior": 5, "grounding": 4}
    assert [mode for mode, _route, _messages in scripted_llm.calls] == ["flash", "thinking"]


def test_the_tutor_and_the_judge_use_different_modes(scripted_llm):
    scripted_llm.reply("flash", GOOD_REPLY).reply("thinking", json.dumps(GOOD_VERDICT))

    result = run_case(request(), subject="admin-1")

    assert result["mode"] == "flash"
    assert result["judge"]["mode"] == "thinking"


def test_the_judge_does_not_see_the_candidate_template_or_its_label(scripted_llm):
    scripted_llm.reply("flash", GOOD_REPLY).reply("thinking", json.dumps(GOOD_VERDICT))

    run_case(request(), subject="admin-1")

    judge_prompt = scripted_llm.calls[1][2][0].content
    assert "tutor-chat-builtin-3" not in judge_prompt
    assert "study buddy of a learner" not in judge_prompt
    assert GOOD_REPLY in judge_prompt


def test_markers_that_point_nowhere_are_reported_and_removed_from_what_the_learner_sees(scripted_llm):
    scripted_llm.reply("flash", "Debit Peralatan, kredit Utang Usaha [1][9].").reply("thinking", json.dumps(GOOD_VERDICT))

    result = run_case(request(), subject="admin-1")

    assert result["checks"]["citations"]["invalid"] == [9]
    assert result["checks"]["citations"]["passed"] is False
    assert "[9]" not in result["textShown"]
    assert result["citationsShown"] == [1]


def test_the_action_line_is_split_off_like_the_product_does_before_anything_is_checked(scripted_llm):
    reply = GOOD_REPLY + '\n<actions>[{"type":"QUIZ","count":5,"focus":"jurnal"}]</actions>'
    scripted_llm.reply("flash", reply).reply("thinking", json.dumps(GOOD_VERDICT))

    result = run_case(request(), subject="admin-1")

    assert result["actions"] == ["QUIZ"]
    assert "<actions>" not in result["text"]
    assert result["checks"]["actionsMalformed"] is False


def test_a_broken_action_line_is_flagged(scripted_llm):
    scripted_llm.reply("flash", GOOD_REPLY + "\n<actions>[{oops}</actions>").reply("thinking", json.dumps(GOOD_VERDICT))

    assert run_case(request(), subject="admin-1")["checks"]["actionsMalformed"] is True


def test_a_judge_that_fails_is_recorded_and_the_deterministic_scores_survive(scripted_llm):
    scripted_llm.reply("flash", GOOD_REPLY).reply("thinking", "bukan json", "masih bukan json")

    result = run_case(request(), subject="admin-1")

    assert result["judge"] is None
    assert result["judgeError"]
    assert result["dimensions"]["correctness"] is True
    assert result["dimensions"]["pedagogy"] is None


def test_a_run_without_the_judge_makes_no_judge_call(scripted_llm):
    scripted_llm.reply("flash", GOOD_REPLY)

    result = run_case(request(judge=False), subject="admin-1")

    assert result["judge"] is None and result["judgeVersion"] is None
    assert [mode for mode, _route, _messages in scripted_llm.calls] == ["flash"]


def test_when_the_model_cannot_answer_the_case_fails_instead_of_being_filled_in(scripted_llm):
    scripted_llm.fail("flash").fail("thinking")

    with pytest.raises(LLMError):
        run_case(request(), subject="admin-1")


def test_a_template_that_breaks_the_contract_is_refused_before_any_model_call(scripted_llm):
    body = BUILTIN_CHAT_TEMPLATE.replace("{{rag}}", "")

    with pytest.raises(BenchmarkRejected) as raised:
        run_case(request(template={"label": "kandidat", "body": body}), subject="admin-1")

    assert any("rag" in problem for problem in raised.value.problems)
    assert scripted_llm.calls == []


def test_two_templates_on_the_same_case_differ_in_hash_and_in_nothing_else_the_runner_decides(scripted_llm):
    changed = BUILTIN_CHAT_TEMPLATE.replace("Usually 2 to 6 short sentences.", "Usually 2 to 5 short sentences.")
    scripted_llm.reply("flash", GOOD_REPLY, GOOD_REPLY).reply("thinking", json.dumps(GOOD_VERDICT), json.dumps(GOOD_VERDICT))

    first = run_case(request(), subject="admin-1")
    second = run_case(request(template=TemplateInput(label="kandidat", body=changed).model_dump()), subject="admin-1")

    assert first["templateHash"] != second["templateHash"]
    assert first["checks"] == second["checks"]
