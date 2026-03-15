# Benji AI Testing Platform - Architecture Documentation

## 🏗️ System Architecture Overview

Benji is a **hybrid AI-powered testing platform** that combines local browser automation with cloud-based AI agents to automatically test web applications, detect bugs, and generate code fixes via GitHub integration.

### 🌟 **Hackathon Focus: Multimodal Gemini Agents on Google Cloud**

**Key Technologies:**
- ✅ **Multimodal AI**: Gemini 2.0 Flash with Computer Use (vision + action)
- ✅ **Google Cloud Hosting**: Cloud Run for serverless agent orchestration
- ✅ **Google GenAI SDK**: Direct API access to Gemini models
- ✅ **Google ADK**: Agent Development Kit for GitHub integration
- ✅ **GitHub MCP Tool**: Model Context Protocol for code analysis & PR creation

**What Makes Benji Special:**
1. **Screenshot-Based Vision**: Gemini analyzes UI through images, not DOM inspection
2. **Agentic Loop**: Autonomous decision-making with continuous feedback
3. **Hybrid Architecture**: Cloud intelligence + local browser control
4. **Automated Fixes**: From bug detection to PR creation, fully automated

---

## 📊 Benji Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           USER INTERFACE                                  │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Next.js Frontend                                                   │ │
│  │  • Real-time WebSocket • Voice Input • Live Browser View           │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │ WebSocket (WSS) + HTTPS
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    CLOUD LAYER (Google Cloud Run)                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  FastAPI Backend - Agent Orchestration                              │ │
│  │  • WebSocket Manager • Session Management • Turn-based Loop        │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │  AGENT 1: CUA Agent          │  │  AGENT 2: Autonomous Code Fix   │  │
│  │                              │  │           Agent                 │  │
│  │  ┌─────────────────────────┐ │  │  ┌─────────────────────────────┐│  │
│  │  │ gemini-2.5-computer-use- │ │  │  │ Gemini 2.5 Pro              ││  │
│  │  │ preview-10-2025         │ │  │  │                             ││  │
│  │  └─────────────────────────┘ │  │  └─────────────────────────────┘│  │
│  │                               │  │                                 │  │
│  │  Via: Google GenAI SDK        │  │  Via: Google ADK                │  │
│  │                               │  │  Tools: GitHub MCP              │  │
│  │  Vision Action Feedback Cycle │  │  Endpoint: /analyze-bugs        │  │
│  │  🔄 CUA LOOP (4 Steps):       │  │  🔧 Auto Bug Fixing Workflow:   │  │
│  │  ┌─────────────────────────┐ │  │  ┌───────────────────────────┐ │  │
│  │  │ 1. Send Visual State +  │ │  │  │ 1. Receive Session Logs + │ │  │
│  │  │    Context to Model     │ │  │  │    Bug Description        │ │  │
│  │  │         ↓               │ │  │  │         ↓                 │ │  │
│  │  │ 2. Vision Analysis →    │ │  │  │ 2. Analyze Code via MCP:  │ │  │
│  │  │    Output Coordinates   │ │  │  │    • search_code          │ │  │
│  │  │    {x: 500, y: 300}     │ │  │  │    • get_file_contents    │ │  │
│  │  │         ↓               │ │  │  │         ↓                 │ │  │
│  │  │ 3. Execute Action via   │ │  │  │ 3. Generate Fix +         │ │  │
│  │  │    Playwright (WS)      │ │  │  │    Create Branch          │ │  │
│  │  │         ↓               │ │  │  │         ↓                 │ │  │
│  │  │ 4. Capture New          │ │  │  │ 4. Commit Changes via:    │ │  │
│  │  │    Environment State    │ │  │  │    • create_or_update_file│ │  │
│  │  │    (Screenshot) → Loop  │ │  │  │    • push_files           │ │  │
│  │  └─────────────────────────┘ │  │  │         ↓                 │ │  │
│  │                               │  │  │ 5. Create Pull Request    │ │  │
│  │  Outputs: Pixel coordinates   │  │  │    → Return PR URL        │ │  │
│  │  for precise UI interaction   │  │  └───────────────────────────┘ │  │
│  └───────────────────────────────┘  └─────────────────────────────────┘  │
└────────────────┬──────────────────────────────────────┬──────────────────┘
                 │                                      │
                 │ WebSocket                            │ GitHub MCP
                 │ {action, x, y}                       │ (Remote Server)
                 ▼                                      ▼
