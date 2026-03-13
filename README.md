# 📓 Daily Journal

A personal daily tracking app for mood, medication, nutrition, hygiene, and house cleaning.
Data is stored in **MongoDB** — persists forever, across browsers and devices.

## Architecture

```
Browser → nginx (port 3000)
             ├── /         → React static files
             └── /api/*    → Express API (port 4000)
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

## REST API (authentication required)

The journal now supports per-user auth; all `/api/entries` routes require a **Bearer** token obtained via login.

| Method | Path                  | Description              |
|--------|-----------------------|--------------------------|
| POST   | /api/register         | Create a new user (email/password) |
| POST   | /api/verify-email     | Verify a registration token |
| POST   | /api/verify-email/request | Resend verification email |
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
| DELETE | /api/lists/:id         | Remove a list (owner only)             |
| GET    | /api/public/:publicId  | Read-only access to a public list (no auth) |

Dates use `YYYY-MM-DD` format.

> **Existing data notice:** After enabling auth, only entries with a `userId` field are returned. You can migrate old documents by updating them in Mongo (e.g. `db.entries.updateMany({}, { $set: { userId: "<someId>" } })`) or simply start fresh per user.

For authenticated endpoints include `Authorization: Bearer <token>` header.

## Email Configuration

To enable real emails for verification and password reset, set these server environment variables:

- `APP_BASE_URL` (example `http://localhost:3000`)
- `EMAIL_FROM`
- `SMTP_HOST`
- `SMTP_PORT` (defaults to `587`)
- `SMTP_SECURE` (`true` or `false`)
- `SMTP_USER`
- `SMTP_PASS`

If SMTP variables are not set, the server logs email links to stdout as a development preview.
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
- Real‑time updates: when one user adds/removes items, all collaborators see the change instantly.
- Optional sharing: owners can invite others by supplying their email addresses; those users receive read/write access and will see the list in their sidebar.
- **Public flag**: owners may toggle a list public. Public lists get a unique random URL (`/lists/public/<id>`) and are readable by anyone (no authentication required); only the owner can make a list public or private.
- Ownership rules: only the creator may rename or delete a list; collaborators can modify items but not sharing settings.

New shared lists appear automatically for invitees upon login; public lists can be bookmarked or shared widely without requiring login.
