# 📓 Daily Journal

A personal daily tracking app for mood, medication, nutrition, hygiene, and house cleaning.
Data is stored in **MongoDB** — persists forever, across browsers and devices.

## Architecture

```
Browser → Node/Express (port 3000)
             ├── /         → React static files
             ├── /api/*    → Express API
             └── /socket.io/* → Socket.IO realtime
                                └── MongoDB (port 27017, internal only)
```

## Quick Start

Requires Docker and Docker Compose.

_⚠️ After updating, the server now depends on `bcryptjs` and `jsonwebtoken`. If running locally or rebuilding, make sure to reinstall packages (`cd server && npm install`)._

```bash
docker compose up --build
```

Then open **http://localhost:3000**

That's it. MongoDB data is stored in a named Docker volume (`mongo_data`) so it survives restarts.

## Cloud Run Deployment

Cloud Run now uses a **single service** that runs the merged container:

- Serves the React app
- Handles `/api/*`
- Handles `/socket.io/*`

Use the deployment script:

```bash
chmod +x deploy-cloudrun.sh
./deploy-cloudrun.sh
```

The script builds and pushes one image (`gcr.io/<project>/daily-journal:latest`) and deploys one Cloud Run service (`daily-journal`).

For full setup details (Atlas, IAM, troubleshooting), see `DEPLOY_CLOUDRUN.md`.

## REST API (authentication required)

The journal now supports per-user auth; all `/api/entries` routes require a **Bearer** token obtained via login.

| Method | Path                  | Description              |
|--------|-----------------------|--------------------------|
| POST   | /api/register         | Create a new user (email/password) |
| POST   | /api/login            | Obtain JWT token by credentials |
| POST   | /api/password-reset/request | Request password reset email |
| POST   | /api/password-reset/confirm | Reset password with token |
| GET    | /api/health           | Health check (no auth)   |
| GET    | /api/entries          | All entries for logged‑in user |
| GET    | /api/entries/:date    | Single day entry for user |
| PUT    | /api/entries/:date    | Create / update a day    |
| DELETE | /api/entries/:date    | Delete a day             |

# Lists API
| Method | Path                   | Description                            |
|--------|------------------------|----------------------------------------|
| GET    | /api/lists             | Fetch all lists owned or shared        |
| POST   | /api/lists             | Create a new checklist (name, items, optional sharing, public flag) |
| PUT    | /api/lists/:id         | Update a list's name/items/sharing/public flag |
| POST   | /api/lists/:id/items   | Create a first-class item inside a list |
| PATCH  | /api/lists/:id/items/:itemId | Update a single item's text or completion state |
| DELETE | /api/lists/:id/items/:itemId | Remove a single item from a list |
| PUT    | /api/lists/:id/items/reorder | Reorder a list by item id |
| POST   | /api/lists/:id/items/:itemId/transfer | Share an item into another list or copy it into a new item |
| DELETE | /api/lists/:id         | Remove a list (owner only)             |
| GET    | /api/public/:publicId  | Read-only access to a public list (no auth) |

Dates use `YYYY-MM-DD` format.

> **Existing data notice:** After enabling auth, only entries with a `userId` field are returned. You can migrate old documents by updating them in Mongo (e.g. `db.entries.updateMany({}, { $set: { userId: "<someId>" } })`) or simply start fresh per user.

For authenticated endpoints include `Authorization: Bearer <token>` header.

## Email Configuration

To enable real emails for password reset, set these server environment variables:

- `APP_BASE_URL` (example `http://localhost:3000`)
- `EMAIL_FROM`
- `SMTP_HOST`
- `SMTP_PORT` (defaults to `587`)
- `SMTP_SECURE` (`true` or `false`)
- `SMTP_USER`
- `SMTP_PASS`

If SMTP variables are not set, the server logs email links to stdout as a development preview.

## Deploy Without WebSockets

Realtime now defaults to polling-only mode (no WebSocket transport).

- Server runtime env: `DISABLE_WEBSOCKETS=true` (default)
- Frontend build env: `VITE_DISABLE_WEBSOCKETS=true` (default)

For Docker Compose:

```bash
DISABLE_WEBSOCKETS=true docker compose up --build
```

This keeps live updates enabled using Socket.IO long-polling, while avoiding WebSocket transport entirely.

To re-enable WebSockets, set both env vars to `false`.

## Development (no Docker)

Start MongoDB locally, then:

```bash
# Terminal 1 — backend
cd server && npm install && MONGO_URI=mongodb://localhost:27017 npm run dev

# Terminal 2 — frontend
npm install && npm run dev
```

## Features

- **Daily Journal** — track mood, medications, workouts, blood pressure, and more.
- **Lists** — create, share, and collaborate on multiple checklists across users. Items sync live with collaborators; owners can invite others by email, who will receive access automatically. Lists may be marked **public**; anyone with the URL can view the checklist without signing in.


| Section    | What it tracks                                          |
|------------|---------------------------------------------------------|
| 💭 Mood    | 5-level emoji scale                                     |
| 💊 Meds    | Morning/evening/vitamins/supplements + custom entries   |
| 🥗 Food    | Meals, water, free-text food notes                      |
| 🚿 Hygiene | Teeth AM/PM, bath/shower, skincare                      |
| 🏠 Cleaning| Dishes, laundry, vacuum, trash, surfaces, bathroom      |
| 📝 Notes   | Free-form daily journal entry                           |
| 🏋️ Workouts | Pull‑ups, squats, push‑ups                              |

- Real-time **save indicator** (Saving… / ✓ Saved / Save failed)
- **Wellness score** bar (journal only) updated live
- **History tab** shows all past entries

## List Feature
Users can create any number of checklists (e.g. groceries, packing, goals) via the “Lists” feature on the home screen. Each list has:

- A name and arbitrary items.
- First-class items with stable ids, so an item can be shared into another list or copied as a new item.
- Real‑time updates: when one user adds/removes items, all collaborators see the change instantly.
- Optional sharing: owners can invite others by supplying their email addresses; those users receive read/write access and will see the list in their sidebar.
- **Public flag**: owners may toggle a list public. Public lists get a unique random URL (`/lists/public/<id>`) and are readable by anyone (no authentication required); only the owner can make a list public or private.
- Ownership rules: only the creator may rename or delete a list; collaborators can modify items but not sharing settings.

New shared lists appear automatically for invitees upon login; public lists can be bookmarked or shared widely without requiring login.
