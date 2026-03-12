#!/bin/bash

# Deploy to Google Cloud Run
# Make sure you're authenticated: gcloud auth login

PROJECT_ID="your-project-id"
REGION="us-central1"
SERVICE_NAME="benji-agent"

echo "🚀 Deploying Benji Agent Brain to Cloud Run..."

gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_API_KEY=$GOOGLE_API_KEY \
  --set-env-vars GOOGLE_CLOUD_PROJECT=$PROJECT_ID \
  --set-env-vars GOOGLE_LOCATION=$REGION \
  --set-env-vars MODEL_ID=gemini-2.0-flash-exp \
  --memory 512Mi \
  --timeout 3600 \
  --max-instances 10

echo "✅ Deployment complete!"
echo "📝 Update CLOUD_RUN_URL in local_client/playwright_client.py with the service URL"
