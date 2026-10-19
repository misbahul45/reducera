import os
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest

from config import celery as celery_config
from config import providers
from config.local_embedding import SUB_BATCH_SIZE, LocalEmbedding
from config.providers import HuggingFaceEmbedding

DIM = 3


def length_encoder(calls):
    def encode(texts):
        calls.append(list(texts))
        return np.array([[float(len(text)), 1.0, 0.0] for text in texts])

    return encode


def make_embedding(calls=None, loader_calls=None, dimensions=DIM):
    calls = calls if calls is not None else []
    loader_calls = loader_calls if loader_calls is not None else []

    def loader():
        loader_calls.append(1)
        return length_encoder(calls)

    return LocalEmbedding(model_name="org/model", dimensions=dimensions, loader=loader)


def test_nothing_loads_until_the_first_embedding():
    loader_calls = []
    embedding = make_embedding(loader_calls=loader_calls)

    assert loader_calls == [] and embedding.loaded is False

    embedding._get_text_embedding("abc")
    embedding._get_query_embedding("abcd")

    assert loader_calls == [1] and embedding.loaded is True


def test_warm_up_loads_the_model_once():
    loader_calls = []
    embedding = make_embedding(loader_calls=loader_calls)

    embedding.warm_up()
    embedding.warm_up()

    assert loader_calls == [1]


def test_warm_up_asks_the_system_to_read_large_model_files_ahead(tmp_path, monkeypatch):
    (tmp_path / "weights.bin").write_bytes(b"0" * 1_200_000)
    (tmp_path / "config.json").write_text("{}")
    advised = []
    monkeypatch.setattr(os, "posix_fadvise", lambda fd, offset, length, advice: advised.append((offset, length, advice)))
    embedding = LocalEmbedding(model_name=str(tmp_path), dimensions=DIM, loader=lambda: length_encoder([]))

    embedding.warm_up()

    assert advised == [(0, 0, os.POSIX_FADV_WILLNEED)]


def test_warm_up_of_a_repository_id_only_loads(monkeypatch):
    monkeypatch.setattr(os, "posix_fadvise", lambda *args: pytest.fail("no directory to read ahead"))
    embedding = make_embedding()

    embedding.warm_up()

    assert embedding.loaded is True


def test_order_of_the_input_is_kept_across_sub_batches():
    calls = []
    texts = ["x" * size for size in range(1, 2 * SUB_BATCH_SIZE + 4)][::-1]

    vectors = make_embedding(calls=calls)._get_text_embeddings(texts)

    assert [vector[0] for vector in vectors] == [float(len(text)) for text in texts]
    assert all(len(batch) <= SUB_BATCH_SIZE for batch in calls)


def test_texts_of_similar_length_share_a_batch():
    calls = []
    texts = ["a" * 40, "b", "c" * 41, "d"] + ["e" * 2] * (SUB_BATCH_SIZE - 2)

    make_embedding(calls=calls)._get_text_embeddings(texts)

    first = calls[0]
    assert max(len(text) for text in first) < 40


def test_empty_batch_never_loads_the_model():
    loader_calls = []

    assert make_embedding(loader_calls=loader_calls)._get_text_embeddings([]) == []
    assert loader_calls == []


def test_dimension_mismatch_is_rejected():
    with pytest.raises(RuntimeError, match="EMBEDDING_DIM"):
        make_embedding(dimensions=DIM + 1)._get_text_embedding("x")


def test_encoder_returning_the_wrong_row_count_is_rejected():
    embedding = LocalEmbedding(
        model_name="org/model",
        dimensions=DIM,
        loader=lambda: (lambda texts: np.zeros((len(texts) + 1, DIM))),
    )

    with pytest.raises(RuntimeError, match="unexpected embedding shape"):
        embedding._get_text_embedding("x")


def test_missing_model_files_name_the_remedy(monkeypatch):
    def missing(*args, **kwargs):
        raise OSError("no files")

    fake = ModuleType("transformers")
    fake.AutoTokenizer = SimpleNamespace(from_pretrained=missing)
    fake.AutoModel = SimpleNamespace(from_pretrained=missing)
    monkeypatch.setitem(sys.modules, "transformers", fake)

    with pytest.raises(RuntimeError, match="LOCAL_EMBEDDING_ALLOW_DOWNLOAD"):
        LocalEmbedding(model_name="org/model", dimensions=DIM)._get_text_embedding("x")


