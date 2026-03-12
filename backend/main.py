import asyncio
import base64
import json
import logging
import os
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google import genai

load_dotenv()
from google.genai.types import (
    ComputerUse,
    Content,
    Environment,
    FunctionResponse,
    FunctionResponseBlob,
    GenerateContentConfig,
    Part,
    Tool,
    FinishReason,
    FunctionDeclaration,
)
from playwright.async_api import Page, async_playwright

logging.getLogger("google_genai._common").setLevel(logging.ERROR)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT")
LOCATION = os.environ.get("GOOGLE_LOCATION", "global")
MODEL_ID = os.environ.get("MODEL_ID", "gemini-2.5-computer-use-preview-10-2025")


def normalize_x(x: int, screen_width: int) -> int:
    return int(x / 1000 * screen_width)


def normalize_y(y: int, screen_height: int) -> int:
    return int(y / 1000 * screen_height)


def draw_path_function(points: list[dict]) -> dict:
    """Draw a smooth path on a canvas by dragging through multiple points.
    
    Args:
        points: List of coordinate dictionaries with 'x' and 'y' keys (0-1000 scale).
                Example: [{"x": 100, "y": 200}, {"x": 150, "y": 250}, {"x": 200, "y": 300}]
    
    Returns:
        Status dictionary indicating success or failure.
    """
    return {"status": "draw_path_requested", "point_count": len(points)}


async def login_ui_visible(page: Page) -> bool:
    return False


async def highlight_element_at(page: Page, x: int, y: int, duration_ms: int = 1000):
    """Add a visual highlight around the element at the given coordinates."""
    await page.evaluate(f"""
        (async () => {{
            const x = {x};
            const y = {y};
            const element = document.elementFromPoint(x, y);
            
            if (element) {{
                const originalOutline = element.style.outline;
                const originalBoxShadow = element.style.boxShadow;
                
                element.style.outline = '3px solid #ff00ff';
                element.style.boxShadow = '0 0 15px 5px rgba(255, 0, 255, 0.5)';
                element.style.transition = 'all 0.2s ease';
                
                setTimeout(() => {{
                    element.style.outline = originalOutline;
                    element.style.boxShadow = originalBoxShadow;
                }}, {duration_ms});
            }}
        }})();
    """)


