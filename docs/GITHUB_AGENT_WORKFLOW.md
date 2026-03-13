# GitHub Code Fixing Agent - Workflow Documentation

## Overview

Benji can now analyze your Computer Use Agent (CUA) testing sessions and automatically suggest code fixes using GitHub MCP ADK integration.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  1. Computer Use Agent (CUA) Tests UI                       │
│     - Clicks, types, navigates                              │
│     - Logs all actions + thinking                           │
│     - Stores in session logs                                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  2. User Clicks "Analyze & Fix Bugs"                        │
│     - Provides GitHub repo owner/name                       │
│     - Sends session_id to backend                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  3. GitHub Code Fixing Agent (Gemini + GitHub MCP)          │
│     - Analyzes session logs                                 │
│     - Reasons about potential bugs                          │
│     - Searches GitHub repo for relevant files               │
│     - Reads code to find exact bug location                 │
│     - Suggests precise code fixes                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  4. Results Displayed to User                               │
│     - Root cause analysis                                   │
│     - File paths and line numbers                           │
│     - Current vs fixed code                                 │
│     - Explanation of the fix                                │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Install Dependencies

```bash
cd cloud_backend
pip install -r requirements.txt
```

### 2. Configure GitHub Token

Get a GitHub Personal Access Token with repo access:
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate new token (classic)
3. Select scopes: `repo`, `read:org`
4. Copy the token

Add to `.env`:
```bash
GITHUB_TOKEN=ghp_your_token_here
```

### 3. Start the Backend

```bash
cd cloud_backend
uvicorn main:app --reload --port 8080
```

## Usage Workflow

### Step 1: Run a CUA Test

1. Start frontend: `cd frontend && npm run dev`
2. Start Playwright client: `cd local_client && python playwright_client.py`
3. Enter your prompt (e.g., "Create a new task called 'Test Task'")
4. Let the CUA agent run and complete the test
5. Note the session ID (automatically captured)

### Step 2: Analyze for Bugs

1. Click the **"Analyze & Fix Bugs"** button in the header
2. Enter your GitHub repository owner (e.g., `username`)
3. Enter your GitHub repository name (e.g., `my-app`)
4. Wait for analysis (this may take 30-60 seconds)

### Step 3: Review Results

The agent will:
- Analyze what the CUA agent was trying to do
- Identify potential bugs based on UI behavior
- Search your GitHub repo for relevant files
- Read and analyze the code
- Suggest specific fixes with:
  - File paths and line numbers
  - Current buggy code
  - Fixed code
  - Root cause explanation

## Session Logs

Session logs capture:
- **Prompt**: Initial user request
- **Thinking**: Agent's reasoning at each step
- **Actions**: Function calls (click_at, type_text_at, etc.)
- **Turn numbers**: Sequence of agent turns
- **Timestamps**: When each action occurred

Example log entry:
```json
{
  "type": "action",
  "function": "click_at",
  "args": {"x": 500, "y": 300},
  "turn": 3,
  "timestamp": "1234567890.123"
}
```

## API Endpoints

### POST `/analyze-bugs`

Analyze session logs and suggest code fixes.

**Request:**
```json
{
  "session_id": "uuid-here",
  "repo_owner": "username",
  "repo_name": "my-app",
  "app_url": "http://localhost:3000"
}
```

**Response:**
```json
{
  "status": "success",
  "analysis": "Detailed analysis...",
  "suggested_fixes": [...],
  "root_cause": "Explanation...",
  "agent_response": {...}
}
```

### GET `/sessions`

List all available session IDs.

**Response:**
```json
{
  "sessions": [
    {
      "session_id": "uuid-1",
      "log_count": 15,
      "first_log": {...}
    }
  ]
}
```

## GitHub MCP Integration

The agent uses Google ADK's MCP (Model Context Protocol) toolset to interact with GitHub:

- **Search repositories**: Find files related to UI components
- **Read files**: Analyze code to locate bugs
- **Create issues**: Document bugs (future feature)
- **Create PRs**: Submit fixes (future feature)

## Example Session

1. **CUA Test**: "Create a task with priority 'High'"
2. **Session Logs**:
   - Turn 1: Navigate to tasks page
   - Turn 2: Click "New Task" button
   - Turn 3: Type task name
   - Turn 4: Select priority dropdown
   - Turn 5: Click "High" option
   - Turn 6: Save task

3. **Bug Analysis**:
   - Agent notices priority wasn't set correctly
   - Searches for `TaskForm.tsx` or similar
   - Finds priority selection logic
   - Identifies bug: priority value not being saved
   - Suggests fix: Add `onChange` handler

## Troubleshooting

### "Session not found"
- Make sure you ran a CUA test first
- Check that the session ID was captured (look for "session_id" message)

### "GITHUB_TOKEN not set"
- Add your GitHub token to `.env` file
- Restart the backend

### "Analysis failed"
- Check GitHub token has correct permissions
- Verify repo owner/name are correct
- Check backend logs for detailed error

## Future Enhancements

- [ ] Automatic PR creation with fixes
- [ ] Multi-file bug analysis
- [ ] Integration with CI/CD pipelines
- [ ] Bug severity classification
- [ ] Automated testing of fixes
- [ ] Support for multiple GitHub repos
- [ ] Visual diff viewer in frontend
