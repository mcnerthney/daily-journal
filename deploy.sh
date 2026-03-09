#!/bin/bash
# =============================================================================
#  deploy.sh — Deploy Daily Journal to Google Cloud Run
#  Usage: bash deploy.sh
# =============================================================================

set -e  # Exit on any error

# ── Config (edit these) ──────────────────────────────────────────────────────
PROJECT_ID=""          # Your GCP project ID (e.g. my-project-123456)
REGION="us-central1"   # Cloud Run region
SERVICE_NAME="daily-journal"
IMAGE_NAME="daily-journal"
# ─────────────────────────────────────────────────────────────────────────────

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_step() { echo -e "\n${CYAN}▶ $1${NC}"; }
print_ok()   { echo -e "${GREEN}✓ $1${NC}"; }
print_warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
print_err()  { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ── 1. Preflight checks ──────────────────────────────────────────────────────
print_step "Checking prerequisites..."

command -v gcloud >/dev/null 2>&1 || print_err "gcloud CLI not found. Install from https://cloud.google.com/sdk/docs/install"
command -v docker  >/dev/null 2>&1 || print_err "Docker not found. Install from https://docs.docker.com/get-docker/"

if [ -z "$PROJECT_ID" ]; then
  # Try to read from gcloud config
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
  if [ -z "$PROJECT_ID" ]; then
    echo -e "${YELLOW}No PROJECT_ID set. Enter your GCP Project ID:${NC}"
    read -rp "> " PROJECT_ID
    [ -z "$PROJECT_ID" ] && print_err "PROJECT_ID is required."
  fi
fi

print_ok "Project: $PROJECT_ID"
print_ok "Region:  $REGION"
print_ok "Service: $SERVICE_NAME"

# ── 2. Auth & project ────────────────────────────────────────────────────────
print_step "Setting active GCP project..."
gcloud config set project "$PROJECT_ID"

print_step "Authenticating Docker with GCP Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ── 3. Enable required APIs ──────────────────────────────────────────────────
print_step "Enabling required GCP APIs (may take a minute)..."
gcloud services enable \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  --quiet
print_ok "APIs enabled"

# ── 4. Create Artifact Registry repository ───────────────────────────────────
print_step "Creating Artifact Registry repository (if not exists)..."
gcloud artifacts repositories create "$IMAGE_NAME" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Daily Journal app images" \
  --quiet 2>/dev/null || print_warn "Repository already exists — continuing"

# ── 5. Build & push image ────────────────────────────────────────────────────
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${IMAGE_NAME}/${IMAGE_NAME}:latest"

print_step "Building Docker image for linux/amd64 and pushing..."
docker buildx build \
  --platform linux/amd64 \
  --push \
  -t "$IMAGE_URI" .
print_ok "Image built and pushed: $IMAGE_URI"

# ── 6. Deploy to Cloud Run ───────────────────────────────────────────────────
print_step "Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE_URI" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 256Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --quiet

# ── 7. Get the URL ───────────────────────────────────────────────────────────
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --format "value(status.url)")

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓ Deployment complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  🌐 URL: ${CYAN}${SERVICE_URL}${NC}"
echo -e "  📍 Region: ${REGION}"
echo -e "  🐳 Image: ${IMAGE_URI}"
echo ""
echo -e "  To redeploy after changes, just run this script again."
echo -e "  To delete the service: ${YELLOW}gcloud run services delete $SERVICE_NAME --region $REGION${NC}"
echo ""