async def execute_function_calls(
    response, page: Page, screen_width: int, screen_height: int, websocket: WebSocket
) -> tuple[str, list[tuple[str, str, bool]]]:
    await asyncio.sleep(0.1)

    function_calls = [
        part.function_call
        for part in response.candidates[0].content.parts
        if hasattr(part, "function_call") and part.function_call
    ]

    thoughts = [
        part.text
        for part in response.candidates[0].content.parts
        if hasattr(part, "text") and part.text
    ]

    if thoughts:
        thought_text = " ".join(thoughts)
        await websocket.send_json({
            "type": "thinking",
            "content": thought_text
        })

    if not function_calls:
        return "NO_ACTION", []

    results = []
    for function_call in function_calls:
        result = None
        safety_acknowledged = False

        safety_decision = function_call.args.get("safety_decision")
        if (
            safety_decision
            and safety_decision.get("decision") == "require_confirmation"
        ):
            await websocket.send_json({
                "type": "safety_prompt",
                "content": safety_decision.get("explanation"),
                "action": function_call.name
            })
            
            confirmation = await websocket.receive_json()
            if confirmation.get("approved") != True:
                await websocket.send_json({
                    "type": "action",
                    "content": f"Action {function_call.name} denied by user"
                })
                results.append((function_call.name, "user_denied", False))
                continue

            safety_acknowledged = True

        await websocket.send_json({
            "type": "action",
            "content": f"Executing: {function_call.name}"
        })

        try:
            if function_call.name == "open_web_browser":
                result = "success"

            elif function_call.name == "wait_5_seconds":
                await asyncio.sleep(5)
                result = "success"

            elif function_call.name == "go_back":
                await page.go_back()
                result = "success"

            elif function_call.name == "go_forward":
                await page.go_forward()
                result = "success"

            elif function_call.name == "search":
                await page.goto("https://www.google.com")
                result = "success"

            elif function_call.name == "navigate":
                await page.goto(function_call.args["url"])
                result = "success"

            elif function_call.name == "click_at":
                actual_x = normalize_x(function_call.args["x"], screen_width)
                actual_y = normalize_y(function_call.args["y"], screen_height)
                await highlight_element_at(page, actual_x, actual_y, 800)
                await asyncio.sleep(0.3)
                await page.mouse.click(actual_x, actual_y)
                result = "success"

            elif function_call.name == "hover_at":
                actual_x = normalize_x(function_call.args["x"], screen_width)
                actual_y = normalize_y(function_call.args["y"], screen_height)
                await highlight_element_at(page, actual_x, actual_y, 600)
                await page.mouse.move(actual_x, actual_y)
                result = "success"

            elif function_call.name == "type_text_at":
                text_to_type = function_call.args["text"]
                press_enter = function_call.args.get("press_enter", True)
                clear_before_typing = function_call.args.get("clear_before_typing", True)

                actual_x = normalize_x(function_call.args["x"], screen_width)
                actual_y = normalize_y(function_call.args["y"], screen_height)

                await highlight_element_at(page, actual_x, actual_y, 1200)
                await asyncio.sleep(0.3)
                await page.mouse.click(actual_x, actual_y)
                await asyncio.sleep(0.1)

                if clear_before_typing:
                    await page.keyboard.press("Meta+A")
                    await page.keyboard.press("Backspace")

                await page.keyboard.type(text_to_type)

                if press_enter:
                    await page.keyboard.press("Enter")

                result = "success"

            elif function_call.name == "key_combination":
                keys = function_call.args["keys"]
                await page.keyboard.press(keys)
                result = "success"

            elif function_call.name == "scroll_document":
                direction = function_call.args["direction"]

                if direction == "down":
                    await page.mouse.wheel(0, 900)
                elif direction == "up":
                    await page.mouse.wheel(0, -900)
                elif direction == "right":
                    await page.mouse.wheel(900, 0)
                elif direction == "left":
                    await page.mouse.wheel(-900, 0)

                result = "success"

            elif function_call.name == "scroll_at":
                actual_x = normalize_x(function_call.args["x"], screen_width)
                actual_y = normalize_y(function_call.args["y"], screen_height)
                direction = function_call.args["direction"]
                magnitude = function_call.args.get("magnitude", 800)

                await page.mouse.move(actual_x, actual_y)

                pixel_amount = int(magnitude / 1000 * 1200)

                if direction == "down":
                    await page.mouse.wheel(0, pixel_amount)
                elif direction == "up":
                    await page.mouse.wheel(0, -pixel_amount)
                elif direction == "right":
                    await page.mouse.wheel(pixel_amount, 0)
                elif direction == "left":
                    await page.mouse.wheel(-pixel_amount, 0)

                result = "success"

            elif function_call.name == "drag_and_drop":
                actual_x = normalize_x(function_call.args["x"], screen_width)
                actual_y = normalize_y(function_call.args["y"], screen_height)
                dest_x = normalize_x(function_call.args["destination_x"], screen_width)
                dest_y = normalize_y(function_call.args["destination_y"], screen_height)

                await page.mouse.move(actual_x, actual_y)
                await page.mouse.down()
                await page.mouse.move(dest_x, dest_y)
                await page.mouse.up()
                result = "success"

            elif function_call.name == "draw_path_function":
                points = function_call.args.get("points", [])
                
                if len(points) < 2:
                    result = "error: need at least 2 points to draw"
                else:
                    first_point = points[0]
                    start_x = normalize_x(first_point["x"], screen_width)
                    start_y = normalize_y(first_point["y"], screen_height)
                    
                    await page.mouse.move(start_x, start_y)
                    await page.mouse.down()
                    
                    for point in points[1:]:
                        point_x = normalize_x(point["x"], screen_width)
                        point_y = normalize_y(point["y"], screen_height)
                        await page.mouse.move(point_x, point_y, steps=10)
                        await asyncio.sleep(0.01)
                    
                    await page.mouse.up()
                    result = "success"

            else:
                result = f"unknown_function: {function_call.name}"

        except Exception as e:
            error_msg = f"Error executing {function_call.name}: {e}"
            await websocket.send_json({
                "type": "error",
                "content": error_msg
            })
            result = f"error: {e!s}"

        results.append((function_call.name, result, safety_acknowledged))

    return "CONTINUE", results


