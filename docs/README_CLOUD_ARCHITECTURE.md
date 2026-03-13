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

### 1. Deployed Backend (Current)

Cloud Run service is live:
- Service name: `benji-multiagent-backend`
- URL: `https://benji-multiagent-backend-2lw4x3ccbq-uc.a.run.app`
- Playwright socket: `wss://benji-multiagent-backend-2lw4x3ccbq-uc.a.run.app/playwright`

### 2. Deploy Again (When Needed)

```bash
cd cloud_backend
chmod +x deploy.sh

PROJECT_ID="your-gcp-project" \
GOOGLE_API_KEY="your-google-api-key" \
GITHUB_TOKEN="your-github-token" \
./deploy.sh
```

### 3. Start Local Playwright Client

```bash
cd local_client
pip install -r requirements.txt
playwright install chromium

CLOUD_RUN_URL="wss://benji-multiagent-backend-2lw4x3ccbq-uc.a.run.app" python playwright_client.py
```

### 4. Start Frontend Against Cloud Run

```bash
cd frontend
npm install

NEXT_PUBLIC_BACKEND_HTTP_URL="https://benji-multiagent-backend-2lw4x3ccbq-uc.a.run.app" \
NEXT_PUBLIC_BACKEND_WS_URL="wss://benji-multiagent-backend-2lw4x3ccbq-uc.a.run.app" \
npm run dev
```

### 5. Run the Full Stack

- Terminal 1: local Playwright client (`local_client/playwright_client.py`)
- Terminal 2: frontend (`frontend`, `npm run dev`)
- Cloud Run backend is already hosted and should remain running

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
GOOGLE_LOCATION=global
COMPUTER_USE_MODEL_ID=gemini-2.5-computer-use-preview-10-2025
GITHUB_TOKEN=your_github_token
GITHUB_ADK_MCP_MODEL_NAME=gemini-2.5-pro
GITHUB_MCP_URL=https://api.githubcopilot.com/mcp/
GITHUB_MCP_TOOLSETS=context,repos,issues,labels,pull_requests,actions,users,orgs
GITHUB_MCP_READONLY=false
```

### Local Playwright Client
Set `CLOUD_RUN_URL` when launching `playwright_client.py`:
- Local: `ws://localhost:8080`
- Production: `wss://benji-multiagent-backend-2lw4x3ccbq-uc.a.run.app`

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
