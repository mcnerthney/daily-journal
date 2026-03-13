# GitHub CI/CD Setup Guide

## How it works

```
git push main
     │
     ▼
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Job 1      │────▶│  Job 2           │────▶│  Job 3          │
│  Lint/Test  │     │  Build & Push    │     │  Deploy to      │
│             │     │  Docker → GCR    │     │  Cloud Run      │
└─────────────┘     └──────────────────┘     └─────────────────┘

Pull Requests → PR Check workflow (build only, no deploy)
```

---

## Step 1 — Create GitHub repo

```bash
cd journal-app
git init
git add .
git commit -m "Initial commit"
```

Go to https://github.com/new, create a repo, then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/daily-journal.git
git branch -M main
git push -u origin main
```

---

## Step 2 — Create a GCP Service Account for GitHub

GitHub Actions needs a key to authenticate with Google Cloud.

```bash
# Set your project
export PROJECT_ID="your-project-id"

# Create the service account
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions CI/CD" \
  --project=$PROJECT_ID

# Grant required roles
for ROLE in \
  roles/run.admin \
  roles/storage.admin \
  roles/iam.serviceAccountUser \
  roles/secretmanager.secretAccessor \
  roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="$ROLE"
done

# Export the key as JSON
gcloud iam service-accounts keys create github-sa-key.json \
  --iam-account="github-actions@${PROJECT_ID}.iam.gserviceaccount.com"

# Print it (you'll paste this into GitHub)
cat github-sa-key.json
```

⚠️ Delete `github-sa-key.json` after copying — never commit it.

---

## Step 3 — Add GitHub Secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these three secrets:

| Secret name     | Value                                          |
|-----------------|------------------------------------------------|
| `GCP_PROJECT_ID`| Your GCP project ID (e.g. `my-journal-12345`) |
| `GCP_SA_KEY`    | The entire contents of `github-sa-key.json`   |
| `API_URL`       | Your Cloud Run API URL (e.g. `https://journal-api-xxxx-uc.a.run.app`) |
| `SMTP_HOST`     | SMTP server hostname (e.g. `smtp.sendgrid.net`) |
| `SMTP_PORT`     | SMTP port (e.g. `587`)                         |
| `SMTP_SECURE`   | `true` for port 465 TLS, otherwise `false`     |
| `SMTP_USER`     | SMTP login username / API key name             |
| `EMAIL_FROM`    | Sender address (e.g. `no-reply@yourdomain.com`) |

The SMTP password is stored in **GCP Secret Manager** (not GitHub secrets).
Create it once:
```bash
echo -n "your-smtp-password" | \
  gcloud secrets create journal-smtp-pass --data-file=- --project=$PROJECT_ID
```

To find your API URL if already deployed:
```bash
gcloud run services describe journal-api --region us-central1 --format "value(status.url)"
```

---

## Step 4 — Push and watch it deploy

```bash
git add .
git commit -m "Add CI/CD"
git push
```

Go to your repo → **Actions** tab to watch the pipeline run.

On success, the deploy job prints your live URLs in the **Summary** tab.

---

## Day-to-day workflow

### Deploy a change
```bash
git add .
git commit -m "your change"
git push          # triggers full CI/CD pipeline
```

### Open a pull request
PRs trigger the **PR Check** workflow — it builds the project and comments the result on the PR. No deployment happens until you merge to `main`.

### View deployment history
Every run is logged in the **Actions** tab with the commit SHA used for each image tag.

### Roll back to a previous version
```bash
# List recent images
gcloud container images list-tags gcr.io/$PROJECT_ID/journal-api

# Redeploy a specific SHA
gcloud run deploy journal-api \
  --image gcr.io/$PROJECT_ID/journal-api:abc1234 \
  --region us-central1
```

---

## Pipeline overview

| Trigger          | Jobs that run              |
|------------------|----------------------------|
| Push to `main`   | test → build → deploy      |
| Pull Request     | pr-check (build only)      |

### Job details

**test** — installs deps, runs `npm run build`, smoke-tests server imports

**build** — authenticates to GCP, builds both Docker images with `--platform linux/amd64`, tags with the short git SHA (e.g. `:a1b2c3d4`) AND `:latest`, pushes to GCR

**deploy** — deploys the new images to Cloud Run with zero downtime, prints URLs to the job summary

---

## Troubleshooting

**"Permission denied" on GCR push**
→ Make sure `roles/storage.admin` is on the service account, or switch to Artifact Registry (`roles/artifactregistry.writer`).

**"Secret not found" on deploy**
→ Confirm `journal-mongo-uri` exists in Secret Manager and the service account has `roles/secretmanager.secretAccessor`.

**Build passes locally but fails in CI**
→ Check that `npm ci` (not `npm install`) is used — CI uses the lockfile exactly.

**API_URL secret not set yet (first deploy)**
→ Run `./deploy-cloudrun.sh` once manually to get the initial API URL, then add it as the `API_URL` secret.
