# Run Repo Quickstart

## Fast Path (use deployed Cloud backend)

Backend is already live at:
- `https://benji-multiagent-backend-2lw4x3ccbq-uc.a.run.app`

### 1) Start local Playwright client
```bash
cd /Users/harpita/Web-Dojo/local_client
pip install -r requirements.txt
playwright install chromium
CLOUD_RUN_URL="wss://benji-multiagent-backend-2lw4x3ccbq-uc.a.run.app" python playwright_client.py
```

### 2) Start frontend
```bash
cd /Users/harpita/Web-Dojo/frontend
npm install
NEXT_PUBLIC_BACKEND_HTTP_URL="https://benji-multiagent-backend-2lw4x3ccbq-uc.a.run.app" \
NEXT_PUBLIC_BACKEND_WS_URL="wss://benji-multiagent-backend-2lw4x3ccbq-uc.a.run.app" \
npm run dev
```

Open `http://localhost:3000`.

## Redeploy backend (only when needed)

```bash
cd /Users/harpita/Web-Dojo/cloud_backend
chmod +x deploy.sh
PROJECT_ID="your-gcp-project" GOOGLE_API_KEY="your-google-api-key" GITHUB_TOKEN="your-github-token" ./deploy.sh
```

## Notes
- Keep Playwright client running before pressing **Run** in the UI.
- Rotate exposed keys/tokens if they were pasted into terminal history.
