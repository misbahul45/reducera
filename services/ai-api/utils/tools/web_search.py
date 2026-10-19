import os
import logging
import requests

from config.prompt_segmentation import looks_like_instruction

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
TAVILY_URL = "https://api.tavily.com/search"

def tool_web_search_results(query: str, limit: int = 5) -> list[dict]:
    try:
        payload = {
            "api_key": TAVILY_API_KEY,
            "query": query,
            "search_depth": "basic",
            "max_results": limit
        }

        response = requests.post(TAVILY_URL, json=payload, timeout=10)

        if response.status_code != 200:
            logger.error(f"Tavily error {response.status_code}: {response.text}")
            return []

        found = []
        for r in response.json().get("results", []):
            title = r.get("title", "") or ""
            url = r.get("url", "") or ""
            snippet = r.get("content", "") or ""

            if looks_like_instruction(snippet) or looks_like_instruction(title):
                logger.warning(f"[WEB_SEARCH] Rejected instruction-like result: title={title!r}")
                continue
            if not url.lower().startswith(("http://", "https://")):
                continue

            found.append({"title": title, "url": url, "snippet": snippet})
        return found

    except Exception as e:
        logger.error(f"Error Tavily search: {e}")
        return []


def tool_web_search(query: str, limit: int = 5):
    return "\n".join(
        f"- {item['title']}\n  {item['snippet']}\n  {item['url']}"
        for item in tool_web_search_results(query, limit)
    )
