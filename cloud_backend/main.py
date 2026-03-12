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
from typing import Dict
from dotenv import load_dotenv
from github_agent import create_github_agent
from dotenv import load_dotenv

load_dotenv()

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

# Gemini configuration - Computer Use model
COMPUTER_USE_MODEL_ID = os.getenv("COMPUTER_USE_MODEL_ID", "gemini-2.5-computer-use-preview-10-2025")
print(f"🔧 Using model: {COMPUTER_USE_MODEL_ID}")

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
    
    try:
        # Receive client registration
        data = await websocket.receive_json()
        client_id = data.get("client_id", "default")
        playwright_clients[client_id] = websocket
        
        print(f"Playwright client connected: {client_id}")
        
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
        print(f"Playwright client disconnected: {client_id}")

@app.websocket("/ws")
async def frontend_endpoint(websocket: WebSocket):
    """Endpoint for frontend to connect and start agent"""
    await websocket.accept()
    
    try:
        # Receive initial prompt
        data = await websocket.receive_json()
        prompt = data["prompt"]
        client_id = data.get("client_id", "default")
        
        frontend_clients[client_id] = websocket
        
        # Wait for Playwright client to be connected
        max_wait = 30
        waited = 0
        while client_id not in playwright_clients and waited < max_wait:
            await asyncio.sleep(0.5)
            waited += 0.5
        
        if client_id not in playwright_clients:
            await websocket.send_json({
                "type": "error",
                "content": "Local Playwright client not connected. Please start the local client first."
            })
            return
        
        playwright_ws = playwright_clients[client_id]
        
        # Initialize Gemini client
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        
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
        
        # Initialize conversation history
        contents = [
            genai.types.Content(
                role="user",
                parts=[
                    genai.types.Part.from_text(text=prompt),
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
            print(f"\n--- Turn {turn_number} ---")
            
            # Send to Gemini with full conversation history
            response = client.models.generate_content(
                model=COMPUTER_USE_MODEL_ID,
                contents=contents,
                config=config,
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
            
            if thoughts:
                thinking_content = " ".join(thoughts)
                await websocket.send_json({
                    "type": "thinking",
                    "content": thinking_content
                })
                
                # Log thinking
                session_logs[session_id].append({
                    "type": "thinking",
                    "content": thinking_content,
                    "turn": turn_number,
                    "timestamp": str(asyncio.get_event_loop().time())
                })
            
            # Extract function calls
            function_calls = [
                part.function_call
                for part in response.candidates[0].content.parts
                if hasattr(part, "function_call") and part.function_call
            ]
            
            if not function_calls:
                await websocket.send_json({
                    "type": "status",
                    "content": "Agent completed task"
                })
                break
            
            # Execute each function call via Playwright client and build function responses
            function_responses = []
            
            for function_call in function_calls:
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
                    "turn_number": turn_number
                })
                
                # Send to Playwright client for execution
                await playwright_ws.send_json({
                    "type": "execute_action",
                    "function": function_call.name,
                    "args": dict(function_call.args)
                })
                
                # Wait for execution result
                result = await playwright_ws.receive_json()
                
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
        
        await websocket.send_json({
            "type": "complete",
            "content": "Agent finished"
        })
        
    except WebSocketDisconnect:
        if client_id in frontend_clients:
            del frontend_clients[client_id]
        print(f"Frontend client disconnected: {client_id}")
    except Exception as e:
        print(f"Error in agent loop: {e}")
        await websocket.send_json({
            "type": "error",
            "content": str(e)
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
    # Get session logs
    if request.session_id not in session_logs:
        raise HTTPException(status_code=404, detail="Session not found")
    
    logs = session_logs[request.session_id]
    
    if not logs:
        raise HTTPException(status_code=400, detail="No logs found for this session")
    
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
        
        return result
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.get("/sessions")
async def list_sessions():
    """List all available session IDs."""
    return {
        "sessions": [
            {
                "session_id": sid,
                "log_count": len(logs),
                "first_log": logs[0] if logs else None
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
