#!/usr/bin/env bash

set -euo pipefail

# -----------------------------------------------------------------------------
# Benji Cloud Backend deployment to Cloud Run (Docker + gcloud CLI)
# -----------------------------------------------------------------------------
# Required env vars:
#   PROJECT_ID
#   GOOGLE_API_KEY
#   GITHUB_TOKEN
#
# Optional env vars:
#   REGION (default: us-central1)
#   SERVICE_NAME (default: benji-multiagent-backend)
#   REPOSITORY (default: benji-containers)
#   IMAGE_NAME (default: benji-multiagent-backend)
#   GOOGLE_LOCATION (default: global)
#   COMPUTER_USE_MODEL_ID (default: gemini-2.5-computer-use-preview-10-2025)
#   GITHUB_ADK_MCP_MODEL_NAME (default: gemini-2.5-pro)
#   GITHUB_MCP_URL (default: https://api.githubcopilot.com/mcp/)
#   GITHUB_MCP_TOOLSETS (default: context,repos,issues,labels,pull_requests,actions,users,orgs)
#   GITHUB_MCP_READONLY (default: false)
#
# Usage:
#   chmod +x deploy.sh
#   PROJECT_ID="my-gcp-project" GOOGLE_API_KEY="..." GITHUB_TOKEN="..." ./deploy.sh
# -----------------------------------------------------------------------------

REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-benji-multiagent-backend}"
REPOSITORY="${REPOSITORY:-benji-containers}"
IMAGE_NAME="${IMAGE_NAME:-benji-multiagent-backend}"
GOOGLE_LOCATION="${GOOGLE_LOCATION:-global}"
COMPUTER_USE_MODEL_ID="${COMPUTER_USE_MODEL_ID:-gemini-2.5-computer-use-preview-10-2025}"
GITHUB_ADK_MCP_MODEL_NAME="${GITHUB_ADK_MCP_MODEL_NAME:-gemini-2.5-pro}"
GITHUB_MCP_URL="${GITHUB_MCP_URL:-https://api.githubcopilot.com/mcp/}"
GITHUB_MCP_TOOLSETS="${GITHUB_MCP_TOOLSETS:-context,repos,issues,labels,pull_requests,actions,users,orgs}"
GITHUB_MCP_READONLY="${GITHUB_MCP_READONLY:-false}"

if [[ -z "${PROJECT_ID:-}" ]]; then
  echo "❌ Missing PROJECT_ID. Example: PROJECT_ID=my-project ./deploy.sh"
  exit 1
fi

if [[ -z "${GOOGLE_API_KEY:-}" ]]; then
  echo "❌ Missing GOOGLE_API_KEY."
  exit 1
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "❌ Missing GITHUB_TOKEN."
  exit 1
fi

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}:$(date +%Y%m%d-%H%M%S)"

echo "🔐 Configuring gcloud project: ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "🧩 Ensuring required services are enabled..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com >/dev/null

echo "📦 Ensuring Artifact Registry repo exists: ${REPOSITORY}"
if ! gcloud artifacts repositories describe "${REPOSITORY}" --location "${REGION}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${REPOSITORY}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Docker images for Benji Cloud Run backend"
fi

echo "🐳 Building and pushing image: ${IMAGE_URI}"
gcloud builds submit . --tag "${IMAGE_URI}" --project "${PROJECT_ID}"

echo "🚀 Deploying Cloud Run service: ${SERVICE_NAME}"
ENV_VARS="^@^GOOGLE_API_KEY=${GOOGLE_API_KEY}@GOOGLE_CLOUD_PROJECT=${PROJECT_ID}@GOOGLE_LOCATION=${GOOGLE_LOCATION}@COMPUTER_USE_MODEL_ID=${COMPUTER_USE_MODEL_ID}@GITHUB_TOKEN=${GITHUB_TOKEN}@GITHUB_ADK_MCP_MODEL_NAME=${GITHUB_ADK_MCP_MODEL_NAME}@GITHUB_MCP_URL=${GITHUB_MCP_URL}@GITHUB_MCP_TOOLSETS=${GITHUB_MCP_TOOLSETS}@GITHUB_MCP_READONLY=${GITHUB_MCP_READONLY}"

gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_URI}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --port 8080 \
  --timeout 3600 \
  --memory 1Gi \
  --cpu 1 \
  --max-instances 10 \
  --set-env-vars "${ENV_VARS}" \
  --project "${PROJECT_ID}"

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)')"

echo ""
echo "✅ Deployment complete!"
echo "🌐 Cloud Run URL: ${SERVICE_URL}"
echo "🔌 Local Playwright should connect to: ${SERVICE_URL/https:/wss:}"
echo "   Example /playwright socket: ${SERVICE_URL/https:/wss:}/playwright"