┌──────────────────────────────┐      ┌─────────────────────────────────────┐
│  LOCAL EXECUTION              │      │  EXTERNAL SERVICES                  │
│  ┌────────────────────────┐  │      │  ┌───────────────────────────────┐ │
│  │ Playwright Client      │  │      │  │ GitHub Repository             │ │
│  │ (Python)               │  │      │  │ (via MCP Remote Server)       │ │
│  │                        │  │      │  │ • Branch creation             │ │
│  │ Receives from CUA:     │  │      │  │ • Code commits                │ │
│  │ ┌────────────────────┐ │  │      │  │ • Pull Requests               │ │
│  │ │ click_at(500, 300) │ │  │      │  └───────────────────────────────┘ │
│  │ │ type_text_at(x, y) │ │  │      │                                     │
│  │ │ navigate(url)      │ │  │      │  ┌───────────────────────────────┐ │
│  │ │ scroll(direction)  │ │  │      │  │ Google Cloud TTS              │ │
│  │ └────────────────────┘ │  │      │  │ • Voice synthesis             │ │
│  │                        │  │      │  └───────────────────────────────┘ │
│  │ • Executes at exact    │  │      │                                     │
│  │   pixel coordinates    │  │      │                                     │
│  │ • Captures screenshots │  │      │                                     │
│  │ • Returns URL + image  │  │      │                                     │
│  └────────────────────────┘  │      │                                     │
│                               │      │                                     │
│  Runs on: User's Machine     │      │                                     │
└──────────────────────────────┘      └─────────────────────────────────────┘

HYBRID ARCHITECTURE:
• Cloud: Google Cloud Run hosts 2 AI agents (GenAI SDK + ADK)
• Local: Playwright client controls browser on user's machine
• Agents: CUA (testing) + GitHub (code fixes via MCP)
```

---

## 🔄 Data Flow Architecture

### **1. Workflow Execution Flow**

```
User Input → Frontend → Cloud Backend → CUA Agent → Playwright Client → Target App
     ↓           ↓            ↓              ↓              ↓              ↓
  Voice/Text  WebSocket   Orchestrator   Vision AI    Browser Actions   UI Changes
                  ↓            ↓              ↓              ↓              ↓
              Session      Turn Loop      Action Plan   Screenshots    State Updates
                  ↓            ↓              ↓              ↓              ↓
              Frontend ← Backend ← Agent ← Playwright ← Target App ← User Sees
```

### **2. Bug Detection & Fix Flow**

```
Test Failure → CUA Agent Detects Bug → Backend Logs Bug → Frontend Shows Alert
                                              ↓
                                    User Clicks "Accept"
                                              ↓
                                    GitHub Agent Triggered
                                              ↓
                        ┌─────────────────────┴─────────────────────┐
                        ▼                                           ▼
              Analyze Session Logs                        Access Repository
                        ↓                                           ▼
              Generate Code Fix                          Create Branch
                        ↓                                           ▼
              Create Commit                               Push Changes
                        ↓                                           ▼
              Create Pull Request ◄───────────────────────┘
                        ↓
              Return PR URL to Frontend
                        ↓
              Display in Modal
