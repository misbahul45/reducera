from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from config.agent_session import mint_session
from v1.learning import topic_sources as topic_sources_module
from v1.learning.hybrid import bm25, rank_hybrid, rrf, tokenize
from v1.learning.sources import KIND_MATERIAL, KIND_TOPIC, KIND_WEB, render_sources

SESSION = mint_session(acting_user_id="user-1")


def doc(ref_id, title, text, ref_type="CONCEPT"):
    return {"refType": ref_type, "refId": ref_id, "title": title, "text": text}


TOPIC = [
    doc("c1", "Konsep: Persamaan Akuntansi", "Aset sama dengan liabilitas ditambah ekuitas."),
    doc("c2", "Konsep: Jurnal Umum", "Jurnal mencatat setiap transaksi dengan debit dan kredit."),
    doc("c3", "Konsep: Buku Besar", "Buku besar memuat saldo setiap akun setelah posting dari jurnal."),
    doc("t1", "Topik: Akuntansi Dasar", "Urutan referensi pembelajaran akuntansi perguruan tinggi.", "TOPIC"),
]


class TestTokenize:
    def test_it_drops_stopwords_short_words_and_numbers_and_stems_common_affixes(self):
        assert tokenize("Mencatat transaksi dan pembukuan keuangan 2024 di PT") == ["catat", "transaks", "pembuku", "uang"]

    def test_it_matches_a_word_with_and_without_its_affix(self):
        assert tokenize("pencatatan") == tokenize("mencatat") or set(tokenize("pencatatan")) & set(tokenize("mencatat"))

    def test_it_handles_empty_text(self):
        assert tokenize("") == [] and tokenize(None) == []  # type: ignore[arg-type]


class TestBm25:
    def test_a_document_with_the_query_words_scores_above_one_without(self):
        docs = [tokenize("aset liabilitas ekuitas"), tokenize("buku besar saldo akun")]

        scores = bm25(tokenize("persamaan aset ekuitas"), docs)

        assert scores[0] > 0 and scores[1] == 0

    def test_a_rarer_word_counts_more_than_a_common_one(self):
        docs = [tokenize("akuntansi jurnal"), tokenize("akuntansi ledger"), tokenize("akuntansi neraca")]

        rare = bm25(tokenize("jurnal"), docs)[0]
        common = bm25(tokenize("akuntansi"), docs)[0]

        assert rare > common

    def test_no_query_or_no_documents_scores_zero(self):
        assert bm25([], [["a"]]) == [0.0]
        assert bm25(["a"], []) == []


class TestRrf:
    def test_a_key_found_by_two_rankings_beats_one_found_by_one(self):
        fused = rrf([(1.0, ["a", "b"]), (1.0, ["b", "c"])])

        assert fused["b"] > fused["a"] and fused["b"] > fused["c"]

    def test_the_weight_scales_a_ranking(self):
        fused = rrf([(1.0, ["a"]), (0.5, ["b"])])

        assert fused["a"] == pytest.approx(2 * fused["b"])


