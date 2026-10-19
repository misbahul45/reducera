# ADR-030: Local CPU embeddings as a provider next to Hugging Face Inference

- Status: built and live on the dev stack on 2026-10-17; the choice of provider for the competition host waits for the owner
- Date: 2026-10-17

## Context

Embeddings came only from Hugging Face Inference. The token has no credit (HTTP 402, CP-10), so retrieval was down: the Qdrant collections held 0 points, chat retrieval returned nothing and lesson introductions printed that search by meaning was off. `AGENTS.md` said "No embedding model runs inside a container". The owner asked to try the model locally on CPU and to know whether that is heavy.

## Decision

1. `EMBEDDING_PROVIDER` selects the provider (`huggingface` stays the default, `local` is new). The variable already existed in both compose files and was unused.
2. `local` runs `BAAI/bge-m3` (the model the project already used, 1024 dimensions, CLS vector normalised) with `transformers` on the CPU build of `torch` that the image already contained. Vectors keep the same space and size, so no collection changes. Implementation: `services/ai-api/config/local_embedding.py` (lazy load, length-sorted sub-batches of 8, one inference at a time per process, an error that names the remedy when the weights are missing).
3. The weights (2.27 GB `pytorch_model.bin` plus tokenizer files) live in the git-ignored `./models/bge-m3` and are mounted read-only into `ai-api` and both workers. They are not in the image. `local_files_only` is the default; `LOCAL_EMBEDDING_ALLOW_DOWNLOAD=true` opts into a download. `scripts/prefetch_embedding_model.py` fetches them.
4. `LOCAL_EMBEDDING_PRELOAD=true` loads the model in the Celery main process (signal `worker_init`) and asks the kernel to read the weight files ahead, so the forked children share the mapped pages and the first turn does not pay the load. It runs no inference before the fork.
5. `AGENTS.md` and `CLAUDE.md` are changed to say so. Hugging Face stays supported.

## Measured on 2026-10-17 (AMD Ryzen 3 5300U, 4 cores and 8 threads, 18 GB RAM, no GPU)

| Quantity | Value |
|---|---|
| Weights on disk | 2.27 GB (SHA-256 matches the published checksum) |
| Load | 0.7 s (the weights are memory-mapped) |
| Memory | about 0.8 GB right after load, about 2.0 GB once every weight has been used; the pages are file-backed and shared between processes. Containers showed 1.07 GB (each worker) and 1.2 GB (ai-api while indexing) |
| One short query (14 tokens), 4 threads | 0.20 s; 0.46 s with 8 threads (hyper-threads do not help); 0.5 s inside the 2-CPU `ai-api` container |
| 32 sentences of 16 tokens | 2.8 s (88 ms each) |
| 8 passages of 240 tokens | 8.7 s (1.1 s each) |
| First use after a cold page cache | 10 to 14 s once, then warm |
| Indexing 65 Golden Graph outline topics through the real pipeline | 296 s, 65 chunks, 0 failures |
| Chat turn with preload | 6.0 s in total (21.5 s without preload on a cold cache), retrieval 0.8 s |
| Download of the weights | about 1.3 MB/s with 8 parallel ranged requests; a single connection gave 0.2 MB/s |

Answer to "is it heavy": for this product, no. Query embedding is a few tenths of a second and indexing is a background task. The costs are 2.3 GB of disk, about 1 to 2 GB of RAM per container that embeds (less in practice because the pages are shared), 4 CPU threads for a second at a time, and a slow first download.

## Consequences

- Retrieval works on the dev stack: the chat worker logs `[RETRIEVE] ... returned=10`; a new lesson introduction reports "2 sumber dari materi course dan 5 cuplikan dari 1 pencarian", cites four sources, and one is labelled "cocok makna" (semantic match). CP-10 is closed for the dev stack.
- Chat replies still carry no citation markers: the indexed outline chunks have no lesson id and the model chose not to cite. This is separate from the embedding provider.
- A host that serves the competition needs the model directory (2.3 GB) and room for two to three loaded copies in the worst case. `ai-api` is capped at 2 CPUs and 3 GB; that is enough for query embedding.
- `uv.lock` moved `huggingface-hub` from 1.16.1 to 2.2.0, `tokenizers` 0.23.2 to 0.23.3, `click` 8.3.0 to 8.5.0 and added `transformers` 5.20.1 and `safetensors` 0.8.0. The whole `ai-api` suite passes (1224 tests).
- Retrieval quality is not measured. No retrieval benchmark exists; the only checks are a ranking sanity test (0.72 for a relevant paragraph, 0.35 for an unrelated one) and the live runs above.
- Rollback: set `EMBEDDING_PROVIDER=huggingface` and recreate `ai-api`, `celery-worker`, `celery-chat-worker`. Stored vectors stay valid because the model and the dimension are unchanged.
