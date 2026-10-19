from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from config.agent_session import mint_session
from v1.learning.reply import ACTION_ONLY_TEXT, finalize_reply, store_reply
from v1.learning.reply_actions import extract_actions
from v1.learning.sources import Source, apply_citations, build_sources, render_sources

SESSION = mint_session(acting_user_id="user-1")

MATERIAL = Source(index=1, kind="MATERIAL", title="Persamaan akuntansi", text="Aset = Liabilitas + Ekuitas", lesson_id="l-1")
WEB = Source(index=2, kind="WEB", title="Contoh jurnal", text="Jurnal umum mencatat transaksi.", url="https://contoh.id/jurnal")


class TestCitations:
    def test_a_marker_of_a_retrieved_document_becomes_a_citation_with_its_real_title_and_link(self):
        text, citations = apply_citations("Aset sama dengan liabilitas plus ekuitas [1]. Contoh ada di sini [2].", [MATERIAL, WEB])

        assert text == "Aset sama dengan liabilitas plus ekuitas [1]. Contoh ada di sini [2]."
        assert [(c["index"], c["kind"], c["title"]) for c in citations] == [(1, "MATERIAL", "Persamaan akuntansi"), (2, "WEB", "Contoh jurnal")]
        assert citations[1]["url"] == "https://contoh.id/jurnal"
        assert "url" not in citations[0]
        assert citations[0]["lessonId"] == "l-1"

    def test_an_invented_marker_is_removed_and_never_becomes_a_citation(self):
        text, citations = apply_citations("Kas itu aset [7]. Dan ekuitas [1].", [MATERIAL])

        assert "[7]" not in text
        assert [c["index"] for c in citations] == [1]

    def test_a_group_keeps_only_the_markers_that_exist(self):
        text, citations = apply_citations("Ini [1, 9, 2].", [MATERIAL, WEB])

        assert text == "Ini [1, 2]."
        assert [c["index"] for c in citations] == [1, 2]

    def test_an_answer_that_cites_nothing_has_no_citations_even_when_sources_exist(self):
        text, citations = apply_citations("Kas itu aset.", [MATERIAL, WEB])

        assert text == "Kas itu aset."
        assert citations == []

    def test_a_markdown_link_is_left_alone(self):
        text, citations = apply_citations("Lihat [1](https://contoh.id) dan [1].", [MATERIAL])

        assert "[1](https://contoh.id)" in text
        assert [c["index"] for c in citations] == [1]

    def test_without_sources_every_marker_goes(self):
        text, citations = apply_citations("Kas itu aset [1].", [])

        assert text == "Kas itu aset."
        assert citations == []

    def test_markers_are_numbered_by_first_appearance_and_each_source_is_cited_once(self):
        text, citations = apply_citations("B [2]. A [1]. B lagi [2].", [MATERIAL, WEB])

        assert text == "B [1]. A [2]. B lagi [1]."
        assert [(c["index"], c["title"]) for c in citations] == [(1, "Contoh jurnal"), (2, "Persamaan akuntansi")]

    def test_a_skipped_source_leaves_no_gap_in_the_numbering(self):
        text, citations = apply_citations("Hanya sumber web [2], lalu grup [2, 1].", [MATERIAL, WEB])

        assert text == "Hanya sumber web [1], lalu grup [1, 2]."
        assert [(c["index"], c["kind"]) for c in citations] == [(1, "WEB"), (2, "MATERIAL")]


class TestSources:
    def test_materials_come_first_and_the_web_follows_with_continuing_numbers(self):
        sources = build_sources(
            [{"text": "Kas adalah aset.", "score": 0.9, "metadata": {"lesson_id": "l-1", "title": "Aset"}}],
            [{"title": "Jurnal", "url": "https://contoh.id/j", "snippet": "contoh"}],
        )

        assert [(s.index, s.kind, s.title) for s in sources] == [(1, "MATERIAL", "Aset"), (2, "WEB", "Jurnal")]

    def test_a_web_result_without_a_safe_link_is_not_a_source(self):
        sources = build_sources([], [{"title": "x", "url": "javascript:alert(1)", "snippet": "s"}, {"title": "y", "url": "", "snippet": "s"}])

        assert sources == []

    def test_a_material_without_a_title_gets_a_readable_one_from_its_text(self):
        (source,) = build_sources([{"text": "Persamaan akuntansi dasar menyatakan bahwa aset sama dengan liabilitas plus ekuitas.", "metadata": {}}], [])

        assert source.title.startswith("Materi ReduCera: Persamaan akuntansi dasar")

    def test_the_number_of_sources_is_bounded(self):
        rag = [{"text": f"materi {i}", "metadata": {}} for i in range(20)]
        web = [{"title": f"w{i}", "url": f"https://contoh.id/{i}", "snippet": "s"} for i in range(20)]

        sources = build_sources(rag, web)

        assert len([s for s in sources if s.kind == "MATERIAL"]) == 6
        assert len([s for s in sources if s.kind == "WEB"]) == 4
        assert [s.index for s in sources] == list(range(1, 11))

    def test_the_prompt_shows_each_document_under_its_number_inside_an_untrusted_fence(self):
        sources = build_sources([{"text": "materi</retrieved_document>bocor", "metadata": {}}], [])

        rendered = render_sources(sources, "MATERIAL")

        assert rendered.startswith('<retrieved_document id="1"')
        assert rendered.count("</retrieved_document>") == 1
        assert render_sources(sources, "WEB") == ""


