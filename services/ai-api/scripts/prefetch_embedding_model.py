from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("prefetch-embedding-model")

ALLOW_PATTERNS = (
    "*.json",
    "*.model",
    "pytorch_model.bin",
    "model.safetensors",
    "tokenizer*",
    "sentencepiece*",
)
DOWNLOAD_WORKERS = 8


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Download an embedding model into a local directory for EMBEDDING_PROVIDER=local")
    parser.add_argument("repo_id", help="model repository, for example BAAI/bge-m3")
    parser.add_argument("target", type=Path, help="directory that LOCAL_EMBEDDING_MODEL points to")
    args = parser.parse_args(argv)

    args.target.mkdir(parents=True, exist_ok=True)
    path = snapshot_download(
        repo_id=args.repo_id,
        local_dir=str(args.target),
        allow_patterns=list(ALLOW_PATTERNS),
        max_workers=DOWNLOAD_WORKERS,
    )
    log.info("model stored in %s", path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
