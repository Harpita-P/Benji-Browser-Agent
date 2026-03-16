# Benji - Your AI Teammate for Real User Experience

The hardest part of building great web apps is that the experience can break in ways that are easy to miss until a real user runs into them. That's why we built Benji, an agentic browser agent that uses natural language to navigate your app like a real user. Benji uses multimodal vision and reasoning to click, type, and navigate to uncover meaningful bugs and help you ship reliable apps with more confidence.

## ➡️ Set Up Benji in 3 Steps

Before you begin, make sure you have:
- **Python 3.11+** and **Node.js 18+** installed
- A **Google Cloud account** with billing enabled
- **Google Cloud SDK** (`gcloud` CLI) - [Get it here](https://cloud.google.com/sdk/docs/install)
- Your **Gemini API Key** - [Generate one here](https://aistudio.google.com/app/apikey)
- **(Optional)** A **GitHub Personal Access Token** for automated bug fixing - [Create here](https://github.com/settings/tokens)

### Step 1: Deploy Your Backend to the Cloud

We host both agents—the Computer Use Agent (CUA) and the GitHub MCP Agent—on Google Cloud Run for serverless orchestration. This means the AI reasoning layer scales automatically based on demand, you only pay for active test execution time, and the backend handles multiple concurrent test sessions without any infrastructure management on your part.

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

After deployment, you'll get your Cloud Run service URL:
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

### Step 3: Launch the Frontend Workspace

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