```

---

## 🧩 Component Breakdown

### **Frontend Layer (Next.js + React)**

**Technology Stack:**
- Next.js 14 (React Framework)
- TypeScript
- TailwindCSS
- Lucide React Icons
- Web Speech API

**Key Components:**
1. **Workspace Page** (`/app/page.tsx`)
   - Main testing interface
   - Real-time status display
   - Voice input integration
   - Live browser view

2. **WebSocket Client**
   - Connects to Cloud Run backend
   - Receives real-time updates:
     - Screenshots
     - Agent thoughts
     - Action execution status
     - Bug reports
     - Accessibility suggestions

3. **State Management**
   - Session tracking
   - Workflow history
   - Bug descriptions
   - Analysis results

**User Interactions:**
- Voice/text workflow input
- GitHub repository connection
- Bug fix acceptance/rejection
- Real-time monitoring

---

### **Cloud Backend Layer (Google Cloud Run)**

**Technology Stack:**
- FastAPI (Python)
- WebSockets (async)
- Google GenAI SDK
- Vertex AI

**Hosted On:**
- Google Cloud Run
- Auto-scaling serverless containers
- WebSocket support enabled

**Core Modules:**

#### 1. **WebSocket Manager**
```python
# Manages dual WebSocket connections
- Frontend connections (user interface)
- Playwright client connections (browser automation)
- Session routing & message broadcasting
- Keepalive mechanisms
```

#### 2. **Agent Orchestration Engine - The Computer Use Agent Loop**

**🎯 Core Innovation: Multimodal Screenshot-Based Agentic Control**

Benji implements Google's Computer Use model in a sophisticated **vision-action feedback loop** that enables autonomous browser control through visual understanding. This is the heart of our agentic architecture.

**The CUA Loop - 4 Steps:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    INITIAL TASK                                      │
│              (User's workflow description)                           │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 1: SEND REQUEST TO MODEL                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ • Screenshot (PNG, base64 encoded)                            │ │
│  │ • Previous context (conversation history)                     │ │
│  │ • User's goal/workflow description                            │ │
│  │ • Computer Use tool definition                                │ │
│  │ • Custom bug detection instructions                           │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 2: RECEIVE MODEL RESPONSE                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Gemini 2.0 Flash analyzes screenshot + context                │ │
│  │                                                                │ │
│  │ Returns:                                                       │ │
│  │ • function_call: {                                            │ │
│  │     name: "click_at",                                         │ │
│  │     args: {x: 500, y: 300}                                    │ │
│  │   }                                                            │ │
│  │ • thinking: "I see an Add to Cart button at..."              │ │
│  │ • safety_decision: "regular" | "require_confirmation"         │ │
│  │ • bug_explanation: "Cart shows wrong quantity"                │ │
│  │ • accessibility_suggestions: [...]                            │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 3: EXECUTE THE RECEIVED ACTION                                │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Safety Decision Handling:                                     │ │
│  │                                                                │ │
│  │ IF safety_decision == "regular" OR no safety_decision:        │ │
│  │   → Execute action immediately via Playwright                 │ │
│  │                                                                │ │
│  │ IF safety_decision == "require_confirmation":                 │ │
│  │   → Prompt user for confirmation                              │ │
│  │   → If confirmed: execute action                              │ │
│  │   → If denied: skip action, send feedback to model            │ │
│  │                                                                │ │
│  │ Benji Implementation:                                          │ │
│  │ • Auto-acknowledge all safety decisions (testing mode)        │ │
│  │ • Send action to Playwright client via WebSocket              │ │
│  │ • Playwright executes in local browser                        │ │
│  │ • Wait for action completion                                  │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 4: CAPTURE NEW ENVIRONMENT STATE                              │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ After action execution:                                        │ │
│  │                                                                │ │
│  │ • Playwright captures NEW screenshot                          │ │
│  │ • Captures current URL                                         │ │
│  │ • Encodes screenshot as base64                                 │ │
│  │ • Sends back to backend via WebSocket                         │ │
│  │                                                                │ │
│  │ Backend creates function_response:                            │ │
│  │ {                                                              │ │
│  │   "url": "https://example.com/cart",                          │ │
│  │   "status": "executed",                                        │ │
│  │   "safety_acknowledgement": "true"                             │ │
│  │ }                                                              │ │
│  │                                                                │ │
│  │ Appends to conversation history with new screenshot            │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ LOOP CONTINUES
                             │ (Returns to Step 1 with new screenshot)
                             │
                             ▼
                    Until task complete or
                    error/termination occurs
```

**🔄 The Vision-Action Feedback Cycle**

```
Screenshot → Vision Analysis → Action Planning → Browser Execution → New Screenshot
    ↑                                                                        │
    └────────────────────────────────────────────────────────────────────────┘
                              (Continuous Loop)
```

**Key Implementation Details:**

