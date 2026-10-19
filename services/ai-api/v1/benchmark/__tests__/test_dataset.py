from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

import pytest

from v1.benchmark.checks import fact_report, markers_in
from v1.benchmark.dto import CaseInput
from v1.benchmark.runner import render_prompt
from v1.learning.chat_template import BUILTIN_CHAT_TEMPLATE

REPO = next((parent for parent in Path(__file__).resolve().parents if (parent / "services" / "api").is_dir()), None)
DATASET = REPO / "services/api/prisma/seed-data/evaluation/tutor-chat-benchmark.v1.json" if REPO else None

REQUIRED_CATEGORIES = {
    "concept",
    "worked_example",
    "misconception",
    "hint_only",
    "answer_after_attempt",
    "safety",
    "no_evidence",
    "wellbeing",
    "off_topic",
    "citation_precision",
    "ambiguous",
}
NOT_PORTABLE = re.compile(r"\(\?P<|\(\?<|\(\?i\)|\(\?s\)|\\A|\\Z|\(\?>|\(\?=|\(\?!")
GENERIC_REFUSAL = "Maaf, aku tidak bisa menjawab itu. Coba tanyakan hal lain ya."


@pytest.fixture(scope="module")
def dataset():
    assert DATASET is not None and DATASET.exists()
    return json.loads(DATASET.read_text())


def resolved(dataset, raw):
    library = dataset["sourceLibrary"]
    return {**raw, "sources": [library[item] if isinstance(item, str) else item for item in raw["sources"]]}


@pytest.fixture(scope="module")
def cases(dataset):
    return [CaseInput.model_validate(resolved(dataset, raw)) for raw in dataset["cases"]]


def test_the_dataset_is_the_size_the_gate_promises(dataset, cases):
    assert dataset["datasetName"] == "tutor-chat-benchmark-v1"
    assert dataset["version"] == 1
    assert len(cases) >= 50


def test_ids_are_unique_and_stable_in_form(cases):
    ids = [case.id for case in cases]

    assert len(ids) == len(set(ids))
    assert all(re.fullmatch(r"TC-\d{2}", item) for item in ids)


def test_every_planned_kind_of_situation_is_present_and_high_risk_cases_are_not_rare(cases):
    categories = Counter(case.category for case in cases)

    assert REQUIRED_CATEGORIES <= set(categories)
    assert sum(1 for case in cases if case.risk == "high") >= 10
    assert categories["safety"] >= 5
    assert categories["no_evidence"] >= 5


def test_every_pattern_compiles_and_stays_inside_the_subset_both_python_and_javascript_read(cases):
    for case in cases:
        for group in [*case.expect.requiredFacts, *case.expect.forbiddenFacts]:
            for pattern in group.anyOf:
                re.compile(pattern, re.IGNORECASE | re.DOTALL)
                assert not NOT_PORTABLE.search(pattern), f"{case.id} {group.id}: {pattern}"


def test_fact_group_ids_are_unique_inside_a_case(cases):
    for case in cases:
        ids = [group.id for group in [*case.expect.requiredFacts, *case.expect.forbiddenFacts]]
        assert len(ids) == len(set(ids)), case.id


def test_citation_expectations_point_at_sources_that_exist(cases):
    for case in cases:
        citation = case.expect.citation
        for number in [*citation.mustCite, *citation.mustNotCite]:
            assert 1 <= number <= len(case.sources), f"{case.id}: {number}"
        if citation.mode == "REQUIRED":
            assert case.sources and citation.mustCite, case.id
        assert not set(citation.mustCite) & set(citation.mustNotCite), case.id


def test_every_case_that_expects_an_answer_says_what_a_good_answer_contains(cases):
    for case in cases:
        if case.expect.behavior != "REFUSE_REDIRECT":
            assert case.expect.requiredFacts, case.id


def test_repeating_the_learner_message_never_satisfies_the_required_facts(cases):
    offenders = [
        case.id
        for case in cases
        if case.expect.requiredFacts and fact_report(case.message, case.expect.requiredFacts, case.expect.forbiddenFacts)["coverage"] == 1.0
    ]

    assert offenders == []


def test_a_generic_refusal_never_satisfies_an_answer_or_hint_case(cases):
    for case in cases:
        if case.expect.behavior in ("ANSWER", "HINT_ONLY"):
            report = fact_report(GENERIC_REFUSAL, case.expect.requiredFacts, case.expect.forbiddenFacts)
            assert report["coverage"] < 1.0, case.id


def test_a_hint_only_case_forbids_the_final_answer_and_asks_for_a_direction(cases):
    hint_cases = [case for case in cases if case.expect.behavior == "HINT_ONLY"]

    assert len(hint_cases) >= 4
    for case in hint_cases:
        assert case.expect.forbiddenFacts, case.id
        assert case.strategy and case.strategy["strategy"] == "HINT", case.id


def test_cases_with_no_evidence_cite_nothing(cases):
    for case in cases:
        if case.expect.behavior == "NOT_COVERED":
            assert case.expect.citation.mode == "NONE", case.id


def test_every_case_renders_into_a_valid_prompt_with_the_message_and_numbered_sources(cases):
    for case in cases:
        prompt, sources = render_prompt(BUILTIN_CHAT_TEMPLATE, case)

        assert "{{" not in prompt and "}}" not in prompt, case.id
        assert case.message in prompt, case.id
        assert len(sources) == len(case.sources)
        for source in sources:
            assert source.title in prompt, f"{case.id}: {source.title}"
        if case.strategy:
            assert f"teaching_strategy={case.strategy['strategy']}" in prompt, case.id


def test_the_prompt_never_carries_the_expected_answers_or_the_rubric(cases):
    for case in cases:
        prompt, _ = render_prompt(BUILTIN_CHAT_TEMPLATE, case)

        assert case.expect.rubric not in prompt, case.id


def test_citation_markers_in_a_prompt_example_are_not_confused_with_real_ones():
    assert markers_in("[1] dan [2, 3] tetapi bukan [x] atau [100]") == [1, 2, 3]
