from __future__ import annotations

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def builtin_chat_prompt():
    with patch("v1.learning.service.resolve_template", return_value=None):
        yield


@pytest.fixture(autouse=True)
def no_topic_source_calls():
    with patch("v1.learning.service.fetch_topic_sources", return_value={"scope": {}, "sources": []}):
        yield
