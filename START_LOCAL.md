# Local Testing Guide - Before Cloud Deployment

Follow these steps to test the full stack locally before deploying to Cloud Run.

## Prerequisites

✅ Python 3.11+ installed
✅ Node.js installed
✅ Playwright installed (`playwright install chromium`)

## Step-by-Step Startup

### Terminal 1: Cloud Backend (Local)

```bash
cd cloud_backend

# Create .env file if not exists
cp .env.example .env
# Make sure .env has your GOOGLE_API_KEY

# Install dependencies
pip install -r requirements.txt

# Start the backend
uvicorn main:app --reload --port 8080
```

**Expected output:**
```
INFO:     Uvicorn running on http://127.0.0.1:8080
INFO:     Application startup complete.
```

### Terminal 2: Local Playwright Client

```bash
cd local_client

# Make sure dependencies are installed
pip install -r requirements.txt
playwright install chromium

# Start the client
python playwright_client.py
```

**Expected output:**
```
🚀 Starting local Playwright client...
📡 Connecting to Cloud Run agent at: ws://localhost:8080
✅ Browser launched
✅ Connected to agent brain
📝 Registered as client: default
🎯 Ready to receive commands from agent brain
💡 Start your frontend and run a workflow!
```

### Terminal 3: Frontend

```bash
cd frontend

# Install dependencies if needed
npm install

# Start frontend
npm run dev
```

**Expected output:**
```
▲ Next.js 14.x.x
- Local:        http://localhost:3001
```

## Testing the Flow

1. **Open browser**: Go to http://localhost:3001
2. **Enter URL**: In "Go to:" field, enter a URL like `https://www.google.com`
3. **Describe workflow**: Type or use voice to describe what to test
4. **Click Run**: Watch the magic happen!

## What Should Happen

1. Frontend sends prompt to Cloud Backend (Terminal 1)
2. Cloud Backend requests screenshot from Playwright Client (Terminal 2)
3. Playwright Client takes screenshot and sends to Cloud Backend
4. Cloud Backend sends screenshot to Gemini Computer Use
5. Gemini analyzes and returns tool calls
6. Cloud Backend forwards tool calls to Playwright Client
7. Playwright Client executes actions (you see browser moving!)
8. Loop continues until task complete

## Troubleshooting

### "WebSocket connection failed"
- Make sure cloud backend is running on port 8080
- Check frontend is connecting to `ws://localhost:8080/ws`

### "Local Playwright client not connected"
- Start Playwright client (Terminal 2) BEFORE running workflow
- Check client shows "Connected to agent brain"

### "No browser opens"
- Check Playwright is installed: `playwright install chromium`
- Verify local_client/playwright_client.py has `headless=False`

### "Agent does nothing"
- Check cloud_backend/.env has valid GOOGLE_API_KEY
- Verify COMPUTER_USE_MODEL_ID is set correctly
- Check Terminal 1 for errors

## Logs to Watch

**Terminal 1 (Cloud Backend):**
- "Playwright client connected: default"
- "Thinking..."
- "Executing actions..."

**Terminal 2 (Playwright Client):**
- "📸 Taking screenshot..."
- "⚡ Executing: click_at with args: {...}"
- "✅ Action completed: click_at"

**Terminal 3 (Frontend):**
- Should show UI updates in browser
- Check browser console for any errors

## Ready for Cloud Deployment?

Once everything works locally:
1. Deploy cloud backend to Cloud Run
2. Update `CLOUD_RUN_URL` in `local_client/playwright_client.py`
3. Update WebSocket URL in `frontend/app/page.tsx`
4. Test with cloud backend + local Playwright client
