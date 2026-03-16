# Benji - AI QA Testing Agent

Benji is an autonomous AI agent that executes comprehensive visual UI testing workflows on web applications. Built on Google's Gemini 2.5 Computer Use model, Benji performs end-to-end testing by navigating applications, interacting with UI elements, validating expected behaviors, and providing detailed accessibility evaluations—all through natural language test specifications.

## ➡️ Set Up Benji in 3 Steps

Before you begin, make sure you have:
- **Python 3.11+** and **Node.js 18+** installed
- A **Google Cloud account** with billing enabled
- **Google Cloud SDK** (`gcloud` CLI) - [Get it here](https://cloud.google.com/sdk/docs/install)
- Your **Gemini API Key** - [Generate one here](https://aistudio.google.com/app/apikey)
- **(Optional)** A **GitHub Personal Access Token** for automated bug fixing - [Create here](https://github.com/settings/tokens)

### Step 1: Deploy Your Backend to the Cloud

Benji includes an automated deployment script that handles the entire Cloud Run setup, including Docker image building, Artifact Registry configuration, and service deployment.

```bash
# Navigate to the backend directory
cd cloud_backend

# Make the deployment script executable
chmod +x deploy.sh

# Deploy with required environment variables
PROJECT_ID="your-gcp-project-id" \
GOOGLE_API_KEY="your_gemini_api_key" \
GITHUB_TOKEN="your_github_token" \
./deploy.sh
```

**What the script does:**
1. Enables required GCP APIs (Cloud Run, Artifact Registry, Cloud Build)
2. Creates a Docker repository in Artifact Registry if it doesn't exist
3. Builds a Docker image from the `Dockerfile` using Cloud Build
4. Deploys the image to Cloud Run with optimized configuration:
   - 1 vCPU, 1GB memory
   - 3600s timeout (1 hour for long-running tests)
   - Auto-scaling up to 10 instances
   - Unauthenticated access for WebSocket connections
5. Configures environment variables (API keys, model IDs, GitHub MCP settings)

**Optional configuration:** You can customize the deployment by setting additional environment variables:

```bash
REGION="us-central1" \                    # Cloud Run region
SERVICE_NAME="benji-backend" \            # Custom service name
COMPUTER_USE_MODEL_ID="gemini-2.5-..." \  # Gemini model version
./deploy.sh
```

After successful deployment, the script outputs your Cloud Run service URL:
```
✅ Deployment complete!
🌐 Cloud Run URL: https://benji-backend-xxxxx-uc.a.run.app
🔌 Local Playwright should connect to: wss://benji-backend-xxxxx-uc.a.run.app
```

**Save this URL** - you'll need it for configuring the Playwright client and frontend.

### Step 2: Run the Playwright Client Locally

The Playwright client connects to your cloud backend and handles all the browser magic.

```bash
# Install Playwright and dependencies
pip install playwright websockets asyncio
playwright install chromium

# Configure the backend URL
# Edit playwright_client.py and update the BACKEND_WS_URL constant:
# BACKEND_WS_URL = "wss://your-cloud-run-url.run.app/playwright"

# Start the Playwright client
python playwright_client.py
```

You should see connection confirmation:
```
Playwright client connected to Cloud Run backend
Waiting for browser automation commands...
```

**Keep this terminal running** - the Playwright client must remain active to execute browser commands from the backend.

### Step 3: Launch the Frontend

Fire up the web interface where you'll control Benji.

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Configure backend URLs
cat > .env.local << EOF
NEXT_PUBLIC_BACKEND_HTTP_URL=https://your-cloud-run-url.run.app
NEXT_PUBLIC_BACKEND_WS_URL=wss://your-cloud-run-url.run.app
EOF

# Start the development server
npm run dev
```

Open `http://localhost:3000` in your browser and you're ready to go! 🎉

**Running your first test:**
1. Enter your app name and URL
2. Describe what you want to test in plain English (e.g., "Add a product to cart and verify the checkout flow")
3. Click **"Launch Workspace"**
4. Watch Benji navigate your app, test it visually, and report any bugs it finds

## 🏗️ Architecture Overview

![Benji Hybrid System Architecture](docs/architecture-diagram.png)

We built Benji as a **hybrid multi-agent system** that combines cloud-hosted AI reasoning with local browser execution. The architecture centers around two specialized agents working in concert: a **Computer Use Agent (CUA)** for visual UI testing and an **Autonomous Code Fix Agent** for automated bug remediation.

### Agent 1: Vision-Based Browser Control Agent (CUA)

At the core of Benji's testing capabilities is what we call the **Vision-Action Feedback Cycle**—a 4-step perception-to-action loop that enables the Gemini 2.5 Computer Use model to interact with web applications through pure visual understanding.

**How the CUA Loop Works:**

We created a continuous feedback cycle that mimics how a human QA engineer tests applications visually. Here's the flow:

1. **Send Visual State + Screenshot Context to Model**  
   The backend captures the current browser state as a full-page screenshot and sends it to Gemini 2.5 Computer Use along with the test workflow context. The model receives the raw visual data—no DOM inspection, no accessibility trees, just pixels.

2. **Vision Analysis → Output Coordinates {x, y}**  
   The Computer Use model analyzes the screenshot using its vision capabilities to understand the UI layout, identify interactive elements, and determine the next action. It outputs precise pixel coordinates for where to click, type, or interact (e.g., `click_at(x=450, y=320)`).

3. **Execute Actions via Playwright Client (WebSocket)**  
   The backend relays these coordinate-based commands to the local Playwright client over WebSocket. The Playwright client executes the action in the real browser—clicking at the exact coordinates, typing text, scrolling, or navigating.

4. **Capture New Environment State (Screenshot)**  
   After each action, Playwright captures a fresh screenshot of the updated browser state and sends it back to the backend. This new visual state becomes the input for the next iteration of the loop.

This cycle repeats continuously until the test workflow is complete or a bug is detected. We designed this as a **pure vision-based approach** because it mirrors real user interactions—the agent sees what users see and interacts through visual understanding rather than relying on DOM structure or element selectors that can be brittle.

**Why This Matters:** Traditional UI testing tools depend on CSS selectors, XPath, or accessibility IDs that break when the UI changes. Our vision-action feedback loop is resilient to UI refactors because the model adapts to visual changes just like a human tester would. If a button moves or changes color, the model still recognizes it visually and adjusts its actions accordingly.

The CUA runs on **Google Cloud Run** as a FastAPI WebSocket server, leveraging the Gemini 2.5 Computer Use model via the GenAI SDK. We chose Cloud Run for its serverless scalability—multiple test sessions can run concurrently without provisioning infrastructure, and you only pay for active test execution time.

### Agent 2: Autonomous Code Fix Agent (GitHub MCP)

When the CUA detects a bug during testing, we automatically invoke a second agent that analyzes the failure and generates code fixes. This agent uses the **Model Context Protocol (MCP)** via Google's Agent Development Kit (ADK) to interact with GitHub repositories.

**MCP-Powered Agentic Code Repair Pipeline:**

We built a multi-step autonomous workflow that transforms test failures into pull requests:

1. **Receive CUA Session Logs → Bug Description**  
   The GitHub agent receives the complete test session logs from the CUA, including screenshots, actions taken, and the specific failure point. It extracts the bug description and context.

2. **Analyze Repository Files (MCP: search, read code)**  
   Using MCP tools, the agent searches the connected GitHub repository for relevant files, reads the source code, and identifies the root cause of the bug based on the test failure patterns.

3. **Generate Changes, Create Branch & Commit**  
   The agent generates code fixes using Gemini 2.5 Pro, creates a new Git branch, commits the changes with descriptive messages, and pushes to the repository—all through MCP tool calls.

4. **Use `create_pull_request()` Tool → Generate Summary**  
   Finally, the agent creates a pull request with a detailed summary explaining what was broken, what was fixed, and how the fix addresses the test failure. The PR links back to the original test session for traceability.

This entire pipeline runs autonomously without human intervention. We integrated the GitHub MCP agent so that Benji doesn't just find bugs—it proposes solutions and creates actionable PRs that developers can review and merge.

### Playwright Local Client

The Playwright client is the execution layer that bridges the cloud-based CUA with the actual browser. We run this locally (not in Cloud Run) for several critical reasons:

- **Direct Browser Control:** Playwright needs system-level access to launch and control Chromium, which requires native OS integration
- **Localhost Testing:** Running locally allows you to test applications on `localhost` or internal networks that aren't publicly accessible
- **Performance:** Local execution eliminates network latency for browser commands and screenshot capture
- **Resource Efficiency:** Headless browsers are resource-intensive and don't fit the serverless model well

The client maintains a persistent WebSocket connection to the Cloud Run backend, receives action commands (e.g., `click_at(x, y)`, `type_text_at(text)`), executes them via Playwright's browser automation APIs, and streams screenshots back to the backend in real-time.

**Architecture Benefits:**

By separating the AI reasoning (cloud) from browser execution (local), we achieved:
- **Scalability:** The backend scales horizontally on Cloud Run for concurrent test sessions
- **Flexibility:** Test any application—public, localhost, or behind VPNs
- **Cost Efficiency:** Serverless pricing for the AI layer, local compute for browser automation
- **Resilience:** Vision-based testing that adapts to UI changes without brittle selectors

## � Project Structure

```
Web-Dojo/
├── cloud_backend/           # Agent Backend (FastAPI)
│   ├── main.py             # Main WebSocket server & Gemini integration
│   ├── github_agent.py     # GitHub MCP agent for bug analysis & fixes
│   ├── requirements.txt    # Python dependencies
│   ├── Dockerfile          # For Cloud Run deployment
│   └── .env               # Environment variables (create this)
│
├── frontend/               # Next.js UI
│   ├── app/
│   │   ├── page.tsx       # Main testing workspace UI
│   │   ├── layout.tsx     # Root layout
│   │   └── globals.css    # Tailwind styles
│   ├── package.json       # Node.js dependencies
│   └── .env.local         # Frontend environment variables (create this)
│
├── playwright_client.py    # Playwright Local Client (browser controller)
├── browser_agent.py       # Legacy standalone agent (deprecated)
│
├── docs/                  # Additional documentation
│   ├── RUN_REPO_QUICKSTART.md
│   ├── README_CLOUD_ARCHITECTURE.md
│   └── GITHUB_AGENT_WORKFLOW.md
│
└── README.md             # You are here!
```

## 🔧 Configuration & Environment Variables

### Cloud Run Backend Configuration

The backend is configured entirely through the `deploy.sh` script via environment variables. All configuration is injected at deployment time and persisted in the Cloud Run service:

**Required Variables:**
- `PROJECT_ID` - Your Google Cloud project identifier
- `GOOGLE_API_KEY` - Gemini API key for model access
- `GITHUB_TOKEN` - GitHub personal access token for MCP agent (repo scope required)

**Optional Variables:**
- `REGION` - Cloud Run deployment region (default: `us-central1`)
- `SERVICE_NAME` - Cloud Run service name (default: `benji-multiagent-backend`)
- `COMPUTER_USE_MODEL_ID` - Gemini model version (default: `gemini-2.5-computer-use-preview-10-2025`)
- `GITHUB_ADK_MCP_MODEL_NAME` - Model for GitHub agent (default: `gemini-2.5-pro`)
- `MODEL_RETRY_MAX_ATTEMPTS` - API retry attempts (default: `4`)
- `MODEL_RETRY_BASE_DELAY_SECONDS` - Exponential backoff base delay (default: `1.5`)
- `LOG_LEVEL` - Backend logging verbosity (default: `INFO`)

### Playwright Client Configuration

The Playwright client requires a single configuration change to connect to your deployed Cloud Run backend:

```python
# Edit playwright_client.py, line ~10
BACKEND_WS_URL = "wss://your-cloud-run-url.run.app/playwright"
```

Replace `your-cloud-run-url.run.app` with the actual Cloud Run URL from your deployment output. The protocol must be `wss://` (WebSocket Secure) for Cloud Run connections.

### Frontend Configuration

Configure the Next.js frontend to communicate with your Cloud Run backend:

```bash
# Create .env.local in the frontend/ directory
NEXT_PUBLIC_BACKEND_HTTP_URL=https://your-cloud-run-url.run.app
NEXT_PUBLIC_BACKEND_WS_URL=wss://your-cloud-run-url.run.app
```

These environment variables are consumed by the Next.js build process and embedded into the client-side bundle for WebSocket connection establishment.
