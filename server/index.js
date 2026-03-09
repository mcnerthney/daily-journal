import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { MongoClient } from "mongodb";

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://mongo:27017";
const DB_NAME = "daily_journal";

app.use(cors({ origin: "*" }));
app.use(express.json());

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  // Allow the nginx proxy to upgrade connections
  transports: ["websocket", "polling"],
});

let connectedClients = 0;

io.on("connection", (socket) => {
  connectedClients++;
  console.log(`🔌 Client connected [${socket.id}] — ${connectedClients} online`);
  io.emit("presence", { count: connectedClients });

  socket.on("disconnect", () => {
    connectedClients--;
    console.log(`🔌 Client disconnected [${socket.id}] — ${connectedClients} online`);
    io.emit("presence", { count: connectedClients });
  });
});

// ── MongoDB connection ────────────────────────────────────────────────────────
let db;

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`✅ Connected to MongoDB at ${MONGO_URI}`);
}

function entries() {
  return db.collection("entries");
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, clients: connectedClients });
});

// ── GET /api/entries ──────────────────────────────────────────────────────────
app.get("/api/entries", async (_req, res) => {
  try {
    const docs = await entries().find({}).toArray();
    const result = {};
    for (const doc of docs) {
      const { _id, date, ...data } = doc;
      result[date] = data;
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load entries" });
  }
});

// ── GET /api/entries/:date ────────────────────────────────────────────────────
app.get("/api/entries/:date", async (req, res) => {
  try {
    const doc = await entries().findOne({ date: req.params.date });
    if (!doc) return res.json({});
    const { _id, date, ...data } = doc;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load entry" });
  }
});

// ── PUT /api/entries/:date ────────────────────────────────────────────────────
app.put("/api/entries/:date", async (req, res) => {
  try {
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ error: "Invalid date format" });

    const update = { ...req.body, date };
    await entries().updateOne({ date }, { $set: update }, { upsert: true });

    // Broadcast the change to ALL connected clients
    io.emit("entry:updated", { date, entry: req.body });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save entry" });
  }
});

// ── DELETE /api/entries/:date ─────────────────────────────────────────────────
app.delete("/api/entries/:date", async (req, res) => {
  try {
    await entries().deleteOne({ date: req.params.date });
    io.emit("entry:deleted", { date: req.params.date });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
connectDB()
  .then(() => {
    httpServer.listen(PORT, () => console.log(`🚀 API + WS listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ Could not connect to MongoDB:", err.message);
    process.exit(1);
  });
