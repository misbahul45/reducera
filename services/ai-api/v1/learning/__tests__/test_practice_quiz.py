from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from v1.learning.hybrid import rank_hybrid
from v1.learning.practice_quiz import MISCONCEPTION_CODES, build_quiz_prompt, parse_quiz

REPO = Path(__file__).resolve().parents[5]


def question(**overrides):
    base = {
        "question": "Akun apa yang bertambah di sisi debit?",
        "options": ["Kas", "Utang usaha", "Modal", "Pendapatan"],
        "correctAnswer": "Kas",
        "distractors": {"Utang usaha": "normal_balance_confusion", "Modal": "invented_code"},
    }
    return {**base, **overrides}


def quiz(*questions, title="Latihan jurnal"):
    return json.dumps({"title": title, "questions": list(questions)})


class TestParse:
    def test_valid_questions_keep_only_real_tags_for_wrong_options(self):
        result = parse_quiz(quiz(question(), question(), question()), "seed", 5)

        assert result["title"] == "Latihan jurnal"
        assert len(result["questions"]) == 3
        assert result["questions"][0]["distractors"] == {"Utang usaha": "normal_balance_confusion"}
        assert result["questions"][0]["correctAnswer"] == "Kas"

    def test_the_correct_option_never_carries_a_tag(self):
        result = parse_quiz(quiz(*[question(distractors={"Kas": "debit_credit_swap"})] * 3), "seed", 5)

        assert all(q["distractors"] == {} for q in result["questions"])

    def test_the_order_of_options_is_shuffled_but_the_same_for_the_same_seed(self):
        first = parse_quiz(quiz(*[question()] * 5), "m-1", 5)
        second = parse_quiz(quiz(*[question()] * 5), "m-1", 5)
        other = parse_quiz(quiz(*[question()] * 5), "m-2", 5)

        assert first == second
        assert all(sorted(q["options"]) == sorted(["Kas", "Utang usaha", "Modal", "Pendapatan"]) for q in first["questions"])
        assert [q["options"] for q in first["questions"]] != [q["options"] for q in other["questions"]]

    @pytest.mark.parametrize(
        "bad",
        [
            question(options=["a", "b", "c"]),
            question(options=["Kas", "kas", "Modal", "Pendapatan"]),
            question(correctAnswer="Giro"),
            question(question=""),
        ],
    )
    def test_a_broken_question_is_dropped_and_the_rest_are_kept(self, bad):
        result = parse_quiz(quiz(question(), question(), question(), bad), "seed", 5)

        assert len(result["questions"]) == 3

    def test_fewer_than_three_usable_questions_is_an_error(self):
        with pytest.raises(ValueError):
            parse_quiz(quiz(question(), question(), question(correctAnswer="Giro")), "seed", 5)

    def test_it_never_returns_more_questions_than_asked(self):
        assert len(parse_quiz(quiz(*[question()] * 8), "seed", 4)["questions"]) == 4

    @pytest.mark.parametrize("text", ["bukan json", "[]", '{"title": "x"}', '{"questions": []}'])
    def test_text_that_is_not_a_quiz_is_an_error(self, text):
        with pytest.raises(ValueError):
            parse_quiz(text, "seed", 5)

    def test_a_json_fence_around_the_answer_is_accepted(self):
        result = parse_quiz("```json\n" + quiz(question(), question(), question()) + "\n```", "seed", 5)

        assert len(result["questions"]) == 3


class TestPrompt:
    def test_it_names_the_closed_list_of_misconception_codes_and_the_count(self):
        prompt = build_quiz_prompt(step_title="Jurnal", material="m", retrieved="r", count=6, focus=None, learner_block="", difficulty=0.5)

        assert "exactly 6 multiple-choice" in prompt
        assert all(code in prompt for code in MISCONCEPTION_CODES)
        assert "medium difficulty" in prompt

    @pytest.mark.parametrize(("difficulty", "level"), [(None, "easy"), (0.2, "easy"), (0.5, "medium"), (0.9, "hard")])
    def test_difficulty_follows_the_policy_target(self, difficulty, level):
        prompt = build_quiz_prompt(step_title="Jurnal", material="m", retrieved="r", count=3, focus=None, learner_block="", difficulty=difficulty)

        assert f"at {level} difficulty" in prompt

    def test_a_long_material_is_cut(self):
        prompt = build_quiz_prompt(step_title="Jurnal", material="Ω" * 20000, retrieved="", count=3, focus="piutang", learner_block="", difficulty=None)

        assert prompt.count("Ω") == 4000
        assert "Focus the questions on: piutang" in prompt


def test_the_codes_are_the_same_as_the_ones_the_api_accepts():
    source = (REPO / "services/api/src/v1/quiz/misconception-codes.ts").read_text()
    block = re.search(r"MISCONCEPTION_CODES = \[(.*?)\] as const", source, re.S).group(1)

    assert tuple(re.findall(r"'([a-z_]+)'", block)) == MISCONCEPTION_CODES


class TestSourcesOfQuestions:
    SOURCES = rank_hybrid(
        "jurnal",
        [
            {"refType": "CONCEPT", "refId": "c1", "title": "Konsep: Jurnal Umum", "text": "Jurnal mencatat transaksi."},
            {"refType": "TOPIC", "refId": "t1", "title": "Topik: Akuntansi Dasar", "text": "Urutan referensi akuntansi."},
        ],
    )

    def test_a_question_keeps_the_citations_of_the_documents_it_names(self):
        result = parse_quiz(quiz(*[question(sources=[1, 2, 1])] * 3), "seed", 5, self.SOURCES)

        sources = result["questions"][0]["sources"]
        assert [s["index"] for s in sources] == [1, 2]
        assert all(s["kind"] == "TOPIC" and s["refId"] for s in sources)

    def test_a_question_that_names_only_missing_documents_is_dropped(self):
        result = parse_quiz(quiz(question(sources=[1]), question(sources=[9]), question(sources=[]), question(sources=[2]), question(sources=[1])), "seed", 5, self.SOURCES)

        assert len(result["questions"]) == 3

    def test_at_most_three_sources_per_question(self):
        many = rank_hybrid("a", [{"refType": "CONCEPT", "refId": f"c{i}", "title": f"Konsep {i}", "text": "aset"} for i in range(6)], max_total=6)

        result = parse_quiz(quiz(*[question(sources=[1, 2, 3, 4, 5, 6])] * 3), "seed", 5, many)

        assert all(len(q["sources"]) == 3 for q in result["questions"])

    def test_without_sources_given_the_questions_are_kept_as_before(self):
        result = parse_quiz(quiz(*[question(sources=[1])] * 3), "seed", 5)

        assert len(result["questions"]) == 3 and "sources" not in result["questions"][0]

    def test_the_prompt_asks_for_sources_per_question(self):
        prompt = build_quiz_prompt(step_title="Jurnal", material="m", retrieved="r", count=3, focus=None, learner_block="", difficulty=None)

        assert '"sources": [1]' in prompt and "A question without a real source is not allowed" in prompt