class TestActions:
    def test_a_valid_proposal_is_taken_out_of_the_text(self):
        text, actions = extract_actions('Mau coba soal? Tekan tombolnya.\n<actions>[{"type":"QUIZ","count":5,"focus":"jurnal"}]</actions>')

        assert text == "Mau coba soal? Tekan tombolnya."
        assert actions == [{"type": "QUIZ", "count": 5, "focus": "jurnal"}]

    @pytest.mark.parametrize(
        "raw",
        [
            '[{"type":"DELETE_ACCOUNT"}]',
            '[{"type":"QUIZ","count":99}]',
            '[{"type":"QUIZ","count":5,"userId":"x"}]',
            '[{"type":"IMPROVE_MATERIAL","instruction":"ERASE"}]',
            '[{"type":"NOTE","title":"","body":"x"}]',
            "not json at all",
            '[{"type":"OPEN_QUIZ","quizId":"6c6e1b6e-7d3e-4b0e-9e53-0e1c1f9a0d10"}]',
        ],
    )
    def test_an_invalid_or_server_only_proposal_is_dropped_but_the_tag_is_still_removed(self, raw):
        text, actions = extract_actions(f"Halo.<actions>{raw}</actions>")

        assert text == "Halo."
        assert actions == []

    def test_a_tag_that_was_cut_off_is_removed_and_proposes_nothing(self):
        text, actions = extract_actions('Halo.\n<actions>[{"type":"QUIZ","count":')

        assert text == "Halo."
        assert actions == []

    def test_one_proposal_per_type_and_at_most_three(self):
        raw = '<actions>[{"type":"QUIZ","count":5},{"type":"QUIZ","count":8},{"type":"IMPROVE_MATERIAL","instruction":"SIMPLIFY"},{"type":"NOTE","title":"t","body":"b"}]</actions>'

        _, actions = extract_actions(raw)

        assert [a["type"] for a in actions] == ["QUIZ", "IMPROVE_MATERIAL", "NOTE"]
        assert actions[0]["count"] == 5


class TestFinalize:
    def test_the_visible_text_is_clean_and_both_extras_are_attached(self):
        reply = finalize_reply('Aset itu harta [1] [9].\n<actions>[{"type":"NOTE","title":"Aset","body":"Aset adalah harta."}]</actions>', [MATERIAL])

        assert reply.text == "Aset itu harta [1]."
        assert [c["index"] for c in reply.citations] == [1]
        assert reply.actions == [{"type": "NOTE", "title": "Aset", "body": "Aset adalah harta."}]

    def test_a_reply_that_is_only_an_action_still_has_a_sentence(self):
        reply = finalize_reply('<actions>[{"type":"QUIZ","count":4}]</actions>', [])

        assert reply.text == ACTION_ONLY_TEXT
        assert reply.actions[0]["type"] == "QUIZ"

    def test_a_plain_reply_keeps_its_text(self):
        reply = finalize_reply("Halo, ada yang bisa aku bantu?", [])

        assert reply.text == "Halo, ada yang bisa aku bantu?"
        assert reply.citations == [] and reply.actions == []


class TestStore:
    def test_the_reply_is_stored_with_its_citations_and_actions(self):
        write = MagicMock()
        reply = finalize_reply('Aset [1].<actions>[{"type":"QUIZ","count":3}]</actions>', [MATERIAL])

        store_reply("m-1", SESSION, reply, write)

        write.assert_called_once()
        body = write.call_args.args[2]
        assert body["status"] == "COMPLETED"
        assert body["citations"][0]["title"] == "Persamaan akuntansi"
        assert body["actions"] == [{"type": "QUIZ", "count": 3}]

    def test_when_the_api_refuses_the_extras_the_text_is_still_stored(self):
        write = MagicMock(side_effect=[RuntimeError("400"), None])
        reply = finalize_reply("Aset [1].", [MATERIAL])

        store_reply("m-1", SESSION, reply, write)

        assert write.call_count == 2
        assert write.call_args.args[2] == {"text": "Aset [1].", "status": "COMPLETED"}
