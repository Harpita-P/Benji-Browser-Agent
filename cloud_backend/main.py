"""
Cloud Run Backend - Agent Brain Only
Connects to Gemini, relays tool calls to local Playwright client
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.cloud import texttospeech
from typing import Dict, Optional
import os
import json
import asyncio
import logging
import base64
from dotenv import load_dotenv
from github_agent import create_github_agent

load_dotenv()

# Initialize Google Cloud Text-to-Speech client
tts_client = texttospeech.TextToSpeechClient()

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


async def _generate_speech(text: str) -> str:
    """
    Generate speech audio from text using Google Cloud Text-to-Speech.
    Returns base64-encoded audio data.
    DISABLED: Returns empty string to disable TTS.
    """
    # TTS disabled - return empty string
    return ""


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
- CRITICAL: Modals closing automatically (e.g., after typing) is NOT a bug UNLESS it prevents the workflow from completing successfully. If the workflow goal is still achieved despite modal auto-close, the test should PASS.
- STRICT INSTRUCTION: If a modal closes immediately after you interact with it, you MUST retry clicking/interacting with the element again. DO NOT report this as a bug or conclude failure. Simply retry the action. Only report a bug if the retry also fails or if the workflow cannot be completed after multiple attempts.

CRITICAL: For every turn, you MUST include a JSON object in your thinking with a "current_update" field.
Format your thinking like this:
{"current_update": "One sentence summary of what you're doing"}
[Rest of your detailed thinking here]

The current_update should be:
- Maximum 1 sentence (10-15 words)
- Natural and human-like (e.g., "Clicking on Projects to view all projects", "Typing project name in the form")
- Specific about UI elements and actions
- Written in present tense for actions

SPECIAL CASE - Test Completion:
When you conclude with TEST PASSED or TEST FAILED, make the current_update friendly and celebratory/explanatory:
- For TEST PASSED: {"current_update": "Great! The test passed successfully"}
- For TEST FAILED: {"current_update": "Test failed - [brief bug description]"}
  Example: {"current_update": "Test failed - Create button didn't save the project"}

Example thinking format:
{"current_update": "Clicking on the Projects link in the sidebar"}
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
        accessibility_enabled = data.get("accessibility_enabled", False)
        logger.info("frontend_ws start client_id=%s prompt=%s accessibility_enabled=%s", client_id, _clip_text(prompt, 180), accessibility_enabled)
        logger.info("[ACCESSIBILITY DEBUG] Received accessibility_enabled=%s from frontend", accessibility_enabled)
        
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
        
        # Add accessibility instructions (always enabled)
        logger.info("[ACCESSIBILITY DEBUG] Adding accessibility evaluation instructions to prompt")
        accessibility_instructions = """

ACCESSIBILITY EVALUATION (ENABLED):
While executing the workflow, check ONLY for low contrast buttons:

FOCUS: Check if any BUTTONS have low contrast between background and text.
- CRITICAL: If you see ANY buttons with yellow, light yellow, light blue, light green, or other light colored backgrounds with white text, you MUST flag this as a low contrast issue
- Yellow buttons with white text are ALWAYS a contrast problem
- Light colored buttons with white text are ALWAYS a contrast problem
- Only check BUTTONS - ignore other UI elements

CRITICAL: You MUST include accessibility_suggestions in your final verdict:
- If you find low contrast buttons: accessibility_suggestions: ['Make the [button name] button text darker for better contrast against [color] background']
- If you find NO low contrast buttons: accessibility_suggestions: ['No accessibility improvement recommendations!']

