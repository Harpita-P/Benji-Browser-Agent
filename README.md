# Browser Agent UI

A modern Next.js frontend for the Gemini computer-use browser agent with real-time WebSocket communication.

## Start Here

- Quick run guide: `docs/RUN_REPO_QUICKSTART.md`
- Cloud architecture + deployment: `docs/README_CLOUD_ARCHITECTURE.md`

If you are using the deployed backend, follow `docs/RUN_REPO_QUICKSTART.md` first.

## Architecture

- **Backend**: FastAPI server with WebSocket support (`/cloud_backend`)
- **Frontend**: Next.js 14 with TypeScript and Tailwind CSS (`/frontend`)
- **Communication**: Real-time WebSocket for live updates

## Features

✨ **Three-Panel Interface**
- **Prompt Input**: Natural language task input
- **Live Browser View**: Real-time screenshot streaming
- **Activity Panel**: Agent thinking, actions, and status logs

🔄 **Real-Time Updates**
- Live browser screenshots as the agent works
- Agent reasoning and thought process
- Action execution logs
- Turn-by-turn progress tracking

🎨 **Modern UI**
- Dark theme with gradient accents
- Responsive layout
- Smooth animations
- Auto-scrolling activity log

## Setup Instructions

### Prerequisites

- Python 3.11+
- Node.js 18+
- Google Cloud Project with Vertex AI enabled
- Environment variables:
  - `GOOGLE_CLOUD_PROJECT`: Your GCP project ID
  - `GOOGLE_LOCATION`: GCP region (default: "global")
  - `MODEL_ID`: Gemini model (default: "gemini-2.5-computer-use-preview-10-2025")

### Backend Setup

1. **Navigate to backend directory**
   ```bash
   cd cloud_backend
   ```

2. **Create and activate virtual environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Install Playwright browsers**
   ```bash
   playwright install chromium
   ```

5. **Set environment variables**
   ```bash
   export GOOGLE_CLOUD_PROJECT="your-project-id"
   export GOOGLE_LOCATION="global"
   ```

6. **Run the backend server**
   ```bash
   uvicorn main:app --reload --port 8080
   ```

   The backend will be available at `http://localhost:8080`

### Frontend Setup

1. **Navigate to frontend directory**
   ```bash
   cd frontend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the development server**
   ```bash
   npm run dev
   ```

   The frontend will be available at `http://localhost:3000`

## Usage

1. **Start both servers** (backend on port 8080, frontend on port 3000)

2. **Open the UI** at `http://localhost:3000`

3. **Enter a task** in the prompt input, for example:
   - "Go to google.com and search for AI news"
   - "Navigate to example.com and test the contact form"
   - "Open reddit.com and find the top post in r/technology"

4. **Click Run** to start the agent

5. **Watch the agent work**:
   - Live browser screenshots appear in the center panel
   - Agent thinking and actions appear in the right panel
   - Progress updates show turn number and current URL

6. **Safety prompts**: If the agent requests confirmation for sensitive actions, a browser dialog will appear

## Project Structure

```
Web-Dojo/
├── cloud_backend/
│   ├── main.py              # FastAPI server with WebSocket
│   └── requirements.txt     # Python dependencies
├── docs/
│   ├── RUN_REPO_QUICKSTART.md
│   ├── README_CLOUD_ARCHITECTURE.md
│   ├── ARCHITECTURE_REVIEW.md
│   └── GITHUB_AGENT_WORKFLOW.md
├── frontend/
│   ├── app/
│   │   ├── page.tsx        # Main UI component
│   │   ├── layout.tsx      # Root layout
│   │   └── globals.css     # Global styles
│   ├── package.json        # Node dependencies
│   └── tsconfig.json       # TypeScript config
├── browser_agent.py        # Original standalone agent
└── README.md              # This file
```

## WebSocket Message Types

The backend sends these message types to the frontend:

- `screenshot`: Base64-encoded browser screenshot
- `thinking`: Agent's reasoning/thought process
- `action`: Action being executed
- `status`: General status updates
- `error`: Error messages
- `turn`: Turn number and current URL
- `complete`: Task completion message
- `safety_prompt`: Request for user confirmation

## Customization

### Change Browser Viewport

Edit `cloud_backend/main.py`:
```python
sw, sh = 1440, 1000  # Change width and height
```

### Modify Max Turns

Edit the run loop in `cloud_backend/main.py`:
```python
await run_agent_for_task(page, client, prompt, sw, sh, websocket, max_turns=30)
```

### Customize UI Colors

Edit `frontend/app/globals.css` to change the color scheme.

## Troubleshooting

### Backend won't start
- Ensure `GOOGLE_CLOUD_PROJECT` is set
- Check that you're authenticated with Google Cloud: `gcloud auth application-default login`
- Verify Playwright is installed: `playwright install chromium`

### Frontend can't connect
- Ensure backend is running on port 8080
- Check CORS settings in `cloud_backend/main.py` if using different ports
- Verify WebSocket connection in browser console

### No screenshots appearing
- Check browser console for WebSocket errors
- Ensure the agent is actually running (check activity panel)
- Verify backend logs for screenshot encoding errors

## Development

### Backend Development
```bash
cd cloud_backend
source venv/bin/activate
uvicorn main:app --reload --port 8080
```

### Frontend Development
```bash
cd frontend
npm run dev
```

### Production Build
```bash
cd frontend
npm run build
npm start
```

## License

MIT
