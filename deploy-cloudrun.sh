#!/usr/bin/env bash
# =============================================================================
# deploy-cloudrun.sh — Deploy Daily Journal to Google Cloud Run
#
# Prerequisites:
#   1. Google Cloud SDK installed (https://cloud.google.com/sdk/docs/install)
#   2. MongoDB Atlas cluster created with a connection string ready
#   3. Run: gcloud auth login
#
# Usage:
#   chmod +x deploy-cloudrun.sh
#   ./deploy-cloudrun.sh
# =============================================================================

set -euo pipefail

# ── CONFIG — edit these ───────────────────────────────────────────────────────
PROJECT_ID=""           # e.g. "my-journal-123456"
REGION="us-central1"    # Cloud Run region
MONGO_URI=""            # MongoDB Atlas URI, e.g. "mongodb+srv://user:pass@cluster.mongodb.net/daily_journal"
DISABLE_WEBSOCKETS="false" # Set to "true" to force polling-only transport
# ─────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Validate config ───────────────────────────────────────────────────────────
if [[ -z "$PROJECT_ID" ]]; then
  echo -e "${YELLOW}Enter your Google Cloud Project ID:${NC} "
  read -r PROJECT_ID
fi
if [[ -z "$MONGO_URI" ]]; then
  echo -e "${YELLOW}Enter your MongoDB Atlas connection URI:${NC} "
  read -r -s MONGO_URI
  echo ""
fi
[[ -z "$PROJECT_ID" ]] && error "PROJECT_ID is required"
[[ -z "$MONGO_URI"  ]] && error "MONGO_URI is required"

REGISTRY="gcr.io/${PROJECT_ID}"
APP_IMAGE="${REGISTRY}/daily-journal:latest"
APP_SERVICE="daily-journal"

echo ""
echo "============================================="
echo "  Daily Journal → Google Cloud Run"
echo "  Project : $PROJECT_ID"
echo "  Region  : $REGION"
echo "  No WS   : $DISABLE_WEBSOCKETS"
echo "============================================="
echo ""

# ── 1. Set active project ─────────────────────────────────────────────────────
info "Setting active project to $PROJECT_ID..."
gcloud config set project "$PROJECT_ID"

# ── 2. Enable required APIs ───────────────────────────────────────────────────
info "Enabling required Google Cloud APIs (this may take a minute)..."
gcloud services enable \
  run.googleapis.com \
  containerregistry.googleapis.com \
  secretmanager.googleapis.com \
  --quiet
success "APIs enabled"

# ── 3. Store MONGO_URI in Secret Manager ─────────────────────────────────────
info "Storing MongoDB URI in Secret Manager..."
SECRET_NAME="journal-mongo-uri"

# Create or update the secret
if gcloud secrets describe "$SECRET_NAME" --quiet 2>/dev/null; then
  echo -n "$MONGO_URI" | gcloud secrets versions add "$SECRET_NAME" --data-file=-
  info "Secret updated"
else
  echo -n "$MONGO_URI" | gcloud secrets create "$SECRET_NAME" \
    --replication-policy="automatic" \
    --data-file=-
  success "Secret created: $SECRET_NAME"
fi

# ── 4. Grant Cloud Run service account access to Secret Manager ──────────────
info "Granting Secret Manager access to Cloud Run service account..."
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet
success "Secret Manager access granted to $SA"

# ── 5. Build & push app image ─────────────────────────────────────────────────
info "Configuring Docker for GCR..."
gcloud auth configure-docker --quiet

info "Building single app image..."
docker build --platform linux/amd64 \
  --build-arg VITE_DISABLE_WEBSOCKETS="$DISABLE_WEBSOCKETS" \
  -t "$APP_IMAGE" \
  .
info "Pushing app image to GCR..."
docker push "$APP_IMAGE"
success "App image pushed: $APP_IMAGE"

# ── 6. Deploy app to Cloud Run ────────────────────────────────────────────────
info "Deploying app service to Cloud Run..."
gcloud run deploy "$APP_SERVICE" \
  --image "$APP_IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 256Mi \
  --cpu 0.5 \
  --cpu-throttling \
  --concurrency 80 \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 30 \
  --set-env-vars "DISABLE_WEBSOCKETS=${DISABLE_WEBSOCKETS}" \
  --set-secrets "MONGO_URI=${SECRET_NAME}:latest" \
  --quiet


APP_URL=$(gcloud run services describe "$APP_SERVICE" \
  --region "$REGION" \
  --format "value(status.url)")
success "App deployed at: $APP_URL"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "============================================="
echo -e "  ${GREEN}Deployment complete!${NC}"
echo "============================================="
echo "  🌐 App URL : $APP_URL"
echo "  📦 Project : $PROJECT_ID"
echo "  🌍 Region  : $REGION"
echo "============================================="
echo ""
echo "To view logs:"
echo "  gcloud run services logs read $APP_SERVICE --region $REGION"
echo ""
echo "To tear down:"
echo "  gcloud run services delete $APP_SERVICE --region $REGION"
echo ""