```python
# Main workflow execution loop
while not workflow_complete:
    # STEP 1: Send request to model
    contents.append(
        genai.types.Content(
            role="user",
            parts=[
                genai.types.Part.from_text(text=qa_prompt),
                genai.types.Part.from_bytes(
                    data=screenshot_bytes,
                    mime_type="image/png"
                ),
            ]
        )
    )
    
    # STEP 2: Receive model response
    response = await model.generate_content_async(
        contents=contents,
        tools=[computer_use_tool],
    )
    
    # Extract function call (action)
    function_call = response.candidates[0].content.parts[0].function_call
    
    # STEP 3: Execute the received action
    await playwright_ws.send_json({
        "type": "execute_action",
        "function": function_call.name,
        "args": dict(function_call.args)
    })
    
    # Wait for execution result
    result = await playwright_ws.receive_json()
    
    # STEP 4: Capture new environment state
    screenshot_base64 = result.get("screenshot", "")
    screenshot_bytes = base64.b64decode(screenshot_base64)
    current_url = result.get("url", "")
    
    # Build function response
    function_response = {
        "url": current_url,
        "status": "executed",
        "safety_acknowledgement": "true"
    }
    
    # Append to conversation history
    contents.append(
        genai.types.Content(
            role="function",
            parts=[
                genai.types.Part.from_function_response(
                    name=function_call.name,
                    response=function_response
                )
            ]
        )
    )
    contents.append(
        genai.types.Content(
            role="user",
            parts=[
                genai.types.Part.from_bytes(
                    data=screenshot_bytes,
                    mime_type="image/png"
                )
            ]
        )
    )
    
    # Loop continues with new screenshot...
```

**🎨 Multimodal Vision Capabilities**

The Computer Use model's vision system analyzes screenshots to:

1. **Identify UI Elements**
   - Buttons, forms, links, images
   - Text content and labels
   - Layout and positioning
   - Interactive elements

2. **Understand Context**
   - Current page state
   - Workflow progress
   - Error messages
   - Success indicators

3. **Detect Issues**
   - Low contrast elements
   - Misaligned content
   - Missing functionality
   - Incorrect data display

4. **Plan Actions**
   - Determine next step
   - Calculate click coordinates
   - Decide what text to type
   - Choose scroll direction

**🛡️ Safety Decision Handling**

Benji implements Google's safety framework:

```python
# Safety decision types
REGULAR = "regular"              # Safe to execute
REQUIRE_CONFIRMATION = "require_confirmation"  # Needs user approval
BLOCK = "block"                  # Unsafe, don't execute

# Benji's implementation (testing mode)
safety_acknowledgement = "true"  # Auto-approve all actions

# Production implementation would include:
if safety_decision == "require_confirmation":
    user_approval = await prompt_user_for_confirmation(action)
    if not user_approval:
        skip_action()
        send_denial_feedback_to_model()
```

**📊 Turn-Based Execution**

Each "turn" in the loop represents:
- 1 screenshot analysis
- 1 action decision
- 1 browser action execution
- 1 new screenshot capture

Average turn time: **4-9 seconds**
- Model inference: 2-5s
- Action execution: 1-2s
- Screenshot capture: 0.5-1s
- Network latency: 0.5-1s

**🎯 Loop Termination Conditions**

The loop exits when:
1. ✅ **Task Complete**: Model reports "TEST PASSED"
2. ❌ **Bug Detected**: Model reports "TEST FAILED - BUG DETECTED"
3. 🚫 **Safety Block**: Action blocked by safety system
4. ⚠️ **Error**: Exception or timeout occurs
5. 👤 **User Stop**: User manually terminates workflow

#### 3. **CUA Agent Prompting System**
```python
# Detailed instructions for AI agent
- Accessibility bug detection (low contrast buttons)
- Incorrect association bugs (image-text mismatch)
- E-commerce bugs (cart quantity, pricing)
- Icon functionality bugs (non-working favorites/bookmarks)
- Bug explanation generation (bug_explanation field)
```

#### 4. **Bug Analysis API**
```python
# POST /analyze-bugs endpoint
- Aggregates session logs
- Invokes GitHub Agent via MCP
- Returns PR creation results
```

**Environment Variables:**
- `GOOGLE_API_KEY`: Gemini API access
- `CLOUD_RUN_URL`: Backend WebSocket URL
- GitHub credentials (via MCP)

---

### **Local Execution Layer (Playwright Client)**

