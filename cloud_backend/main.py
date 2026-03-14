"""
Cloud Run Backend - Agent Brain Only
Connects to Gemini, relays tool calls to local Playwright client
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from typing import Dict, Optional
import os
import json
import asyncio
import logging
from dotenv import load_dotenv
from github_agent import create_github_agent

load_dotenv()

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(levelname)s %(asctime)s %(message)s",
)
logger = logging.getLogger("benji.cloud_backend")


def _clip_text(value: str, limit: int = 320) -> str:
    text = " ".join(str(value).split())
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."


def _is_quota_or_rate_limit_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        marker in text
        for marker in [
            "resource_exhausted",
            "quota",
            "429",
            "rate limit",
            "too many requests",
        ]
    )


def _friendly_quota_message() -> str:
    return (
        "Sorry, I've hit the quota limit right now — let me try again soon. "
        "Please wait a moment and retry."
    )


async def _generate_content_with_retry(
    client: genai.Client,
    *,
    model: str,
    contents,
    config,
    websocket: WebSocket,
    session_id: str,
    turn_number: int,
):
    max_attempts = int(os.getenv("MODEL_RETRY_MAX_ATTEMPTS", "4"))
    base_delay_seconds = float(os.getenv("MODEL_RETRY_BASE_DELAY_SECONDS", "1.5"))

    for attempt in range(1, max_attempts + 1):
        try:
            return client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
        except Exception as exc:
            is_quota_error = _is_quota_or_rate_limit_error(exc)
            is_last_attempt = attempt == max_attempts
            logger.warning(
                "generate_content failed session_id=%s turn=%s attempt=%s/%s quota_or_rate_limit=%s error=%s",
                session_id,
                turn_number,
                attempt,
                max_attempts,
                is_quota_error,
                _clip_text(str(exc), 260),
            )

            if not is_quota_error:
                raise

            if is_last_attempt:
                raise RuntimeError(_friendly_quota_message()) from exc

            delay = base_delay_seconds * (2 ** (attempt - 1))
            await websocket.send_json({
                "type": "status",
                "content": f"{_friendly_quota_message()} Retrying in {delay:.1f}s...",
            })
            await asyncio.sleep(delay)

    raise RuntimeError(_friendly_quota_message())


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store active connections
playwright_clients: Dict[str, WebSocket] = {}
frontend_clients: Dict[str, WebSocket] = {}

# Store session logs for bug analysis
session_logs: Dict[str, list] = {}  # session_id -> list of log entries
session_meta: Dict[str, Dict] = {}  # session_id -> metadata for run outcome and bug flags

# Gemini configuration - Computer Use model
COMPUTER_USE_MODEL_ID = os.getenv("COMPUTER_USE_MODEL_ID", "gemini-2.5-computer-use-preview-10-2025")
logger.info("startup model=%s", COMPUTER_USE_MODEL_ID)

QA_WORKFLOW_SYSTEM_PROMPT = """
You are a QA Engineer agent testing visual UI workflows in the application.

Your job:
1. Execute the provided user workflow exactly and validate expected behavior.
2. Keep testing until the desired workflow goal is completed or clearly blocked.
3. If the workflow cannot reach the expected successful outcome, explicitly say:
   TEST FAILED - BUG DETECTED
4. If the workflow reaches the expected successful outcome, explicitly say:
   TEST PASSED

Important:
- Be explicit about why the test passed or failed.
- If failed, include "BUG DETECTED" in your thinking text.

CRITICAL: For every turn, you MUST include a JSON object in your thinking with a "shorter_message" field.
Format your thinking like this:
{"shorter_message": "One sentence summary of what you're doing"}
[Rest of your detailed thinking here]

The shorter_message should be:
- Maximum 1 sentence (10-15 words)
- Natural and human-like (e.g., "Clicking on Projects to view all projects", "Typing project name in the form")
- Specific about UI elements and actions
- Written in present tense

