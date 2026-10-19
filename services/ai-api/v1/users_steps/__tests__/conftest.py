from __future__ import annotations

from unittest.mock import patch

import pytest

TOPIC_RECORDS = {
    "scope": {"lessonTitle": "Apa itu akuntansi"},
    "sources": [
        {"refType": "CONCEPT", "refId": "c1", "title": "Konsep: Persamaan Akuntansi", "text": "Aset sama dengan liabilitas ditambah ekuitas."},
    ],
}


@pytest.fixture(autouse=True)
def topic_records_of_the_lesson():
    with patch("v1.users_steps.generate_quiz_pipeline.fetch_topic_sources", return_value=TOPIC_RECORDS), patch(
        "v1.users_steps.service.fetch_topic_sources", return_value=TOPIC_RECORDS
    ):
        yield
