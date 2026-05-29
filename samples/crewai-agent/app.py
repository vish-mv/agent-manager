import os

# Keep CrewAI non-interactive and offline-friendly inside the deployed pod, and
# set these BEFORE importing crewai (litellm reads them at import): no hosted-
# trace upload, no interactive trace prompt, and use litellm's bundled model
# cost map instead of fetching it from GitHub on cold start. Mirrors the
# emission-tier cells/crewai_sample.py.
os.environ.setdefault("CREWAI_TRACING_ENABLED", "false")
os.environ.setdefault("CREWAI_DISABLE_TRACING_PROMPT", "true")
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

import dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from agent.crew import create_crew

app = FastAPI()
# Load environment variables from a .env file (if present) for local runs; in
# the deployed pod the platform injects OPENAI_API_KEY as a sensitive env var.
dotenv.load_dotenv()
crew = create_crew()


class ChatRequest(BaseModel):
    session_id: str
    message: str


# Sync `def` (not `async`): crew.kickoff() is blocking, so FastAPI runs this in
# a threadpool instead of stalling the event loop. The Pydantic model gives a
# 422 (not an opaque 500) when `message` is missing, matching openapi.yaml.
@app.post("/chat")
def chat(payload: ChatRequest):
    result = crew.kickoff(inputs={"question": payload.message})
    return JSONResponse(content={"response": str(result)})
