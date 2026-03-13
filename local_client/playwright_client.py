"""
Local Playwright Client - Execution Layer
Connects to Cloud Run agent brain, executes actions locally
"""
import asyncio
import websockets
import json
from playwright.async_api import async_playwright
import base64
import sys
import os

# Cloud Run backend URL (change this to your deployed URL)
CLOUD_RUN_URL = os.getenv("CLOUD_RUN_URL", "ws://localhost:8080")

CLIENT_ID = "default"  # Can be customized per machine

def denormalize_x(x: int, screen_width: int) -> int:
    """Convert normalized x coordinate (0-999) to actual pixel coordinate."""
    return int(x / 1000 * screen_width)

def denormalize_y(y: int, screen_height: int) -> int:
    """Convert normalized y coordinate (0-999) to actual pixel coordinate."""
    return int(y / 1000 * screen_height)

async def highlight_element_at(page, x: int, y: int, duration_ms: int = 1000):
    """Add a visual pink highlight around the element at the given coordinates."""
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

async def main():
    print(f"🚀 Starting local Playwright client...")
    print(f"📡 Connecting to Cloud Run agent at: {CLOUD_RUN_URL}")
    
    async with async_playwright() as p:
        # Launch browser (visible so user can see actions)
        browser = await p.chromium.launch(
            headless=False,
            args=["--start-maximized"]
        )
        
        context = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        )
        
        page = await context.new_page()
        screen_width = 1920
        screen_height = 1080
        
        print(f"✅ Browser launched")
        
        try:
            # Connect to Cloud Run backend
            uri = f"{CLOUD_RUN_URL}/playwright"
            async with websockets.connect(uri) as ws:
                print(f"✅ Connected to agent brain")
                
                # Register with agent brain
                await ws.send(json.dumps({"client_id": CLIENT_ID}))
                print(f"📝 Registered as client: {CLIENT_ID}")
                print(f"🎯 Ready to receive commands from agent brain")
                print(f"💡 Start your frontend and run a workflow!")
                
                while True:
                    # Receive commands from Cloud Run
                    message_str = await ws.recv()
                    message = json.loads(message_str)
                    
                    if message["type"] == "request_screenshot":
                        # Take screenshot
                        print("📸 Taking screenshot...")
                        screenshot_bytes = await page.screenshot()
                        screenshot_base64 = base64.b64encode(screenshot_bytes).decode()
                        
                        # Send back to Cloud Run
                        await ws.send(json.dumps({
                            "type": "screenshot",
                            "screenshot": screenshot_base64
                        }))
                    
                    elif message["type"] == "execute_action":
                        # Execute Playwright action locally
                        function_name = message["function"]
                        args = message["args"]
                        
                        print(f"⚡ Executing: {function_name} with args: {args}")
                        
                        try:
                            if function_name == "click_at":
                                actual_x = denormalize_x(args["x"], screen_width)
                                actual_y = denormalize_y(args["y"], screen_height)
                                await highlight_element_at(page, actual_x, actual_y, 800)
                                await asyncio.sleep(0.3)
                                await page.mouse.click(actual_x, actual_y)
                            
                            elif function_name == "hover_at":
                                actual_x = denormalize_x(args["x"], screen_width)
                                actual_y = denormalize_y(args["y"], screen_height)
                                await highlight_element_at(page, actual_x, actual_y, 600)
                                await page.mouse.move(actual_x, actual_y)
                            
                            elif function_name == "type_text_at":
                                text_to_type = args["text"]
                                press_enter = args.get("press_enter", True)
                                clear_before_typing = args.get("clear_before_typing", True)
                                
                                actual_x = denormalize_x(args["x"], screen_width)
                                actual_y = denormalize_y(args["y"], screen_height)
                                
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
                            
                            elif function_name == "navigate":
                                await page.goto(args["url"])
                            
                            elif function_name == "scroll_at":
                                actual_x = denormalize_x(args["x"], screen_width)
                                actual_y = denormalize_y(args["y"], screen_height)
                                direction = args["direction"]
                                magnitude = args.get("magnitude", 800)
                                
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
                            
                            elif function_name == "drag_and_drop":
                                actual_x = denormalize_x(args["x"], screen_width)
                                actual_y = denormalize_y(args["y"], screen_height)
                                dest_x = denormalize_x(args["destination_x"], screen_width)
                                dest_y = denormalize_y(args["destination_y"], screen_height)
                                
                                await page.mouse.move(actual_x, actual_y)
                                await page.mouse.down()
                                await page.mouse.move(dest_x, dest_y)
                                await page.mouse.up()
                            
                            # Take screenshot after action
                            await asyncio.sleep(0.3)
                            screenshot_bytes = await page.screenshot()
                            screenshot_base64 = base64.b64encode(screenshot_bytes).decode()
                            current_url = page.url
                            
                            # Send result back with URL (required by Computer Use model)
                            await ws.send(json.dumps({
                                "type": "execution_result",
                                "result": "success",
                                "screenshot": screenshot_base64,
                                "url": current_url
                            }))
                            
                            print(f"✅ Action completed: {function_name}")
                        
                        except Exception as e:
                            print(f"❌ Error executing {function_name}: {e}")
                            await ws.send(json.dumps({
                                "type": "execution_result",
                                "result": f"error: {str(e)}"
                            }))
        
        except websockets.exceptions.WebSocketException as e:
            print(f"❌ WebSocket error: {e}")
            print(f"💡 Make sure the Cloud Run backend is running at {CLOUD_RUN_URL}")
        except KeyboardInterrupt:
            print(f"\n👋 Shutting down...")
        finally:
            await browser.close()

if __name__ == "__main__":
    print("=" * 60)
    print("🤖 Benji Local Playwright Client")
    print("=" * 60)
    asyncio.run(main())
