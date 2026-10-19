import logging
import os
import threading
from pathlib import Path
from typing import Callable, List

import numpy as np
from llama_index.core.base.embeddings.base import BaseEmbedding
from pydantic import PrivateAttr

logger = logging.getLogger("local_embedding")

SUB_BATCH_SIZE = 8
READAHEAD_MIN_BYTES = 1_000_000

Encoder = Callable[[List[str]], np.ndarray]


class LocalEmbedding(BaseEmbedding):
    dimensions: int
    max_length: int = 512
    threads: int = 4
    allow_download: bool = False

    _encoder: Encoder | None = PrivateAttr(default=None)
    _load_lock: threading.Lock = PrivateAttr(default_factory=threading.Lock)
    _infer_lock: threading.Lock = PrivateAttr(default_factory=threading.Lock)
    _loader: Callable[[], Encoder] | None = PrivateAttr(default=None)

    def __init__(self, loader: Callable[[], Encoder] | None = None, **data):
        super().__init__(**data)
        self._loader = loader or self._load_transformers

    @classmethod
    def class_name(cls) -> str:
        return "LocalEmbedding"

    @property
    def loaded(self) -> bool:
        return self._encoder is not None

    def warm_up(self) -> None:
        self._ensure_loaded()
        self._read_ahead()

    def _read_ahead(self) -> None:
        directory = Path(self.model_name)
        if not directory.is_dir() or not hasattr(os, "posix_fadvise"):
            return
        for path in directory.iterdir():
            if not path.is_file() or path.stat().st_size < READAHEAD_MIN_BYTES:
                continue
            with path.open("rb") as handle:
                os.posix_fadvise(handle.fileno(), 0, 0, os.POSIX_FADV_WILLNEED)

    def _ensure_loaded(self) -> Encoder:
        if self._encoder is not None:
            return self._encoder
        with self._load_lock:
            if self._encoder is None:
                self._encoder = self._loader()
        return self._encoder

    def _load_transformers(self) -> Encoder:
        import torch
        from transformers import AutoModel, AutoTokenizer

        torch.set_num_threads(self.threads)
        options = {"local_files_only": not self.allow_download}
        try:
            tokenizer = AutoTokenizer.from_pretrained(self.model_name, **options)
            model = AutoModel.from_pretrained(self.model_name, **options).eval()
        except OSError as exc:
            raise RuntimeError(
                f"embedding model '{self.model_name}' is not available locally; "
                "place it in the model directory or set LOCAL_EMBEDDING_ALLOW_DOWNLOAD=true"
            ) from exc

        def encode(texts: List[str]) -> np.ndarray:
            batch = tokenizer(
                texts,
                padding=True,
                truncation=True,
                max_length=self.max_length,
                return_tensors="pt",
            )
            with torch.inference_mode():
                pooled = model(**batch).last_hidden_state[:, 0]
                normalized = torch.nn.functional.normalize(pooled, dim=-1)
            return normalized.float().numpy()

        logger.info("local embedding model loaded: %s", self.model_name)
        return encode

    def _encode(self, texts: List[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dimensions))
        encoder = self._ensure_loaded()
        order = sorted(range(len(texts)), key=lambda index: len(texts[index]))
        rows: dict[int, np.ndarray] = {}
        with self._infer_lock:
            for start in range(0, len(order), SUB_BATCH_SIZE):
                indices = order[start : start + SUB_BATCH_SIZE]
                matrix = encoder([texts[index] for index in indices])
                if matrix.ndim != 2 or matrix.shape[0] != len(indices):
                    raise RuntimeError(f"unexpected embedding shape {matrix.shape}")
                if matrix.shape[1] != self.dimensions:
                    raise RuntimeError(
                        f"embedding dimension {matrix.shape[1]} does not match "
                        f"EMBEDDING_DIM={self.dimensions}"
                    )
                for position, index in enumerate(indices):
                    rows[index] = matrix[position]
        return np.stack([rows[index] for index in range(len(texts))])

    def _get_query_embedding(self, query: str) -> List[float]:
        return self._encode([query])[0].tolist()

    def _get_text_embedding(self, text: str) -> List[float]:
        return self._encode([text])[0].tolist()

    def _get_text_embeddings(self, texts: List[str]) -> List[List[float]]:
        return [row.tolist() for row in self._encode(texts)]

    async def _aget_query_embedding(self, query: str) -> List[float]:
        return self._get_query_embedding(query)

    async def _aget_text_embedding(self, text: str) -> List[float]:
        return self._get_text_embedding(text)
