import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://mongo:27017";
const DB_NAME = "daily_journal";

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-change-me";

app.use(cors({ origin: "*" }));
app.use(express.json());

// --- simple JWT auth middleware ------------------------------------------------
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  // Allow the nginx proxy to upgrade connections
  transports: ["websocket", "polling"],
});

// track connected socket counts (globally and per-user)
let connectedClients = 0;
const userClients = {}; // { userId: count }

// require a valid token before allowing socket connection
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  if (!token) return next(new Error("unauthorized"));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.userId = payload.userId;
    return next();
  } catch (err) {
    return next(new Error("unauthorized"));
  }
});

io.on("connection", (socket) => {
  // join a room for this user so broadcasts can be scoped
  if (socket.userId) {
    socket.join(socket.userId);
    userClients[socket.userId] = (userClients[socket.userId] || 0) + 1;
  }

  connectedClients++;
  console.log(`🔌 Client connected [${socket.id}] — ${connectedClients} online`);

  // emit global presence as before, but also per-user
  io.emit("presence:global", { count: connectedClients });
  if (socket.userId) {
    io.to(socket.userId).emit("presence", { count: userClients[socket.userId] });
  }

  socket.on("disconnect", () => {
    connectedClients--;
    if (socket.userId && userClients[socket.userId]) {
      userClients[socket.userId]--;
    }
    console.log(`🔌 Client disconnected [${socket.id}] — ${connectedClients} online`);

    io.emit("presence:global", { count: connectedClients });
    if (socket.userId) {
      io.to(socket.userId).emit("presence", { count: userClients[socket.userId] || 0 });
    }
  });
});

// ── MongoDB connection ────────────────────────────────────────────────────────
let db;

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  // ensure indexes for performance / uniqueness
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("entries").createIndex({ userId: 1, date: 1 }, { unique: true });
  console.log(`✅ Connected to MongoDB at ${MONGO_URI}`);
}

function entries() {
  return db.collection("entries");
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, clients: connectedClients });
});

// ── Authentication routes ────────────────────────────────────────────────────
app.post("/api/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Missing fields" });
    const existing = await db.collection("users").findOne({ email });
    if (existing) return res.status(400).json({ error: "User already exists" });
    const hash = await bcrypt.hash(password, 10);
    await db.collection("users").insertOne({ email, password: hash });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.collection("users").findOne({ email });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "Invalid credentials" });
    const token = jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ── GET /api/entries ──────────────────────────────────────────────────────────
app.get("/api/entries", auth, async (req, res) => {
  try {
    const docs = await entries().find({ userId: req.userId }).toArray();
    const result = {};
    for (const doc of docs) {
      const { _id, date, userId, ...data } = doc;
      result[date] = data;
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load entries" });
  }
});

// ── GET /api/entries/:date ────────────────────────────────────────────────────
app.get("/api/entries/:date", auth, async (req, res) => {
  try {
    const doc = await entries().findOne({ date: req.params.date, userId: req.userId });
    if (!doc) return res.json({});
    const { _id, date, userId, ...data } = doc;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load entry" });
  }
});

// ── PUT /api/entries/:date ────────────────────────────────────────────────────
app.put("/api/entries/:date", auth, async (req, res) => {
  try {
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ error: "Invalid date format" });

    const update = { ...req.body, date, userId: req.userId };
    await entries().updateOne(
      { date, userId: req.userId },
      { $set: update },
      { upsert: true }
    );

    // Notify only that user's sockets
    io.to(req.userId).emit("entry:updated", { date, entry: req.body });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save entry" });
  }
});

// ── DELETE /api/entries/:date ─────────────────────────────────────────────────
app.delete("/api/entries/:date", auth, async (req, res) => {
  try {
    await entries().deleteOne({ date: req.params.date, userId: req.userId });
    io.to(req.userId).emit("entry:deleted", { date: req.params.date });
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