**Technology Stack:**
- Python 3.11+
- Playwright (async)
- WebSocket client

**Runs On:**
- User's local machine
- Connects to user's localhost apps
- Direct browser control

**Capabilities:**

#### Browser Automation Functions:
```python
1. open_web_browser()
   - Launches Chromium browser
   - Initializes page context

2. navigate(url)
   - Navigates to specified URL
   - Waits for page load

3. click_at(x, y)
   - Clicks at pixel coordinates
   - Handles dynamic elements

4. type_text_at(x, y, text)
   - Types text at coordinates
   - Simulates user input

5. scroll(direction, amount)
   - Scrolls page up/down
   - Handles infinite scroll

6. wait(seconds)
   - Pauses execution
   - Allows page rendering
```

#### Screenshot Pipeline:
```python
- Captures full-page screenshots
- Base64 encoding
- Sends to backend via WebSocket
- Includes current URL metadata
```

**Connection Flow:**
```
1. Start Playwright client with CLOUD_RUN_URL
2. Connect to backend WebSocket
3. Register as client (ID: "default")
4. Wait for action commands
5. Execute actions on local browser
6. Return results + screenshots
7. Repeat until workflow complete
```

---

### **AI Brain Layer (Gemini Models)**

**🎯 Google Cloud & AI Services Integration**

Benji leverages multiple Google Cloud services and AI APIs to power its intelligent testing capabilities:

#### **Google Cloud Services Used:**

1. **Google Cloud Run**
   - Hosts the FastAPI backend
   - Serverless container deployment
   - Auto-scaling: 0-10 instances
   - WebSocket support enabled
   - Region: us-central1
   - Memory: 2GB per instance
   - CPU: 2 vCPU

2. **Google Cloud Text-to-Speech**
   - Generates voice feedback for agent updates
   - Used for "Benji thinking" audio
   - Real-time synthesis during workflow execution

#### **AI APIs & SDKs Used:**

**Primary: Google GenAI SDK** ✅

```python
from google import genai

# Used for CUA Agent (Computer Use)
client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

# Model configuration
model = genai.GenerativeModel(
    model_name="gemini-2.0-flash-exp",
    generation_config={
        "temperature": 0.7,
        "top_p": 0.95,
        "top_k": 40,
        "max_output_tokens": 8192,
    },
    tools=[computer_use_tool],
)
```

**Why GenAI SDK?**
- Direct API access to latest Gemini models
- Native Computer Use tool support
- Simpler authentication (API key)
- Lower latency for real-time testing
- Better for experimental models (gemini-2.0-flash-exp)

**Secondary: Google ADK (Agent Development Kit)** ✅

```python
from google.adk.agents.llm_agent import LlmAgent
from google.adk.tools.mcp_tool import McpToolset
from google.genai import types

# Used for GitHub Agent
agent = LlmAgent(
    model=GITHUB_ADK_MCP_MODEL_NAME,  # gemini-2.5-pro
    tools=[github_mcp_toolset],
)
```

**Why ADK?**
- Built-in MCP (Model Context Protocol) support
- Structured agent workflows
- Session management
- Tool orchestration for GitHub operations

**Note on Vertex AI:**
- Not directly used in current implementation
- ADK internally uses Vertex AI for some operations
- GenAI SDK can route through Vertex AI if configured
- Future enhancement: Could migrate to Vertex AI for enterprise features

#### **1. CUA Agent (Computer Use Agent)**

**Model:** `gemini-2.0-flash-exp`
**Accessed via:** Google GenAI SDK

**Configuration:**
```python
model = genai.GenerativeModel(
    model_name="gemini-2.0-flash-exp",
    generation_config={
        "temperature": 0.7,
        "top_p": 0.95,
        "top_k": 40,
        "max_output_tokens": 8192,
    },
    tools=[computer_use_tool],
)
```

**Capabilities:**
- **Vision Analysis**: Analyzes screenshots to understand UI state
- **Action Planning**: Determines next steps to complete workflow
- **Bug Detection**: Identifies UI/UX issues during testing
- **Accessibility Checking**: Detects low contrast, missing labels
- **E-commerce Validation**: Verifies cart, pricing, inventory logic
- **Icon Testing**: Checks if clickable icons actually work

