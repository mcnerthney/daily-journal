# Daily Journal – Android Mobile App

An Android companion app for the Daily Journal web app.  
It embeds Node.js (via **nodejs-mobile-react-native**) to run the Express API
directly on the phone, stores data locally in a JSON file powered by **lowdb**,
and lets the user push/pull changes to the remote server with a single **Sync
Now** button.

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│  Android App  (React Native)                                 │
│                                                              │
│   App.jsx ──── JournalScreen.jsx                             │
│                     │                                        │
│                 SyncButton.jsx ──── syncManager.js           │
│                     │                    │                   │
│            localApi.js (port 4001)   remoteApi.js            │
│                     │                    │                   │
│       ┌─────────────▼────────────┐   Remote Server          │
│       │  nodejs-mobile thread    │   (existing Express +     │
│       │  Express on :4001        │    MongoDB backend)       │
│       │  lowdb  →  journal.db    │                           │
│       │  .json (device storage)  │                           │
│       └──────────────────────────┘                           │
└──────────────────────────────────────────────────────────────┘
```

### Data flow

| Action | Direction |
|--------|-----------|
| Write entry locally | RN → `PUT localhost:4001/api/entries/:date` |
| Read entries locally | RN → `GET localhost:4001/api/entries` |
| Sync Now (push) | RN → `GET localhost:4001/api/sync/pending`, then `PUT remote/api/entries/:date` per entry |
| Sync Now (pull) | RN → `GET remote/api/entries`, then `POST localhost:4001/api/sync/apply` |

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18 |
| React Native CLI | 0.73 |
| Android Studio | Hedgehog or later |
| JDK | 17 |
| Android SDK | API 33+ |

---

## Setup

### 1. Initialize the React Native project

The `mobile/` folder contains the full React Native project source.
Bootstrap it with the React Native CLI (do **not** use `npx react-native init`
again – the source files are already here):

```bash
cd mobile
npm install
```

### 2. Install the on-device Node.js dependencies

```bash
cd mobile/nodejs-assets/nodejs-project
npm install
cd ../../..
```

> **Why?**  
> `nodejs-mobile-react-native` bundles the entire `nodejs-assets/nodejs-project`
> folder into the APK.  All `node_modules` for the on-device server must be
> installed here **before** building.  They are deliberately pure-JS packages
> (lowdb, bcryptjs, jsonwebtoken, express, cors) so no native cross-compilation
> is needed.

### 3. Link nodejs-mobile-react-native (Android)

Add to `mobile/android/app/build.gradle`:

```gradle
dependencies {
    // ... existing deps ...
    implementation project(':nodejs-mobile-react-native')
}
```

Add to `mobile/android/settings.gradle`:

```gradle
include ':nodejs-mobile-react-native'
project(':nodejs-mobile-react-native').projectDir =
    new File(rootProject.projectDir, '../node_modules/nodejs-mobile-react-native/android')
```

Run auto-linking (React Native 0.60+):

```bash
cd mobile
npx react-native link nodejs-mobile-react-native
```

### 4. Configure the remote server URL

Edit `mobile/src/api/remoteApi.js` and set `REMOTE_BASE_URL` to your server's
address:

```js
// For local development (server + phone on the same WiFi):
export const REMOTE_BASE_URL = 'http://192.168.1.100:4000';

// For production (Cloud Run / any HTTPS endpoint):
export const REMOTE_BASE_URL = 'https://your-app.run.app';
```

### 5. Add the INTERNET permission (Android)

Ensure `mobile/android/app/src/main/AndroidManifest.xml` contains:

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

### 6. Build & run

```bash
cd mobile
npx react-native run-android
```

---

## How sync works

### Manual sync (Sync Now button)

1. **Push** – Reads all local entries with `synced = 0` from the on-device DB
   and uploads each one via `PUT /api/entries/:date` to the remote server.
2. **Pull** – Fetches all entries from the remote server and writes them into
   the local DB, marking them as `synced = 1`.
3. Records the sync timestamp in the local DB so the next sync can be
   incremental (future enhancement).

Conflict resolution uses **last-write-wins**: local writes always go up first,
then the full remote state comes down.  Any entry modified locally after a pull
will have `synced = 0` again and will be re-uploaded on the next sync.

### Offline behaviour

All reads and writes go to the on-device Express server (`localhost:4001`).
No network connection is required to use the app.  The Sync Now button is the
only action that requires connectivity.

---

## File structure

```
mobile/
├── App.jsx                          # Root component; starts nodejs-mobile, manages auth
├── index.js                         # RN entry point
├── app.json
├── babel.config.js
├── metro.config.js
├── package.json
│
├── src/
│   ├── api/
│   │   ├── localApi.js              # HTTP client → localhost:4001
│   │   └── remoteApi.js             # HTTP client → remote server
│   ├── sync/
│   │   └── syncManager.js           # Push + pull sync logic
│   ├── components/
│   │   └── SyncButton.jsx           # "Sync Now" button with progress log
│   └── screens/
│       └── JournalScreen.jsx        # Main journal UI (offline-first)
│
└── nodejs-assets/
    └── nodejs-project/
        ├── index.js                 # On-device Express server (port 4001)
        ├── package.json
        └── db/
            └── database.js          # lowdb wrapper (users, entries, sync meta)
```

---

## Extending to AbstractThreadedSyncAdapter

For deeper Android OS integration (e.g., background sync triggered by the OS
when connectivity is restored), you can implement an Android
`AbstractThreadedSyncAdapter` in Kotlin/Java and call the same REST endpoints.
The bridge between the adapter and the React Native layer can use:

- `Intent` broadcasts – native code fires a broadcast that RN listens for via
  `NativeEventEmitter`.
- `ContentProvider` – expose entries as a ContentProvider backed by a local
  SQLite database and let the SyncAdapter read/write via cursors.

A scaffold `SyncAdapter.kt` would look like:

```kotlin
class JournalSyncAdapter(context: Context, autoInitialize: Boolean) :
    AbstractThreadedSyncAdapter(context, autoInitialize) {

    override fun onPerformSync(
        account: Account,
        extras: Bundle,
        authority: String,
        provider: ContentProviderClient,
        syncResult: SyncResult
    ) {
        val token = AccountManager.get(context).getAuthToken(account) ?: return
        // Call the same REST endpoints as syncManager.js
        pushPendingEntries(token, syncResult)
        pullRemoteEntries(token, syncResult)
    }
}
```

The current implementation intentionally uses a manual sync button (simpler,
no account-manager overhead) but the REST API contract is identical, so
swapping in an `AbstractThreadedSyncAdapter` later requires no server changes.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "On-device server did not start within 15 s" | Confirm `nodejs-mobile-react-native` is linked and `nodejs-assets` is in the APK via `adb shell find /data/app -name "index.js"`. |
| `ECONNREFUSED 127.0.0.1:4001` | The Node.js process crashed.  Check logcat: `adb logcat -s ReactNativeJS nodejs-mobile`. |
| lowdb write errors | Check that `DATA_DIR` points to a writable path.  On Android, `/data/data/<pkg>/files` is always writable. |
| Sync push 401 from remote | The remote token has expired.  Sign in again via App.jsx → Remote Account. |
| Pure-JS deps not found | Run `npm install` inside `nodejs-assets/nodejs-project/` and rebuild the APK. |
