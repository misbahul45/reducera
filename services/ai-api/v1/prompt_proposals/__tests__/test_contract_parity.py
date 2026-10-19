from __future__ import annotations

import re
from pathlib import Path

from v1.prompt_proposals.proposer import PROTECTED_PHRASES

REPO = next((parent for parent in Path(__file__).resolve().parents if (parent / "services" / "api").is_dir()), None)


def test_the_protected_sentences_are_the_same_in_api_and_ai_api():
    assert REPO is not None
    source = (REPO / "services/api/src/v1/optimization/prompt-contracts.ts").read_text()
    block = re.search(r"protectedPhrases:\s*\[(.*?)\]\s*,\s*\}", source, re.S)
    assert block is not None
    phrases = tuple(match.replace("\\'", "'") for match in re.findall(r"'((?:[^'\\]|\\.)*)'", block.group(1)))

    assert phrases == PROTECTED_PHRASES["tutor-chat"]