class TestRankHybrid:
    def test_the_topic_record_that_matches_the_question_comes_first_and_says_it_matched_by_keyword(self):
        sources = rank_hybrid("apa itu persamaan akuntansi dan ekuitas", TOPIC)

        assert sources[0].title == "Konsep: Persamaan Akuntansi"
        assert sources[0].kind == KIND_TOPIC and "LEXICAL" in sources[0].via
        assert [s.index for s in sources] == list(range(1, len(sources) + 1))

    def test_it_works_without_any_embedding_result_so_a_dead_embedding_provider_does_not_empty_the_sources(self):
        sources = rank_hybrid("jurnal transaksi debit", TOPIC, rag_results=[], web_results=[])

        assert sources and sources[0].title == "Konsep: Jurnal Umum"

    def test_a_question_that_matches_nothing_still_gets_the_records_of_the_scope_as_context(self):
        sources = rank_hybrid("zzzz qqqq", TOPIC)

        assert len(sources) == 3
        assert all(s.kind == KIND_TOPIC and s.via == ("SCOPE",) for s in sources)

    def test_a_semantic_chunk_of_a_resource_of_the_topic_merges_with_that_record_and_shows_both_channels(self):
        topic = [doc("r1", "Buku Akuntansi Dasar", "Aset adalah sumber daya ekonomi yang dikuasai entitas.", "RESOURCE")]
        rag = [{"text": "Aset adalah sumber daya ekonomi.", "score": 0.9, "metadata": {"resource_id": "r1", "chunk_id": "k1"}}]

        sources = rank_hybrid("apa itu aset", topic, rag_results=rag)

        assert len(sources) == 1
        assert sources[0].title == "Buku Akuntansi Dasar"
        assert set(sources[0].via) == {"LEXICAL", "SEMANTIC"}

    def test_a_semantic_chunk_from_elsewhere_is_a_material_source_after_the_topic_records(self):
        rag = [{"text": "Materi lain tentang neraca saldo.", "score": 0.8, "metadata": {"lesson_id": "l-9", "chunk_id": "k2"}}]

        sources = rank_hybrid("persamaan akuntansi", TOPIC, rag_results=rag)

        kinds = [s.kind for s in sources]
        assert KIND_MATERIAL in kinds and kinds[0] == KIND_TOPIC
        assert [s for s in sources if s.kind == KIND_MATERIAL][0].lesson_id == "l-9"

    def test_the_web_is_used_only_when_asked_for_and_only_with_a_web_link(self):
        web = [
            {"title": "Jurnal umum", "url": "https://contoh.id/jurnal", "snippet": "Contoh jurnal umum."},
            {"title": "Bad", "url": "javascript:alert(1)", "snippet": "x"},
        ]

        without = rank_hybrid("jurnal umum", TOPIC, web_results=web, include_web=False)
        with_web = rank_hybrid("jurnal umum", TOPIC, web_results=web, include_web=True)

        assert all(s.kind != KIND_WEB for s in without)
        web_sources = [s for s in with_web if s.kind == KIND_WEB]
        assert [s.url for s in web_sources] == ["https://contoh.id/jurnal"]

    def test_the_records_of_the_topic_are_never_pushed_out_by_the_web(self):
        web = [{"title": f"Web {i}", "url": f"https://contoh.id/{i}", "snippet": "jurnal umum transaksi"} for i in range(8)]

        sources = rank_hybrid("jurnal umum transaksi", TOPIC, web_results=web, include_web=True, max_total=5)

        assert len([s for s in sources if s.kind == KIND_TOPIC]) >= 3

    def test_without_topic_records_the_semantic_and_web_results_still_work(self):
        rag = [{"text": "Isi materi.", "score": 0.7, "metadata": {"chunk_id": "k"}}]

        sources = rank_hybrid("materi", [], rag_results=rag)

        assert [s.kind for s in sources] == [KIND_MATERIAL]

    def test_nothing_in_gives_nothing_out(self):
        assert rank_hybrid("apa saja", [], [], []) == []

    def test_a_record_without_text_or_id_is_ignored(self):
        assert rank_hybrid("aset", [doc("", "x", "aset"), doc("c", "y", "  ")]) == []

    def test_the_numbers_are_unique_and_the_prompt_shows_each_record_under_its_number(self):
        sources = rank_hybrid("persamaan akuntansi", TOPIC)

        rendered = render_sources(sources, (KIND_TOPIC,))

        for source in sources:
            assert f'<retrieved_document id="{source.index}" source="topic-database"' in rendered
        assert render_sources(sources, KIND_WEB) == ""

    def test_the_citation_names_the_record_it_came_from(self):
        (first, *_) = rank_hybrid("persamaan akuntansi", TOPIC)

        citation = first.as_citation()

        assert citation["refType"] == "CONCEPT" and citation["refId"] == "c1"
        assert citation["kind"] == "TOPIC" and "url" not in citation


class TestFetch:
    def test_it_asks_the_api_for_the_records_of_the_step(self):
        client = MagicMock()
        client.get.return_value = {"scope": {"lessonTitle": "Apa itu akuntansi"}, "sources": [{"refId": "c1"}, "bukan objek"]}

        with patch.object(topic_sources_module, "InternalApiClient", return_value=client):
            data = topic_sources_module.fetch_topic_sources(SESSION, user_step_id="us-1")

        client.get.assert_called_once_with("/internal/topic-sources", params={"userStepId": "us-1"})
        assert data["sources"] == [{"refId": "c1"}]

    def test_without_a_lesson_or_step_nothing_is_asked(self):
        with patch.object(topic_sources_module, "InternalApiClient") as client:
            assert topic_sources_module.fetch_topic_sources(SESSION) == {"scope": {}, "sources": []}

        client.assert_not_called()

    @pytest.mark.parametrize("failure", [RuntimeError("down"), ValueError("bad")])
    def test_a_failure_leaves_the_answer_without_records_instead_of_failing_it(self, failure):
        client = MagicMock()
        client.get.side_effect = failure

        with patch.object(topic_sources_module, "InternalApiClient", return_value=client):
            assert topic_sources_module.fetch_topic_sources(SESSION, lesson_id="l-1") == {"scope": {}, "sources": []}

    def test_an_answer_that_is_not_an_object_is_ignored(self):
        client = MagicMock()
        client.get.return_value = ["x"]

        with patch.object(topic_sources_module, "InternalApiClient", return_value=client):
            assert topic_sources_module.fetch_topic_sources(SESSION, lesson_id="l-1")["sources"] == []

    def test_the_scope_is_one_short_block_of_titles(self):
        line = topic_sources_module.scope_line({"topicTitle": "Akuntansi Dasar", "lessonTitle": "Apa itu akuntansi", "stepTitle": None})

        assert line == "Topik: Akuntansi Dasar\nPelajaran: Apa itu akuntansi"


def test_the_records_of_the_topic_always_come_before_the_materials_and_the_web_even_when_they_match_less():
    rag = [{"text": "Materi tentang neraca saldo.", "score": 0.9, "metadata": {"chunk_id": "k"}}]
    web = [{"title": "Neraca saldo", "url": "https://contoh.id/n", "snippet": "neraca saldo adalah"}]

    sources = rank_hybrid("neraca saldo", TOPIC, rag_results=rag, web_results=web, include_web=True)

    kinds = [s.kind for s in sources]
    assert kinds == sorted(kinds, key=lambda kind: {"TOPIC": 0, "MATERIAL": 1, "WEB": 2}[kind])
    assert kinds[0] == "TOPIC"
