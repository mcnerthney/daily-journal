# Deploying Daily Journal to Google Cloud Run

## Architecture

```
User → Cloud Run (daily-journal)  ← Node/Express serves React + /api + /socket.io
         ↓
      MongoDB Atlas               ← Free M0 cluster (cloud-hosted)
```

The Cloud Run service **scales to zero** when not in use, so you pay nothing while idle.

---

## Cost Estimate

| Service            | Free tier                          | ~Monthly if used daily |
|--------------------|------------------------------------|------------------------|
| Cloud Run (app)    | 2M requests/month free             | $0–4                   |
| Artifact Registry  | 0.5 GB free                        | $0                     |
| Secret Manager     | 6 secret versions free             | $0                     |
| MongoDB Atlas M0   | Free forever (512 MB)              | $0                     |
| **Total**          |                                    | **~$0–4/month**        |

---

## Step 1 — Set Up MongoDB Atlas

1. Go to https://cloud.mongodb.com and create a free account
2. Create a new **free M0 cluster** (any region)
3. Under **Database Access** → Add a database user:
   - Username: `journaluser`
   - Password: (generate a strong one, save it)
   - Role: `readWriteAnyDatabase`
4. Under **Network Access** → Add IP Address → **Allow access from anywhere** (`0.0.0.0/0`)
   - Cloud Run IPs are dynamic, so this is required
5. Click **Connect** on your cluster → **Connect your application**
   - Driver: Node.js
   - Copy the URI — it looks like:
     ```
     mongodb+srv://journaluser:PASSWORD@cluster0.xxxxx.mongodb.net/daily_journal
     ```
   - Replace `<password>` with your actual password

---

## Step 2 — Set Up Google Cloud

1. Go to https://console.cloud.google.com
2. Create a new project (or use an existing one)
3. Note your **Project ID** (shown in the top bar)
4. Make sure **billing is enabled** on the project
   - Cloud Run requires billing even for free-tier usage

---

## Step 3 — Install & Authenticate gcloud CLI

```bash
# Install: https://cloud.google.com/sdk/docs/install
# Then:
gcloud auth login
gcloud auth configure-docker
```

---

## Step 4 — Deploy

Open `deploy-cloudrun.sh` and fill in the two variables at the top:

```bash
PROJECT_ID="your-project-id-here"
MONGO_URI="mongodb+srv://journaluser:password@cluster0.xxxxx.mongodb.net/daily_journal"
DISABLE_WEBSOCKETS="true"
```

Polling-only realtime (no WebSocket transport) is the default. Set `DISABLE_WEBSOCKETS="false"` only if you want WebSocket transport enabled.

Then run:

```bash
chmod +x deploy-cloudrun.sh
./deploy-cloudrun.sh
```

The script will:
1. Enable required Google Cloud APIs
2. Store your MongoDB URI securely in **Secret Manager**
3. Build and push the single app Docker image to **Container Registry**
4. Deploy the app to **Cloud Run**
5. Print your live URL

Total time: ~5–8 minutes.

---

## Step 5 — Access Your App

At the end of the script you'll see:

```
🌐 App URL : https://daily-journal-xxxx-uc.a.run.app
```

Open the App URL in your browser. Done!

---

## Useful Commands

```bash
# View live logs
gcloud run services logs read daily-journal --region us-central1

# Redeploy after code changes
./deploy-cloudrun.sh

# List running services
gcloud run services list

# Tear everything down
gcloud run services delete daily-journal --region us-central1
```

---

## Re-deploying After Code Changes

Just re-run `./deploy-cloudrun.sh`. It will rebuild the image, push it,
and update the Cloud Run service with zero downtime.

---

## Custom Domain (Optional)

1. In Google Cloud Console → Cloud Run → your service → **Custom Domains**
2. Add your domain and follow the DNS verification steps
3. Google provisions a free TLS certificate automatically

---

## Troubleshooting

**"Permission denied" on Secret Manager**
→ Make sure your Cloud Run service account has the `Secret Manager Secret Accessor` role:
```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**App returns 502**
→ MongoDB Atlas Network Access — ensure `0.0.0.0/0` is whitelisted.

**"Billing account not configured"**
→ Go to https://console.cloud.google.com/billing and link a billing account to your project.
