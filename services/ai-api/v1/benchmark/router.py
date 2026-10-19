import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from config.rate_limit import rate_limit
from config.service_identity import service_actor
from errors.types import LLMError
from middleware.idempotency import require_idempotency_key
from v1.benchmark.dto import RunCaseRequest
from v1.benchmark.runner import BenchmarkRejected, run_case

router = APIRouter(prefix="/benchmark", tags=["Benchmark"])

logger = logging.getLogger(__name__)


@router.post("/run-case")
@rate_limit(capacity_per_minute=90, burst=12)
@require_idempotency_key(mint_if_missing=False)
async def run_benchmark_case(
    request: Request,
    body: RunCaseRequest,
    user: dict = Depends(service_actor),
) -> Dict[str, Any]:
    try:
        return await run_in_threadpool(run_case, body, subject=user["id"])
    except BenchmarkRejected as exc:
        logger.info("[BENCHMARK] rejected: %s", exc)
        raise HTTPException(status_code=422, detail={"message": "The template was rejected", "problems": exc.problems}) from exc
    except LLMError as exc:
        logger.error("[BENCHMARK] the model could not answer case %s: %s", body.case.id, exc)
        raise HTTPException(status_code=503, detail="The model could not answer this case") from exc