def test_local_files_only_is_the_default(monkeypatch):
    seen = {}

    def tokenizer(name, **kwargs):
        seen["tokenizer"] = kwargs
        raise OSError("stop")

    fake = ModuleType("transformers")
    fake.AutoTokenizer = SimpleNamespace(from_pretrained=tokenizer)
    fake.AutoModel = SimpleNamespace(from_pretrained=tokenizer)
    monkeypatch.setitem(sys.modules, "transformers", fake)

    with pytest.raises(RuntimeError):
        LocalEmbedding(model_name="org/model", dimensions=DIM)._get_text_embedding("x")
    assert seen["tokenizer"] == {"local_files_only": True}

    with pytest.raises(RuntimeError):
        LocalEmbedding(model_name="org/model", dimensions=DIM, allow_download=True)._get_text_embedding("x")
    assert seen["tokenizer"] == {"local_files_only": False}


def settings(**overrides):
    base = {
        "EMBEDDING_PROVIDER": "huggingface",
        "HF_EMBEDDING_MODEL": "org/model",
        "HF_EMBEDDING_URL": "https://hf.example/{model}",
        "HF_TOKEN": "token",
        "EMBEDDING_DIM": DIM,
        "LOCAL_EMBEDDING_MODEL": "/models/bge-m3",
        "LOCAL_EMBEDDING_THREADS": 2,
        "LOCAL_EMBEDDING_MAX_LENGTH": 256,
        "LOCAL_EMBEDDING_PRELOAD": False,
        "LOCAL_EMBEDDING_ALLOW_DOWNLOAD": False,
    }
    base.update(overrides)
    return base


def test_huggingface_stays_the_default_provider(monkeypatch):
    monkeypatch.setattr(providers, "ENVS", settings())

    assert isinstance(providers.build_embedding_model(), HuggingFaceEmbedding)


def test_local_provider_is_built_from_its_settings(monkeypatch):
    monkeypatch.setattr(providers, "ENVS", settings(EMBEDDING_PROVIDER="local"))

    model = providers.build_embedding_model()

    assert isinstance(model, LocalEmbedding)
    assert (model.model_name, model.dimensions, model.max_length, model.threads) == ("/models/bge-m3", DIM, 256, 2)
    assert model.allow_download is False and model.loaded is False


def test_unknown_provider_is_refused(monkeypatch):
    monkeypatch.setattr(providers, "ENVS", settings(EMBEDDING_PROVIDER="nowhere"))

    with pytest.raises(ValueError, match="EMBEDDING_PROVIDER"):
        providers.build_embedding_model()


def install_pipeline(monkeypatch):
    embed_model = MagicMock()
    pipeline = ModuleType("config.embedding_pipeline")
    pipeline.embed_model = embed_model
    monkeypatch.setitem(sys.modules, "config.embedding_pipeline", pipeline)
    return embed_model


def test_worker_preload_warms_the_local_model(monkeypatch):
    embed_model = install_pipeline(monkeypatch)
    monkeypatch.setattr("config.envs.ENVS", settings(EMBEDDING_PROVIDER="local", LOCAL_EMBEDDING_PRELOAD=True))

    celery_config.preload_local_embedding()

    embed_model.warm_up.assert_called_once_with()


@pytest.mark.parametrize(
    "overrides",
    [
        {"EMBEDDING_PROVIDER": "local", "LOCAL_EMBEDDING_PRELOAD": False},
        {"EMBEDDING_PROVIDER": "huggingface", "LOCAL_EMBEDDING_PRELOAD": True},
    ],
)
def test_worker_preload_does_nothing_otherwise(monkeypatch, overrides):
    embed_model = install_pipeline(monkeypatch)
    monkeypatch.setattr("config.envs.ENVS", settings(**overrides))

    celery_config.preload_local_embedding()

    embed_model.warm_up.assert_not_called()