Example thinking format:
{"shorter_message": "Clicking on the Projects link in the sidebar"}
I can see the dashboard page has loaded successfully. I need to navigate to the Projects section to create a new project. I'll click on the "Projects" link in the left sidebar.
""".strip()

# Computer Use tool configuration (using built-in Computer Use tool)
config = genai.types.GenerateContentConfig(
    tools=[
        genai.types.Tool(
            computer_use=genai.types.ComputerUse(
                environment=genai.types.Environment.ENVIRONMENT_BROWSER,
                # Optionally exclude functions you don't want to use
                # excluded_predefined_functions=["drag_and_drop"]
            )
        )
    ],
    temperature=0.5,
)

@app.websocket("/playwright")
async def playwright_endpoint(websocket: WebSocket):
    """Endpoint for local Playwright client to connect"""
    await websocket.accept()
    client_id = "default"
    logger.info("playwright_ws accepted")
    
    try:
        # Receive client registration
        data = await websocket.receive_json()
        client_id = data.get("client_id", "default")
        playwright_clients[client_id] = websocket
        
        logger.info("playwright_ws connected client_id=%s active_clients=%s", client_id, len(playwright_clients))
        
        # Keep connection alive without calling receive
        # The /ws endpoint will handle all communication with this WebSocket
        disconnect_event = asyncio.Event()
        
        # Wait indefinitely until the connection is closed
        await disconnect_event.wait()
            
    except WebSocketDisconnect:
        pass
    finally:
        if client_id in playwright_clients:
            del playwright_clients[client_id]
        logger.info("playwright_ws disconnected client_id=%s active_clients=%s", client_id, len(playwright_clients))

@app.websocket("/ws")
async def frontend_endpoint(websocket: WebSocket):
    """Endpoint for frontend to connect and start agent"""
    await websocket.accept()
    client_id = "default"
    session_id = None
    logger.info("frontend_ws accepted")
    
    try:
        # Receive initial prompt
        data = await websocket.receive_json()
        prompt = data["prompt"]
        client_id = data.get("client_id", "default")
        logger.info("frontend_ws start client_id=%s prompt=%s", client_id, _clip_text(prompt, 180))
        
        frontend_clients[client_id] = websocket
        
        # Wait for Playwright client to be connected
        max_wait = 30
        waited = 0
        while client_id not in playwright_clients and waited < max_wait:
            await asyncio.sleep(0.5)
            waited += 0.5
        
        if client_id not in playwright_clients:
            logger.warning("frontend_ws missing_playwright_client client_id=%s waited_seconds=%s", client_id, max_wait)
            await websocket.send_json({
                "type": "error",
                "content": "Local Playwright client not connected. Please start the local client first."
            })
            return
        
        playwright_ws = playwright_clients[client_id]
        
        # Initialize Gemini client
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        
        # Start background keepalive task to prevent WebSocket timeouts
        keepalive_running = asyncio.Event()
        keepalive_running.set()
        
        async def keepalive_task():
            """Send periodic keepalive messages to prevent WebSocket timeout during long operations"""
            while keepalive_running.is_set():
                await asyncio.sleep(10)  # Send keepalive every 10 seconds
                if keepalive_running.is_set():
                    try:
                        # Send to both WebSockets to keep them alive
                        await websocket.send_json({"type": "keepalive"})
                        await playwright_ws.send_json({"type": "keepalive"})
                    except:
                        break
        
        keepalive_task_handle = asyncio.create_task(keepalive_task())
        
        # Agent loop with conversation history
        import base64
        
        # Get initial screenshot
        await playwright_ws.send_json({"type": "request_screenshot"})
        screenshot_msg = await playwright_ws.receive_json()
        initial_screenshot = base64.b64decode(screenshot_msg["screenshot"])
        
        # Create session ID for this run
        import uuid
        session_id = str(uuid.uuid4())
        session_logs[session_id] = []
        session_meta[session_id] = {
            "status": "running",
            "bug_detected": False,
            "client_id": client_id,
        }
        logger.info("session started session_id=%s client_id=%s", session_id, client_id)
        
        # Log initial prompt
        session_logs[session_id].append({
            "type": "prompt",
            "content": prompt,
            "timestamp": str(asyncio.get_event_loop().time())
        })
        
        # Send session ID to frontend
        await websocket.send_json({
            "type": "session_id",
            "session_id": session_id
        })
        
        qa_prompt = f"""
{QA_WORKFLOW_SYSTEM_PROMPT}

