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
API_IMAGE="${REGISTRY}/journal-api:latest"
WEB_IMAGE="${REGISTRY}/journal-web:latest"
API_SERVICE="journal-api"
WEB_SERVICE="journal-web"

echo ""
echo "============================================="
echo "  Daily Journal → Google Cloud Run"
echo "  Project : $PROJECT_ID"
echo "  Region  : $REGION"
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

# ── 5. Build & push API image ─────────────────────────────────────────────────
info "Configuring Docker for GCR..."
gcloud auth configure-docker --quiet

info "Building API image..."
docker build --platform linux/amd64 -t "$API_IMAGE" ./server
info "Pushing API image to GCR..."
docker push "$API_IMAGE"
success "API image pushed: $API_IMAGE"

# ── 6. Deploy API to Cloud Run ────────────────────────────────────────────────
info "Deploying API service to Cloud Run..."
gcloud run deploy "$API_SERVICE" \
  --image "$API_IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 4000 \
  --memory 256Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 5 \
  --set-secrets "MONGO_URI=${SECRET_NAME}:latest" \
  --quiet

API_URL=$(gcloud run services describe "$API_SERVICE" \
  --region "$REGION" \
  --format "value(status.url)")
success "API deployed at: $API_URL"

# ── 7. Build frontend with API URL baked into nginx proxy ────────────────────
info "Building frontend image (with API_URL=$API_URL)..."

# Write a temporary nginx.conf that points to the real Cloud Run API URL
ESCAPED_URL=$(echo "$API_URL" | sed 's|/|\\/|g')
sed "s|http://api:4000|${API_URL}|g" nginx.conf > /tmp/nginx-cloudrun.conf

docker build --platform linux/amd64 \
  --build-arg API_URL="$API_URL" \
  -t "$WEB_IMAGE" \
  -f Dockerfile.cloudrun \
  . 2>/dev/null || {
    # Fallback: build with the generated nginx config
    cp /tmp/nginx-cloudrun.conf nginx.conf.cloudrun
    docker build --platform linux/amd64 -t "$WEB_IMAGE" \
      --build-arg VITE_API_URL="$API_URL" \
      .
    rm nginx.conf.cloudrun
  }

info "Pushing frontend image to GCR..."
docker push "$WEB_IMAGE"
success "Frontend image pushed: $WEB_IMAGE"

# ── 8. Deploy frontend to Cloud Run ──────────────────────────────────────────
info "Deploying frontend service to Cloud Run..."
gcloud run deploy "$WEB_SERVICE" \
  --image "$WEB_IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 256Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 5 \
  --set-env-vars "API_URL=$API_URL" \
  --quiet

WEB_URL=$(gcloud run services describe "$WEB_SERVICE" \
  --region "$REGION" \
  --format "value(status.url)")

success "Frontend deployed at: $WEB_URL"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "============================================="
echo -e "  ${GREEN}Deployment complete!${NC}"
echo "============================================="
echo "  🌐 App URL : $WEB_URL"
echo "  🔌 API URL : $API_URL"
echo "  📦 Project : $PROJECT_ID"
echo "  🌍 Region  : $REGION"
echo "============================================="
echo ""
echo "To view logs:"
echo "  gcloud run services logs read $WEB_SERVICE --region $REGION"
echo "  gcloud run services logs read $API_SERVICE --region $REGION"
echo ""
echo "To tear down:"
echo "  gcloud run services delete $WEB_SERVICE --region $REGION"
echo "  gcloud run services delete $API_SERVICE --region $REGION"
echo ""
