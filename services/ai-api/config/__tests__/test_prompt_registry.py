from __future__ import annotations

import re
from pathlib import Path

import pytest

from config.agent_session import mint_session
from config import prompt_registry
from config.prompt_registry import (
    CACHE_TTL_SECONDS,
    PROMPT_CONTRACTS,
    clear_cache,
    render_template,
    resolve_template,
    template_problems,
)
from v1.learning.chat_template import BUILTIN_CHAT_TEMPLATE

SESSION = mint_session(acting_user_id="user-1")

FILLER = "Teach with care. " * 15
VALID = f"{FILLER} {{{{user_step_title}}}} {{{{domain_block}}}} {{{{learner_section}}}} {{{{user_input}}}} {{{{rag}}}} {{{{web}}}} {{{{memory}}}} {{{{conversation}}}} {{{{current_material}}}}"

REPO = next((parent for parent in Path(__file__).resolve().parents if (parent / "services" / "api").is_dir()), None)


@pytest.fixture(autouse=True)
def fresh_cache():
    clear_cache()
    yield
    clear_cache()


def reply(body: str = VALID, label: str = "tutor-chat@3", arm: str = "canary") -> dict:
    return {"data": {"label": label, "version": 3, "body": body, "modelName": "router-default", "arm": arm}}


class TestRequestDelimiters:
    @pytest.mark.parametrize("delimiter", ["<<<TEMPLATE", "TEMPLATE>>>"])
    def test_a_template_that_carries_a_delimiter_of_the_proposal_request_is_refused(self, delimiter):
        assert any("request delimiter" in item for item in template_problems("tutor-chat", f"{delimiter}\n{VALID}"))

    def test_a_clean_template_has_none(self):
        assert template_problems("tutor-chat", VALID) == []


class TestRender:
    def test_every_placeholder_is_replaced_and_missing_values_become_empty(self):
        assert render_template("a {{ rag }} b {{web}} c {{memory}}", {"rag": "R", "web": "W"}) == "a R b W c "

    def test_a_value_is_never_expanded_again(self):
        assert render_template("{{rag}}", {"rag": "{{memory}}", "memory": "secret"}) == "{{memory}}"


class TestContract:
    def test_a_template_with_every_required_placeholder_is_valid(self):
        assert template_problems("tutor-chat", VALID) == []

    def test_unknown_missing_and_malformed_placeholders_are_named(self):
        assert template_problems("tutor-chat", VALID + " {{api_key}}") == ["Unknown placeholder {{api_key}}"]
        assert template_problems("tutor-chat", VALID.replace("{{rag}}", "")) == ["Missing required placeholder {{rag}}"]
        assert "A placeholder is malformed" in template_problems("tutor-chat", VALID + " {{memory")

    def test_the_builtin_template_satisfies_its_own_contract(self):
        assert template_problems("tutor-chat", BUILTIN_CHAT_TEMPLATE) == []

    @pytest.mark.skipif(REPO is None, reason="the api service is not part of this checkout")
    def test_the_contract_matches_the_one_of_the_api(self):
        source = (REPO / "services/api/src/v1/optimization/prompt-contracts.ts").read_text()
        required = re.search(r"required: \[([^\]]*)\]", source).group(1)
        optional = re.search(r"optional: \[([^\]]*)\]", source).group(1)
        names = lambda text: tuple(re.findall(r"'([a-z_]+)'", text))
        assert names(required) == PROMPT_CONTRACTS["tutor-chat"]["required"]
        assert names(optional) == PROMPT_CONTRACTS["tutor-chat"]["optional"]

    @pytest.mark.skipif(REPO is None, reason="the api service is not part of this checkout")
    def test_the_builtin_template_is_the_canonical_file_of_the_api(self):
        canonical = (REPO / "services/api/prisma/seed-data/prompt-templates/tutor-chat.txt").read_text()
        assert BUILTIN_CHAT_TEMPLATE == canonical


class TestResolve:
    def test_a_valid_answer_becomes_a_template_with_its_label_and_arm(self, internal_wire):
        internal_wire.respond(200, reply())

        resolved = resolve_template(SESSION, "tutor-chat")

        assert (resolved.label, resolved.arm, resolved.body) == ("tutor-chat@3", "canary", VALID)
        assert internal_wire.sent[0].url.split("?")[0].endswith("/internal/prompts/resolve")
        assert "name=tutor-chat" in internal_wire.sent[0].url

    def test_the_answer_is_cached_for_a_minute_per_learner(self, internal_wire):
        internal_wire.respond(200, reply())

        resolve_template(SESSION, "tutor-chat", now=100.0)
        resolve_template(SESSION, "tutor-chat", now=100.0 + CACHE_TTL_SECONDS - 1)
        assert len(internal_wire.sent) == 1

        resolve_template(SESSION, "tutor-chat", now=100.0 + CACHE_TTL_SECONDS + 1)
        assert len(internal_wire.sent) == 2

    def test_no_live_version_means_the_builtin_prompt(self, internal_wire):
        internal_wire.respond(200, {"data": None})

        assert resolve_template(SESSION, "tutor-chat") is None

    def test_an_invalid_template_is_ignored_instead_of_being_sent_to_the_model(self, internal_wire):
        internal_wire.respond(200, reply(body="short {{api_key}}"))

        assert resolve_template(SESSION, "tutor-chat") is None

    def test_a_failing_registry_falls_back_and_is_not_asked_again_for_a_few_seconds(self, internal_wire):
        internal_wire.respond(500, {"message": "boom"})

        assert resolve_template(SESSION, "tutor-chat", now=500.0) is None
        assert resolve_template(SESSION, "tutor-chat", now=503.0) is None
        assert len(internal_wire.sent) == 1

        internal_wire.respond(200, reply())
        assert resolve_template(SESSION, "tutor-chat", now=511.0).label == "tutor-chat@3"

    def test_an_unexpected_arm_is_not_trusted(self, internal_wire):
        internal_wire.respond(200, reply(arm="everyone"))

        assert resolve_template(SESSION, "tutor-chat") is None


def test_the_cache_is_bounded(internal_wire):
    internal_wire.respond(200, reply())
    for index in range(prompt_registry.CACHE_LIMIT + 5):
        resolve_template(mint_session(acting_user_id=f"user-{index}"), "tutor-chat", now=1.0)

    assert len(prompt_registry._cache) <= prompt_registry.CACHE_LIMIT