**Input Format:**
```
Prompt + Screenshot → Gemini → Action Plan + Observations
```

**Output Format:**
```json
{
  "action": "click_at",
  "x": 500,
  "y": 300,
  "thinking": "Clicking the Add to Cart button...",
  "bug_explanation": "Cart shows 1 item instead of 3",
  "accessibility_suggestions": ["Make the Submit button text darker"]
}
```

#### **2. GitHub Agent - Powered by GitHub MCP Tool**

**Model:** `gemini-2.5-pro`
**Accessed via:** Google ADK + GitHub MCP (Model Context Protocol)

**🔧 GitHub MCP Tool Configuration**

The GitHub MCP Server connects AI agents directly to GitHub's platform, enabling natural language code operations.

**MCP Server Details:**
```python
GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/"
DEFAULT_TOOLSETS = "context,repos,issues,labels,pull_requests,actions,users,orgs"

# MCP Configuration Headers
X-MCP-Toolsets: "repos,issues,pull_requests"  # Enabled toolsets
X-MCP-Readonly: false  # Allow write operations
```

**Toolsets Enabled:**

1. **`repos` Toolset** - Repository Operations
   - `get_file_contents`: Read source code files
   - `create_or_update_file`: Modify/create files
   - `create_branch`: Create fix branches
   - `push_files`: Commit changes
   - `list_branches`: View existing branches
   - `search_code`: Find relevant code sections

2. **`issues` Toolset** - Issue Management
   - `issue_read`: Read bug reports
   - `issue_write`: Create/update issues
   - `add_issue_comment`: Add comments to issues
   - `list_issues`: Browse existing issues
   - `search_issues`: Find related bugs

3. **`pull_requests` Toolset** - PR Operations
   - `create_pull_request`: Create PRs for fixes
   - `pull_request_read`: Read PR details
   - `update_pull_request`: Modify PR content
   - `merge_pull_request`: Auto-merge if approved
   - `list_pull_requests`: View existing PRs
   - `add_comment_to_pending_review`: Add review comments

4. **`context` Toolset** - Repository Context
   - Understand project structure
   - Analyze dependencies
   - Read documentation

**Specific Tools Used by Benji:**

```python
ALLOWED_GITHUB_TOOLS = [
    # Branch & File Operations
    "create_branch",              # Create fix branch
    "create_or_update_file",      # Apply code fixes
    "get_file_contents",          # Read source files
    "push_files",                 # Commit changes
    
    # Pull Request Operations
    "create_pull_request",        # Create PR for review
    "update_pull_request",        # Update PR description
    "pull_request_read",          # Read PR status
    
    # Code Analysis
    "search_code",                # Find bug locations
    "get_commit",                 # View commit history
    "list_commits",               # Analyze changes
    
    # Repository Info
    "list_branches",              # Check existing branches
    "get_me",                     # Get user info
]
```

**ADK Integration:**

```python
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPServerParams

# Initialize GitHub MCP toolset
github_mcp_toolset = McpToolset(
    server_params=StreamableHTTPServerParams(
        url=GITHUB_MCP_URL,
        headers={
            "X-MCP-Toolsets": "repos,issues,pull_requests",
            "X-MCP-Readonly": "false",
        }
    ),
    allowed_tools=ALLOWED_GITHUB_TOOLS,
)

# Create GitHub agent with MCP tools
github_agent = LlmAgent(
    model="gemini-2.5-pro",
    tools=[github_mcp_toolset],
    system_instruction="Analyze bugs and generate code fixes..."
)
```

**Automated Fix Workflow:**

```
1. User clicks "Accept" on bug
   ↓
2. Backend sends session logs to GitHub Agent
   ↓
3. GitHub Agent (via MCP):
   a. search_code: Find bug location in repo
   b. get_file_contents: Read affected files
   c. Analyze bug + generate fix
   d. create_branch: "benji-fix-[timestamp]"
   e. create_or_update_file: Apply fixes
   f. push_files: Commit changes
   g. create_pull_request: Create PR
   ↓
4. Return PR URL to frontend
   ↓
5. Display in modal with PR link
```

**Example MCP Tool Call:**

