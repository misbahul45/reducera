import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request

from config.rate_limit import rate_limit
from config.service_identity import service_actor
from errors.types import LLMError
from middleware.idempotency import require_idempotency_key
from v1.prompt_proposals.proposer import ProposalRejected, ProposalRequest, propose

router = APIRouter(prefix="/prompt-proposals", tags=["Prompt proposals"])

logger = logging.getLogger(__name__)


@router.post("")
@rate_limit(capacity_per_minute=6, burst=2)
@require_idempotency_key(mint_if_missing=False)
async def propose_prompt(
    request: Request,
    body: ProposalRequest,
    user: dict = Depends(service_actor),
) -> Dict[str, Any]:
    try:
        return propose(body, subject=user["id"])
    except ProposalRejected as exc:
        logger.info("[PROMPT_PROPOSAL] rejected: %s", exc)
        raise HTTPException(status_code=422, detail={"message": "The proposal was rejected", "problems": exc.problems}) from exc
    except LLMError as exc:
        logger.error("[PROMPT_PROPOSAL] the model could not produce a proposal: %s", exc)
        raise HTTPException(status_code=503, detail="The model could not produce a proposal") from exc