IMPORTANT: Write suggestions in PLAIN TEXT without any markdown symbols, special characters, or formatting.
- Do NOT use: *, `, +, -, >, #, or any other markdown symbols
- Do NOT use emojis or special Unicode characters
- Write simple, clear sentences

Example formats:
TEST PASSED. accessibility_suggestions: ['Make the Create button text darker for better contrast against yellow background']
TEST PASSED. accessibility_suggestions: ['No accessibility improvement recommendations!']

INCORRECT ASSOCIATION BUG DETECTION:
While executing the workflow, also check for incorrect associations between images and their context:

FOCUS: Check if images/pictures are correctly associated with their surrounding text and context.
- CRITICAL: If you see an image with text nearby that does NOT refer to that image but refers to something else, flag this as an incorrect association bug
- Check if image captions, labels, or descriptions match the actual image content
- Look for mismatched context where an image appears in a section but the text describes a different image or concept
- Verify that images are placed in the correct location relative to their references

EXAMPLES OF INCORRECT ASSOCIATION BUGS:
- A product image with a caption describing a different product
- An image in a section about Feature A but the image shows Feature B
- Text saying "see image above" but the image is below or missing
- Multiple images where labels or references are swapped

If you detect an incorrect association bug, include it in your bug report with details about what is mismatched

E-COMMERCE UI BUG DETECTION:
If the workflow involves e-commerce functionality, check for these common bugs:

CART QUANTITY VALIDATION (CRITICAL):
- When adding a product to cart, verify the cart quantity matches the quantity that was added
- Example: If user adds 3 items, the cart should show 3 items, not 1 or a different number
- Check if adding the same product multiple times correctly increments the quantity
- Verify that the cart total reflects the correct number of items

OTHER COMMON E-COMMERCE BUGS TO CHECK:
- Price mismatch: Product price on listing page differs from cart or checkout price
- Out of stock items: Items marked as "out of stock" can still be added to cart
- Quantity limits: User can add more items than available stock or maximum allowed quantity
- Cart persistence: Items disappear from cart after page refresh or navigation
- Duplicate items: Same product appears multiple times in cart instead of incrementing quantity
- Total calculation: Cart subtotal or total does not match sum of individual item prices
- Discount application: Promo codes or discounts not applied correctly to cart total
- Remove from cart: Clicking remove does not actually remove the item from cart
- Update quantity: Changing quantity in cart does not update the price correctly

If you detect any e-commerce bugs, include specific details:
- What was expected (e.g., "Expected cart to show 3 items")
- What actually happened (e.g., "Cart shows 1 item")
- Which product or action triggered the bug
""".strip()
        
        qa_prompt = f"""
{QA_WORKFLOW_SYSTEM_PROMPT}
{accessibility_instructions}

Expected workflow to test:
{prompt}

Run the workflow now. End with either:
- TEST PASSED
- TEST FAILED - BUG DETECTED

CRITICAL BUG REPORTING FORMAT:
If you detect a bug and report TEST FAILED - BUG DETECTED, you MUST include a bug_explanation field in your response:

bug_explanation: "Short statement of what the bug is"

EXAMPLES:
- bug_explanation: "Incorrect product quantity in cart"
- bug_explanation: "Button color has low contrast"
- bug_explanation: "Image caption does not match product"
- bug_explanation: "Cart total calculation is wrong"
- bug_explanation: "Remove button does not work"

The bug_explanation MUST be:
- A short, clear statement (5-10 words)
- Specific to the actual bug found
- Written in plain text without markdown
- Focused on WHAT is wrong, not HOW to fix it

DO NOT use generic statements like "A bug was detected" - be specific about what the bug is.
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
            current_update = ""
            if thoughts:
                thinking_content = " ".join(thoughts)
                turn_thinking_content = thinking_content
                
                # Extract current_update JSON field from thinking
                import re
                # Try multiple JSON patterns to be more robust
                json_patterns = [
                    r'\{"current_update":\s*"([^"]+)"\}',
                    r'\{\'current_update\':\s*\'([^\']+)\'\}',
                    r'current_update["\']?\s*:\s*["\']([^"\']+)["\']',
                ]
                
                current_update = ""
                for pattern in json_patterns:
                    json_match = re.search(pattern, thinking_content, re.IGNORECASE)
                    if json_match:
                        current_update = json_match.group(1).strip()
                        break
                
                if not current_update:
                    # Fallback to first sentence if no JSON found
                    current_update = thinking_content.split('.')[0][:100] if thinking_content else "Processing..."
                
                # Remove ALL JSON-like patterns from thinking content for display
                thinking_content_display = re.sub(r'\{["\']?current_update["\']?\s*:\s*["\'][^"\']+["\']\}\s*', '', thinking_content, flags=re.IGNORECASE)
                thinking_content_display = thinking_content_display.strip()
                
                logger.info(
                    "turn thinking session_id=%s turn=%s content=%s",
                    session_id,
                    turn_number,
                    _clip_text(thinking_content),
                )
                await websocket.send_json({
                    "type": "thinking",
                    "content": thinking_content_display
                })
                
                # Send current_update to benji_thinking bubble with audio
                audio_data = await _generate_speech(current_update)
                await websocket.send_json({
                    "type": "benji_thinking",
                    "content": current_update,
                    "audio": audio_data,
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
                    
                    # Send benji_thinking message for final verdict with audio
                    if current_update:
                        audio_data = await _generate_speech(current_update)
                        await websocket.send_json({
                            "type": "benji_thinking",
                            "content": current_update,
                            "audio": audio_data,
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
                
                # Send current_update for this turn as benji_thinking
                # If no current_update from thinking, generate a default message based on action
                benji_message = current_update
                if not benji_message:
                    # Generate friendly default message based on function name
                    action_defaults = {
                        "open_web_browser": "Opening the browser",
                        "navigate": f"Navigating to {dict(function_call.args).get('url', 'page')}",
                        "click_at": "Clicking on element",
                        "type_text_at": f"Typing '{dict(function_call.args).get('text', 'text')}'",
                        "scroll": "Scrolling the page",
                        "wait": "Waiting for page to load",
                    }
                    benji_message = action_defaults.get(function_call.name, f"Executing {function_call.name}")
                
                audio_data = await _generate_speech(benji_message)
                await websocket.send_json({
                    "type": "benji_thinking",
                    "content": benji_message,
                    "audio": audio_data,
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
                
                # Send current URL to frontend for display
                current_url = result.get("url", "")
                if current_url:
                    await websocket.send_json({
                        "type": "turn",
                        "turn_number": turn_number,
                        "url": current_url
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

        # Extract accessibility suggestions from thinking logs (always enabled)
        accessibility_suggestions = []
        logger.info("[ACCESSIBILITY DEBUG] Extracting accessibility suggestions from thinking logs")
        import re
        for log_entry in reversed(session_logs.get(session_id, [])):
            if log_entry.get("type") != "thinking":
                continue
            thought = str(log_entry.get("content", "")).strip()
            logger.info("[ACCESSIBILITY DEBUG] Checking thought: %s", _clip_text(thought, 200))
            # Look for accessibility_suggestions pattern
            suggestions_match = re.search(r'accessibility_suggestions["\']?\s*:\s*\[([^\]]+)\]', thought, re.IGNORECASE)
            if suggestions_match:
                logger.info("[ACCESSIBILITY DEBUG] Found accessibility_suggestions match: %s", suggestions_match.group(0))
                suggestions_str = suggestions_match.group(1)
                # Parse individual suggestions
                suggestions = re.findall(r'["\']([^"\']+)["\']', suggestions_str)
                accessibility_suggestions = [s.strip() for s in suggestions if s.strip()]
                logger.info("[ACCESSIBILITY DEBUG] Parsed suggestions: %s", accessibility_suggestions)
                break
        if not accessibility_suggestions:
            logger.warning("[ACCESSIBILITY DEBUG] No accessibility suggestions found in any thinking logs")
        
        final_message = (
            "TEST PASSED"
            if final_status == "passed"
            else f"TEST FAILED - BUG DETECTED. Reason: {failure_reason}"
        )
        
        # Add accessibility suggestions to final message if any were found
        if accessibility_suggestions:
            suggestions_str = str(accessibility_suggestions)
            final_message += f". accessibility_suggestions: {suggestions_str}"
            logger.info("[ACCESSIBILITY DEBUG] Added suggestions to final message: %s", suggestions_str)
        else:
            logger.warning("[ACCESSIBILITY DEBUG] No accessibility suggestions were extracted")
        
        logger.info(
            "session complete session_id=%s status=%s turns=%s accessibility_suggestions=%s message=%s",
            session_id,
            final_status,
            turn_number,
            len(accessibility_suggestions),
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
        
        # Extract current_update from final verdict if available, otherwise create friendly message
        import re
        verdict_current_update = ""
        if turn_thinking_content:
            # Try multiple JSON patterns to be more robust
            json_patterns = [
                r'\{"current_update":\s*"([^"]+)"\}',
                r'\{\'current_update\':\s*\'([^\']+)\'\}',
                r'current_update["\']?\s*:\s*["\']([^"\']+)["\']',
            ]
            
            for pattern in json_patterns:
                json_match = re.search(pattern, turn_thinking_content, re.IGNORECASE)
                if json_match:
                    verdict_current_update = json_match.group(1).strip()
                    break
        
        # Fallback to friendly default if no current_update found
        if not verdict_current_update:
            if final_status == "passed":
                verdict_current_update = "Great! The test passed successfully"
            else:
                verdict_current_update = f"Test failed - {failure_reason[:50]}" if failure_reason else "Test failed - bug detected"
        
        # Send final verdict as benji_thinking with audio
        audio_data = await _generate_speech(verdict_current_update)
        await websocket.send_json({
            "type": "benji_thinking",
            "content": verdict_current_update,
            "audio": audio_data,
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
        keepalive_running.clear()
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