```python
# Agent decides to create a branch
{
  "tool": "create_branch",
  "arguments": {
    "owner": "username",
    "repo": "my-app",
    "branch": "benji-fix-cart-quantity-1234567890",
    "from_branch": "main"
  }
}

# Agent creates a file with fix
{
  "tool": "create_or_update_file",
  "arguments": {
    "owner": "username",
    "repo": "my-app",
    "path": "src/components/Cart.tsx",
    "content": "// Fixed code here...",
    "message": "Fix: Correct cart quantity calculation",
    "branch": "benji-fix-cart-quantity-1234567890"
  }
}

# Agent creates PR
{
  "tool": "create_pull_request",
  "arguments": {
    "owner": "username",
    "repo": "my-app",
    "title": "Fix: Cart quantity shows incorrect value",
    "body": "Fixes bug where cart displays 1 item instead of actual quantity added...",
    "head": "benji-fix-cart-quantity-1234567890",
    "base": "main"
  }
}
```

**Why MCP for GitHub?**
- ✅ Natural language → GitHub operations
- ✅ No manual API integration needed
- ✅ Structured tool definitions
- ✅ Built-in error handling
- ✅ Session management
- ✅ Secure authentication via headers

---

## 🔌 Connection Architecture

### **WebSocket Connections**

#### **Frontend ↔ Backend**
```
Protocol: WSS (WebSocket Secure)
URL: wss://benji-multiagent-backend-*.run.app
Purpose: Real-time bidirectional communication

Messages Sent (Frontend → Backend):
- Workflow start requests
- Voice input transcriptions
- GitHub connection details
- Bug fix acceptance

Messages Received (Backend → Frontend):
- Screenshots (base64)
- Agent thinking updates
- Action execution status
- Bug reports
- Accessibility suggestions
- Workflow completion status
```

#### **Backend ↔ Playwright Client**
```
Protocol: WSS
URL: wss://benji-multiagent-backend-*.run.app
Purpose: Browser automation control

Messages Sent (Backend → Playwright):
- Action commands (click, type, navigate)
- Screenshot requests

Messages Received (Playwright → Backend):
- Action results
- Screenshots (base64)
- Current URL
- Error messages
```

### **API Connections**

#### **Backend → Gemini API**
```
Protocol: HTTPS
Endpoint: Vertex AI / GenAI SDK
Authentication: GOOGLE_API_KEY
Purpose: AI model inference

Request Format:
- Prompt text
- Screenshot (base64 image)
- Tool definitions (Computer Use)

Response Format:
- Function calls (actions)
- Thinking process
- Bug reports
- Suggestions
```

#### **Backend → GitHub API (via MCP)**
```
Protocol: HTTPS
Endpoint: GitHub REST API
Authentication: GitHub token (via MCP)
Purpose: Code fixes & PR creation

Operations:
- Repository access
- Branch creation
- File modifications
- Commit creation
- Pull Request creation
```

#### **Backend → Google Cloud TTS**
```
Protocol: HTTPS
Endpoint: Cloud Text-to-Speech API
Purpose: Voice synthesis for agent updates

Request: Text string
Response: Audio data (base64)
```

---

## 📦 Data Storage & State Management

### **In-Memory State (Backend)**

```python
# Session logs (per session_id)
session_logs = {
    "session_123": [
        {"type": "thinking", "content": "...", "timestamp": "..."},
        {"type": "action", "content": "...", "timestamp": "..."},
        {"type": "screenshot", "data": "...", "timestamp": "..."},
    ]
}

# Session metadata
session_meta = {
    "session_123": {
        "workflow_name": "Add to cart test",
        "status": "running",
        "bug_detected": False,
        "error": None,
    }
}

# WebSocket connections
playwright_clients = {
    "default": <WebSocket connection>
}
```

### **Frontend State (React)**

```typescript
// Workflow state
const [currentWorkflowName, setCurrentWorkflowName] = useState<string>("");
const [workflowCounter, setWorkflowCounter] = useState(1);
const [workflowCompleted, setWorkflowCompleted] = useState(false);
const [lastWorkflowStatus, setLastWorkflowStatus] = useState<"passed" | "failed" | null>(null);

// Bug tracking
const [bugDescription, setBugDescription] = useState<string>("");
const [isAnalyzing, setIsAnalyzing] = useState(false);
const [analysisResult, setAnalysisResult] = useState<any>(null);

// Session tracking
const [sessionId, setSessionId] = useState<string>("");
const [logs, setLogs] = useState<Array<LogEntry>>([]);
const [screenshot, setScreenshot] = useState<string>("");
const [currentUrl, setCurrentUrl] = useState<string>("");
```

