# Benji Cloud Architecture

## Overview

Benji now uses a **hybrid cloud architecture**:
- **Agent Brain** (Gemini) runs on Google Cloud Run
- **Playwright Execution** runs locally on your machine
- **Frontend** can run anywhere (localhost or deployed)

## Architecture Diagram

```
┌─────────────────┐
│   Frontend      │
│ (localhost:3001)│
└────────┬────────┘
         │ WebSocket
         ↓
┌─────────────────────────┐
│  Cloud Run Backend      │
│  (Agent Brain)          │
│  - Gemini API           │
│  - Tool Call Generation │
│  - No Playwright        │
└────────┬────────────────┘
         │ WebSocket
         ↓
┌─────────────────────────┐
│  Local Playwright       │
│  Client                 │
│  - Browser Automation   │
│  - Screenshot Capture   │
│  - Action Execution     │
└─────────────────────────┘
```

## Setup Instructions

### 1. Deploy Cloud Run Backend

```bash
cd cloud_backend

# Copy environment variables
cp .env.example .env
# Edit .env with your Google API key

# Deploy to Cloud Run
chmod +x deploy.sh
./deploy.sh
```

You'll get a URL like: `https://benji-agent-xyz.run.app`

### 2. Start Local Playwright Client

```bash
cd local_client

# Install dependencies
pip install -r requirements.txt
playwright install chromium

# Update CLOUD_RUN_URL in playwright_client.py with your Cloud Run URL
# For local testing: ws://localhost:8080
# For production: wss://benji-agent-xyz.run.app

# Run the client
python playwright_client.py
```

You should see:
```
🚀 Starting local Playwright client...
📡 Connecting to Cloud Run agent at: wss://benji-agent-xyz.run.app
✅ Browser launched
✅ Connected to agent brain
📝 Registered as client: default
🎯 Ready to receive commands from agent brain
```

### 3. Update Frontend

In `frontend/app/page.tsx`, update the WebSocket URL:

```typescript
// For local testing
const ws = new WebSocket("ws://localhost:8080/ws");

// For production
const ws = new WebSocket("wss://benji-agent-xyz.run.app/ws");
```

Add client_id to the initial message:

```typescript
ws.send(JSON.stringify({ 
  prompt: fullPrompt,
  client_id: "default"  // Match the CLIENT_ID in playwright_client.py
}));
```

### 4. Run the Full Stack

**Terminal 1 - Local Playwright Client:**
```bash
cd local_client
python playwright_client.py
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

**Cloud Run Backend:**
Already running at your deployed URL!

## How It Works

1. **User enters workflow** in frontend
2. **Frontend sends prompt** to Cloud Run backend via WebSocket
3. **Cloud Run waits** for local Playwright client to connect
4. **Agent loop begins:**
   - Cloud Run requests screenshot from local client
   - Local client takes screenshot, sends to Cloud Run
   - Cloud Run sends screenshot to Gemini
   - Gemini analyzes and returns tool calls
   - Cloud Run forwards tool calls to local client
   - Local client executes actions with Playwright
   - Local client sends results + new screenshot back
   - Repeat until task complete

## Benefits

✅ **Gemini on Cloud** - No local API calls, scales automatically  
✅ **Playwright Local** - Can test localhost apps, no tunneling needed  
✅ **Stateless Cloud Run** - Just relays messages, very lightweight  
✅ **Real Browser** - See actions happening on your machine  
✅ **Same Functionality** - All current features preserved  

## Testing Locally (Before Cloud Deployment)

You can test the architecture locally before deploying to Cloud Run:

**Terminal 1 - Cloud Backend (Local):**
```bash
cd cloud_backend
uvicorn main:app --reload --port 8080
```

**Terminal 2 - Playwright Client:**
```bash
cd local_client
# Make sure CLOUD_RUN_URL = "ws://localhost:8080"
python playwright_client.py
```

**Terminal 3 - Frontend:**
```bash
cd frontend
# Make sure WebSocket URL is "ws://localhost:8080/ws"
npm run dev
```

## Environment Variables

### Cloud Run Backend (.env)
```
GOOGLE_API_KEY=your_api_key
GOOGLE_CLOUD_PROJECT=your_project_id
GOOGLE_LOCATION=us-central1
MODEL_ID=gemini-2.0-flash-exp
```

### Local Playwright Client
Update `CLOUD_RUN_URL` in `playwright_client.py`:
- Local: `ws://localhost:8080`
- Production: `wss://your-app.run.app`

## Troubleshooting

**"Local Playwright client not connected"**
- Make sure `playwright_client.py` is running
- Check that `CLIENT_ID` matches in both client and frontend

**WebSocket connection failed**
- Verify Cloud Run URL is correct
- Check firewall/network settings
- Ensure Cloud Run service is deployed and running

**Actions not executing**
- Check playwright_client.py console for errors
- Verify browser launched successfully
- Check coordinate normalization (screen size)

## Cost Optimization

Cloud Run charges only when:
- WebSocket connections are active
- Agent is processing requests

When idle: **$0/month** (scales to zero)

Typical usage: ~$5-10/month for moderate testing