Expected workflow to test:
{prompt}

Run the workflow now. End with either:
- TEST PASSED
- TEST FAILED - BUG DETECTED
""".strip()

        # Initialize conversation history
        contents = [
            genai.types.Content(
                role="user",
                parts=[
                    genai.types.Part.from_text(text=qa_prompt),
                    genai.types.Part.from_bytes(
                        data=initial_screenshot,
                        mime_type="image/png"
                    ),
                ]
            )
        ]
        
        turn_number = 0
        max_turns = 30
        
        while turn_number < max_turns:
            turn_number += 1
            logger.info("turn start session_id=%s turn=%s", session_id, turn_number)
            
            # Send to Gemini with full conversation history
            response = await _generate_content_with_retry(
                client,
                model=COMPUTER_USE_MODEL_ID,
                contents=contents,
                config=config,
                websocket=websocket,
                session_id=session_id,
                turn_number=turn_number,
            )
            
            # Append model response to conversation history
            candidate = response.candidates[0]
            contents.append(candidate.content)
            
            # Extract thinking
            thoughts = [
                part.text
                for part in response.candidates[0].content.parts
                if hasattr(part, "text") and part.text
            ]
            
            # Store thinking content for this turn to use in action summaries
            turn_thinking_content = ""
            shorter_message = ""
            if thoughts:
                thinking_content = " ".join(thoughts)
                turn_thinking_content = thinking_content
                
                # Extract shorter_message JSON field from thinking
                import re
                json_match = re.search(r'\{"shorter_message":\s*"([^"]+)"\}', thinking_content)
                if json_match:
                    shorter_message = json_match.group(1)
                else:
                    # Fallback to first sentence if no JSON found
                    shorter_message = thinking_content.split('.')[0][:100] if thinking_content else "Processing..."
                
                logger.info(
                    "turn thinking session_id=%s turn=%s content=%s",
                    session_id,
                    turn_number,
                    _clip_text(thinking_content),
                )
                await websocket.send_json({
                    "type": "thinking",
                    "content": thinking_content
                })
                
                # Send shorter_message to benji_thinking bubble
                await websocket.send_json({
                    "type": "benji_thinking",
                    "content": shorter_message,
                })
                
                # Log thinking
                session_logs[session_id].append({
                    "type": "thinking",
                    "content": thinking_content,
                    "turn": turn_number,
                    "timestamp": str(asyncio.get_event_loop().time())
                })
                lower_thinking = thinking_content.lower()
                if "bug detected" in thinking_content.lower():
                    session_meta[session_id]["bug_detected"] = True
                if "test failed" in lower_thinking:
                    session_meta[session_id]["status"] = "failed"
                    session_meta[session_id]["bug_detected"] = True
                if "test passed" in lower_thinking and session_meta[session_id]["status"] == "running":
                    session_meta[session_id]["status"] = "passed"
            
            # Extract function calls
            function_calls = [
                part.function_call
                for part in response.candidates[0].content.parts
                if hasattr(part, "function_call") and part.function_call
            ]
            
            if not function_calls:
                current_status = session_meta[session_id]["status"]
                logger.info(
                    "turn no_actions session_id=%s turn=%s status=%s",
                    session_id,
                    turn_number,
                    current_status,
                )
                if current_status in {"passed", "failed"}:
                    await websocket.send_json({
                        "type": "status",
                        "content": "Agent reported final test verdict"
                    })
                    break

                await websocket.send_json({
                    "type": "status",
                    "content": "No action returned yet; continuing test execution"
                })

                contents.append(
                    genai.types.Content(
                        role="user",
                        parts=[
                            genai.types.Part.from_text(
                                text=(
                                    "Continue executing the workflow. Do not stop until you can provide one of "
                                    "these exact final verdicts based on observed behavior: "
                                    "'TEST PASSED' or 'TEST FAILED - BUG DETECTED'."
                                )
                            )
                        ],
                    )
                )
                await asyncio.sleep(0.3)
                continue
            
            # Execute each function call via Playwright client and build function responses
            function_responses = []
            
            for function_call in function_calls:
                logger.info(
                    "turn action session_id=%s turn=%s function=%s args=%s",
                    session_id,
                    turn_number,
                    function_call.name,
                    _clip_text(json.dumps(dict(function_call.args), ensure_ascii=True), 220),
                )
                # Log action
                session_logs[session_id].append({
                    "type": "action",
                    "function": function_call.name,
                    "args": dict(function_call.args),
                    "turn": turn_number,
                    "timestamp": str(asyncio.get_event_loop().time())
                })
                
                # Send action to frontend for display
                await websocket.send_json({
                    "type": "action",
                    "content": f"Executing: {function_call.name}",
                    "turn_number": turn_number,
                    "function_name": function_call.name,
                    "args": dict(function_call.args),
                })
                
                # Send Computer Use agent's thinking for this turn as benji_thinking
                if turn_thinking_content:
                    await websocket.send_json({
                        "type": "benji_thinking",
                        "content": turn_thinking_content,
                    })
                
                # Send to Playwright client for execution
                await playwright_ws.send_json({
                    "type": "execute_action",
                    "function": function_call.name,
                    "args": dict(function_call.args)
                })
                
                # Send status update to frontend immediately (before waiting for Playwright)
                await websocket.send_json({
                    "type": "status",
                    "content": f"Executing {function_call.name}..."
                })
                
                # Wait for execution result
                result = await playwright_ws.receive_json()
                if result.get("error"):
                    logger.warning(
                        "turn action_result_error session_id=%s turn=%s function=%s error=%s",
                        session_id,
                        turn_number,
                        function_call.name,
                        _clip_text(str(result.get("error")), 220),
                    )
                else:
                    logger.info(
                        "turn action_result_ok session_id=%s turn=%s function=%s url=%s",
                        session_id,
                        turn_number,
                        function_call.name,
                        _clip_text(str(result.get("url", "")), 180),
                    )
                
                # Get new screenshot after action
                screenshot_base64 = result.get("screenshot", "")
                screenshot_bytes = base64.b64decode(screenshot_base64) if screenshot_base64 else b""
                
                # Forward screenshot to frontend if available
                if screenshot_base64:
                    await websocket.send_json({
                        "type": "screenshot",
                        "data": screenshot_base64
                    })
                
                # Build function response with screenshot and URL (required by Computer Use model)
                response_data = {
                    "url": result.get("url", ""),  # Required field
                    "status": "executed",
                    "safety_acknowledgement": "true"  # Auto-acknowledge all safety decisions for testing
                }
                if result.get("error"):
                    response_data["error"] = result["error"]
                
                function_responses.append(
                    genai.types.FunctionResponse(
                        name=function_call.name,
                        response=response_data,
                        parts=[
                            genai.types.FunctionResponsePart(
                                inline_data=genai.types.FunctionResponseBlob(
                                    mime_type="image/png",
                                    data=screenshot_bytes
                                )
                            )
                        ] if screenshot_bytes else []
                    )
                )
            
            # Append function responses to conversation history
            contents.append(
                genai.types.Content(
                    role="user",
                    parts=[genai.types.Part(function_response=fr) for fr in function_responses]
                )
            )
            
            await asyncio.sleep(0.5)
        
        if session_meta.get(session_id, {}).get("status") == "running":
            session_meta[session_id]["status"] = "failed"
            session_meta[session_id]["bug_detected"] = True
            session_meta[session_id]["error"] = "Run ended without explicit TEST PASSED/FAILED verdict"

        final_status = session_meta.get(session_id, {}).get("status", "failed")

        failure_reason = None
        if final_status != "passed":
            for log_entry in reversed(session_logs.get(session_id, [])):
                if log_entry.get("type") != "thinking":
                    continue
                thought = str(log_entry.get("content", "")).strip()
                lower_thought = thought.lower()
                if "test failed" in lower_thought or "bug detected" in lower_thought:
                    failure_reason = thought
                    break

            if not failure_reason:
                failure_reason = "Workflow did not reach expected successful outcome."

        final_message = (
            "TEST PASSED"
            if final_status == "passed"
            else f"TEST FAILED - BUG DETECTED. Reason: {failure_reason}"
        )
        logger.info(
            "session complete session_id=%s status=%s turns=%s message=%s",
            session_id,
            final_status,
            turn_number,
            _clip_text(final_message),
        )

        session_logs[session_id].append({
            "type": "complete",
            "content": final_message,
            "turn": turn_number,
            "timestamp": str(asyncio.get_event_loop().time())
        })

        await websocket.send_json({
            "type": "complete",
            "content": final_message
        })
        
        # Send final verdict as benji_thinking
        await websocket.send_json({
            "type": "benji_thinking",
            "content": final_message,
        })
        
    except WebSocketDisconnect:
        keepalive_running.clear()
        if client_id in frontend_clients:
            del frontend_clients[client_id]
        logger.info("frontend_ws disconnected client_id=%s session_id=%s", client_id, session_id)
    except Exception as e:
        keepalive_running.clear()
        logger.exception("agent_loop_error client_id=%s session_id=%s", client_id, session_id)
        error_message = str(e)
        if _is_quota_or_rate_limit_error(e):
            error_message = _friendly_quota_message()
        if "session_id" in locals() and session_id in session_meta:
            session_meta[session_id]["status"] = "failed"
            session_meta[session_id]["error"] = error_message
            session_meta[session_id]["bug_detected"] = False
        await websocket.send_json({
            "type": "error",
            "content": error_message
        })

@app.get("/")
async def root():
    return {"message": "Gemini Computer Use Agent - Cloud Backend"}

class BugAnalysisRequest(BaseModel):
    session_id: str
    repo_owner: str
    repo_name: str
    app_url: Optional[str] = None

@app.post("/analyze-bugs")
async def analyze_bugs(request: BugAnalysisRequest):
    """
    Analyze session logs and suggest code fixes using GitHub MCP agent.
    """
    logger.info(
        "analyze_bugs requested session_id=%s repo=%s/%s",
        request.session_id,
        request.repo_owner,
        request.repo_name,
    )
    # Get session logs
    if request.session_id not in session_logs:
        raise HTTPException(status_code=404, detail="Session not found")
    
    logs = session_logs[request.session_id]
    meta = session_meta.get(request.session_id, {})
    
    if not logs:
        raise HTTPException(status_code=400, detail="No logs found for this session")

    if meta.get("status") != "failed" or not meta.get("bug_detected"):
        raise HTTPException(
            status_code=400,
            detail="GitHub bug analysis is only available for failed sessions with bug_detected=true"
        )
    
    try:
        # Create GitHub agent
        github_agent = await create_github_agent()
        
        # Analyze and get fixes
        result = await github_agent.analyze_and_fix(
            session_logs=logs,
            repo_owner=request.repo_owner,
            repo_name=request.repo_name,
            app_url=request.app_url
        )
        logger.info(
            "analyze_bugs completed session_id=%s status=%s",
            request.session_id,
            result.get("status", "unknown"),
        )
        
        return result
    
    except Exception as e:
        logger.exception("analyze_bugs_error session_id=%s", request.session_id)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.get("/sessions")
async def list_sessions():
    """List all available session IDs."""
    return {
        "sessions": [
            {
                "session_id": sid,
                "log_count": len(logs),
                "first_log": logs[0] if logs else None,
                "meta": session_meta.get(sid, {})
            }
            for sid, logs in session_logs.items()
        ]
    }

@app.get("/health")
async def health():
    return {"status": "healthy", "playwright_clients": len(playwright_clients)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