---

## 🔐 Security & Authentication

### **API Keys & Credentials**

1. **Gemini API Key**
   - Stored in backend environment
   - Used for all AI model calls
   - Never exposed to frontend

2. **GitHub Credentials**
   - Managed via MCP tool
   - Scoped to repository access
   - Used only for code fixes

3. **WebSocket Security**
   - WSS (encrypted connections)
   - Session-based routing
   - No authentication required (demo)

---

## 🚀 Deployment Architecture

### **Frontend Deployment**
```
Platform: Vercel / Cloud Run
Build: Next.js production build
Environment: Node.js 18+
Port: 3000 (development)
```

### **Backend Deployment**
```
Platform: Google Cloud Run
Container: Python 3.11 + FastAPI
Auto-scaling: 0-10 instances
Memory: 2GB per instance
CPU: 2 vCPU
WebSocket: Enabled
Environment Variables:
  - GOOGLE_API_KEY
  - CLOUD_RUN_URL
```

### **Playwright Client Deployment**
```
Platform: User's local machine
Requirements:
  - Python 3.11+
  - Playwright browsers installed
  - Network access to Cloud Run backend
Execution:
  CLOUD_RUN_URL="wss://..." python playwright_client.py
```

---

## 📊 Performance Characteristics

### **Latency Breakdown**

```
User Action → Frontend: <50ms
Frontend → Backend (WebSocket): 50-100ms
Backend → Gemini API: 1-3 seconds
Gemini → Action Plan: 2-5 seconds
Backend → Playwright: 50-100ms
Playwright → Browser Action: 100-500ms
Screenshot Capture: 200-500ms
Total Turn Time: 4-9 seconds
```

### **Scalability**

- **Frontend**: Serverless, auto-scales with traffic
- **Backend**: Cloud Run auto-scales 0-10 instances
- **Playwright**: 1 client per user (local)
- **Gemini API**: Rate limited by quota

---

## 🎯 Key Architectural Decisions

### **Why Hybrid Architecture?**

1. **Local Playwright Client**
   - Direct access to localhost apps
   - No firewall/network issues
   - Full browser control
   - User's machine resources

2. **Cloud Backend**
   - Centralized AI orchestration
   - Scalable WebSocket management
   - Secure API key storage
   - Session state management

3. **Separation of Concerns**
   - Frontend: UI/UX only
   - Backend: Orchestration + AI
   - Playwright: Browser automation
   - Gemini: Intelligence

### **Why WebSockets?**

- Real-time bidirectional communication
- Low latency for action commands
- Efficient for streaming screenshots
- Better than polling for live updates

### **Why Gemini 2.0 Flash with Computer Use?**

- Native vision + action capabilities
- Understands UI from screenshots
- Can plan multi-step workflows
- Fast inference times
- Cost-effective for testing workloads

---

## 🔄 Future Architecture Enhancements

1. **Database Integration**
   - PostgreSQL for session persistence
   - Historical test results
   - Bug tracking over time

2. **Multi-Browser Support**
   - Firefox, Safari clients
   - Mobile browser testing

3. **Distributed Playwright**
   - Cloud-hosted browser grid
   - Parallel test execution

4. **Advanced Analytics**
   - Test coverage metrics
   - Bug trend analysis
   - Performance monitoring

---

## 📝 Architecture Summary

**Benji** is a sophisticated hybrid testing platform that combines:

- **Next.js Frontend** for user interaction
- **Cloud Run Backend** for orchestration
- **Local Playwright** for browser control
- **Gemini AI** for intelligent testing
- **GitHub Integration** for automated fixes

The architecture is designed for:
- ✅ Real-time responsiveness
- ✅ Scalability
- ✅ Security
- ✅ Ease of use
- ✅ Cost efficiency

This hybrid approach provides the best of both worlds: cloud-based AI intelligence with local browser control, enabling comprehensive automated testing without complex infrastructure requirements.