async def run_agent_for_task(
    page: Page,
    client,
    prompt: str,
    screen_width: int,
    screen_height: int,
    websocket: WebSocket,
    max_turns: int = 20,
) -> None:
    system_instruction = """You are Benji, a UI Super Engineer specialized in testing and validating web application workflows.

Your role is to:
1. Execute the UI workflow task described by the user
2. Carefully observe the actual behavior of the UI
3. Compare the actual behavior against the expected behavior described in the task
4. Validate whether the UI behaves as expected

IMPORTANT TESTING GUIDELINES:
- After completing each action, verify the UI responded correctly
- Check for visual feedback, state changes, and navigation
- If something doesn't work as expected, this is a BUG
- When you find a bug, clearly state: "TEST FAILED - BUG DETECTED"
- Describe exactly what went wrong: what you expected vs what actually happened
- Be specific about UI elements that failed (buttons not responding, forms not submitting, incorrect navigation, etc.)

If the workflow completes successfully and matches expected behavior, state: "TEST PASSED - All UI behaviors validated successfully"

Be thorough and methodical in your testing. Don't assume things work - verify them."""

    config = GenerateContentConfig(
        system_instruction=system_instruction,
        tools=[
            Tool(
                computer_use=ComputerUse(
                    environment=Environment.ENVIRONMENT_BROWSER,
                    excluded_predefined_functions=[],
                )
            ),
        ]
    )

    screenshot = await page.screenshot()
    
    await websocket.send_json({
        "type": "screenshot",
        "data": base64.b64encode(screenshot).decode("utf-8")
    })
    
    contents = [
        Content(
            role="user",
            parts=[
                Part(text=prompt),
                Part.from_bytes(data=screenshot, mime_type="image/png"),
            ],
        )
    ]

    for turn in range(max_turns):
        await websocket.send_json({
            "type": "turn",
            "turn_number": turn + 1,
            "url": page.url
        })

        if await login_ui_visible(page):
            await websocket.send_json({
                "type": "status",
                "content": "LOGIN UI DETECTED. Please complete login manually."
            })
            return

        response = client.models.generate_content(
            model=MODEL_ID,
            contents=contents,
            config=config,
        )

        if not response.candidates:
            await websocket.send_json({
                "type": "error",
                "content": "Model returned no candidates. Terminating."
            })
            break

        if response.candidates[0].finish_reason == FinishReason.SAFETY:
            await websocket.send_json({
                "type": "error",
                "content": "SAFETY TRIGGERED"
            })
            break

        contents.append(response.candidates[0].content)

        active_function_calls = [
            part.function_call
            for part in response.candidates[0].content.parts
            if hasattr(part, "function_call") and part.function_call
        ]

        if not active_function_calls:
            final_text = "".join(
                part.text
                for part in response.candidates[0].content.parts
                if hasattr(part, "text") and part.text is not None
            ).strip()

            if final_text:
                await websocket.send_json({
                    "type": "complete",
                    "content": final_text
                })

            if final_text == "LOGIN_REQUIRED":
                await websocket.send_json({
                    "type": "status",
                    "content": "Agent detected login requirement."
                })
                return

            break

        status, execution_results = await execute_function_calls(
            response, page, screen_width, screen_height, websocket
        )

        if status == "NO_ACTION":
            continue

        function_response_parts = []

        for name, result, safety_acknowledged in execution_results:
            screenshot = await page.screenshot()
            current_url = page.url

            await websocket.send_json({
                "type": "screenshot",
                "data": base64.b64encode(screenshot).decode("utf-8")
            })

            response_payload = {"url": current_url}

            if result == "user_denied":
                response_payload["error"] = "user_denied"
            elif safety_acknowledged:
                response_payload["safety_acknowledgement"] = True

            function_response_parts.append(
                Part(
                    function_response=FunctionResponse(
                        name=name,
                        response=response_payload,
                        parts=[
                            Part(
                                inline_data=FunctionResponseBlob(
                                    mime_type="image/png",
                                    data=screenshot,
                                )
                            )
                        ],
                    )
                )
            )

        contents.append(Content(role="user", parts=function_response_parts))


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    if not PROJECT_ID:
        await websocket.send_json({
            "type": "error",
            "content": "GOOGLE_CLOUD_PROJECT environment variable not set."
        })
        await websocket.close()
        return

    client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
    browser = None

    try:
        data = await websocket.receive_json()
        prompt = data.get("prompt", "")
        
        await websocket.send_json({
            "type": "status",
            "content": "Starting browser agent..."
        })

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=False)
            context = await browser.new_context()
            page = await context.new_page()

            sw, sh = 1440, 1000
            await page.set_viewport_size({"width": sw, "height": sh})
            
            await websocket.send_json({
                "type": "status",
                "content": "Browser opened. Running agent..."
            })

            await run_agent_for_task(page, client, prompt, sw, sh, websocket, max_turns=30)

            await websocket.send_json({
                "type": "status",
                "content": "Agent task completed."
            })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "content": f"Error: {str(e)}"
        })
    finally:
        if browser:
            await browser.close()


@app.get("/health")
async def health():
    return {"status": "ok"}
