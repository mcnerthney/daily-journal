import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import nodemailer from "nodemailer";

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://mongo:27017";
const DB_NAME = "daily_journal";

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-change-me";
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";
const EMAIL_FROM = process.env.EMAIL_FROM || "no-reply@daily-journal.local";
const PASSWORD_RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30);

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";

let mailTransporter = null;

app.use(cors({ origin: "*" }));
app.use(express.json());

function normalizeEmail(email = "") {
  return email.trim().toLowerCase();
}

function generateRawToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function tokenExpiryDate(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function buildClientUrl(paramName, token) {
  const url = new URL(APP_BASE_URL);
  url.searchParams.set(paramName, token);
  return url.toString();
}

async function sendEmail({ to, subject, text, html }) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log("📧 Email preview (SMTP not configured)");
    console.log({ to, subject, text });
    return { delivered: false, preview: true };
  }

  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }

  await mailTransporter.sendMail({
    from: EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });
  return { delivered: true, preview: false };
}

async function sendPasswordResetEmail(email, rawToken) {
  const resetUrl = buildClientUrl("resetToken", rawToken);
  return sendEmail({
    to: email,
    subject: "Reset your Notebook password",
    text: `You can reset your password by opening this link: ${resetUrl}`,
    html: `<p>You requested a password reset.</p><p>Reset it by clicking <a href="${resetUrl}">this link</a>.</p>`,
  });
}

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

// allow unauthenticated sockets for public list viewers; auth sockets still join user rooms
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.userId = payload.userId;
    return next();
  } catch (err) {
    return next();
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

  // public list guests subscribe to rooms keyed by public id and/or slug
  socket.on("public-list:subscribe", ({ publicId, publicSlug }) => {
    if (publicId) socket.join(`public-list:id:${publicId}`);
    if (publicSlug) socket.join(`public-list:slug:${publicSlug}`);
  });

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
  // lists indexed by owner and sharedWith for fast lookup
  await db.collection("lists").createIndex({ owner: 1 });
  await db.collection("lists").createIndex({ sharedWith: 1 });
  // unique id for public access
  await db.collection("lists").createIndex({ publicId: 1 }, { unique: true, sparse: true });
  await db.collection("lists").createIndex({ publicSlug: 1 }, { unique: true, sparse: true });

  console.log(`✅ Connected to MongoDB at ${MONGO_URI}`);
}

function entries() {
  return db.collection("entries");
}

function lists() {
  return db.collection("lists");
}

function slugifyListName(name = "") {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "list";
}

async function generateUniquePublicSlug(name, excludeId = null) {
  const base = slugifyListName(name);
  let candidate = base;
  let i = 2;

  while (true) {
    const existing = await lists().findOne({ publicSlug: candidate });
    if (!existing || (excludeId && existing._id.toString() === excludeId.toString())) {
      return candidate;
    }
    candidate = `${base}-${i}`;
    i += 1;
  }
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, clients: connectedClients });
});

// ── Authentication routes ────────────────────────────────────────────────────
app.post("/api/register", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Missing fields" });
    const existing = await db.collection("users").findOne({ email });
    if (existing) return res.status(400).json({ error: "User already exists" });

    const hash = await bcrypt.hash(password, 10);
    await db.collection("users").insertOne({
      email,
      password: hash,
      createdAt: new Date(),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/password-reset/request", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ error: "Missing email" });

    const user = await db.collection("users").findOne({ email });
    if (!user) return res.json({ ok: true });

    const resetToken = generateRawToken();
    await db.collection("users").updateOne(
      { _id: user._id },
      {
        $set: {
          passwordResetTokenHash: hashToken(resetToken),
          passwordResetExpiresAt: tokenExpiryDate(PASSWORD_RESET_TTL_MINUTES),
        },
      }
    );

    await sendPasswordResetEmail(email, resetToken);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not process reset request" });
  }
});

app.post("/api/password-reset/confirm", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: "Missing fields" });

    const user = await db.collection("users").findOne({
      passwordResetTokenHash: hashToken(token),
      passwordResetExpiresAt: { $gt: new Date() },
    });

    if (!user) return res.status(400).json({ error: "Invalid or expired reset token" });

    const hash = await bcrypt.hash(password, 10);
    await db.collection("users").updateOne(
      { _id: user._id },
      {
        $set: { password: hash },
        $unset: {
          passwordResetTokenHash: "",
          passwordResetExpiresAt: "",
        },
      }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not reset password" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
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

// ── Lists --------------------------------------------------------------

// fetch all lists the user owns or has been shared with
app.get("/api/lists", auth, async (req, res) => {
  try {
    const userId = req.userId;
    const includeArchived = req.query.includeArchived === "true";
    const membershipFilter = { $or: [{ owner: userId }, { sharedWith: userId }] };
    const query = includeArchived
      ? membershipFilter
      : { $and: [membershipFilter, { archived: { $ne: true } }] };
    const docs = await lists()
      .find(query)
      .toArray();

    // enrich with owner email for UI display
    const ownerIds = [...new Set(docs.map(d => d.owner))];
    let ownerMap = {};
    if (ownerIds.length) {
      const users = await db.collection("users").find({ _id: { $in: ownerIds.map(id => new ObjectId(id)) } }).toArray();
      ownerMap = users.reduce((m, u) => ({ ...m, [u._id.toString()]: u.email }), {});
    }
    const enriched = docs.map(d => ({ ...d, ownerEmail: ownerMap[d.owner] || "" }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load lists" });
  }
});

// helper to translate emails into userIds; returns array of existing ids
async function resolveEmails(emails) {
  if (!emails || emails.length === 0) return [];
  const users = await db
    .collection("users")
    .find({ email: { $in: emails } })
    .toArray();
  return users.map(u => u._id.toString());
}

app.post("/api/lists", auth, async (req, res) => {
  try {
    const { name, items = [], shareWithEmails = [], public: isPublic = false } = req.body;
    if (!name) return res.status(400).json({ error: "Missing name" });
    const owner = req.userId;
    const sharedWith = await resolveEmails(shareWithEmails);
    const doc = {
      name,
      owner,
      items,
      sharedWith,
      shareWithEmails,
      publicViewCount: 0,
      publicLastViewedAt: null,
    };
    if (isPublic) {
      doc.public = true;
      doc.publicId = crypto.randomUUID();
      doc.publicSlug = await generateUniquePublicSlug(name);
    }
    const result = await lists().insertOne(doc);
    const saved = { ...doc, _id: result.insertedId };
    io.to(owner).emit("list:updated", saved);
    if (saved.public && saved.publicId) {
      io.to(`public-list:id:${saved.publicId}`).emit("public-list:updated", {
        list: {
          publicId: saved.publicId,
          publicSlug: saved.publicSlug,
          name: saved.name,
          items: saved.items || [],
        },
      });
    }
    if (saved.public && saved.publicSlug) {
      io.to(`public-list:slug:${saved.publicSlug}`).emit("public-list:updated", {
        list: {
          publicId: saved.publicId,
          publicSlug: saved.publicSlug,
          name: saved.name,
          items: saved.items || [],
        },
      });
    }
    res.json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create list" });
  }
});

app.put("/api/lists/:id", auth, async (req, res) => {
  try {
    const id = req.params.id;
    const { name, items, shareWithEmails, public: isPublic, archived } = req.body;
    const userId = req.userId;
    const filter = { _id: new ObjectId(id) };
    const existing = await lists().findOne(filter);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const allowed = existing.owner === userId || (existing.sharedWith || []).includes(userId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    // only owner may change name, sharing, or public status
    if (name !== undefined && existing.owner !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (shareWithEmails !== undefined && existing.owner !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (isPublic !== undefined && existing.owner !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (archived !== undefined && existing.owner !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    let sharedWith;
    if (shareWithEmails) {
      sharedWith = await resolveEmails(shareWithEmails);
    }
    const update = {};
    if (name !== undefined) update.name = name;
    if (items !== undefined) update.items = items;
    if (sharedWith !== undefined) update.sharedWith = sharedWith;
    if (shareWithEmails !== undefined) update.shareWithEmails = shareWithEmails;
    if (isPublic !== undefined) {
      update.public = isPublic;
      if (isPublic && !existing.publicId) update.publicId = crypto.randomUUID();
      if (isPublic && !existing.publicSlug) {
        const slugSource = name !== undefined ? name : existing.name;
        update.publicSlug = await generateUniquePublicSlug(slugSource, existing._id);
      }
      if (!isPublic) {
        update.publicId = null;
        update.publicSlug = null;
      }
    }
    if (archived !== undefined) {
      update.archived = !!archived;
      update.archivedAt = archived ? new Date() : null;
      if (archived) {
        update.public = false;
        update.publicId = null;
        update.publicSlug = null;
      }
    }
    if (name !== undefined && (isPublic === true || (isPublic === undefined && existing.public))) {
      update.publicSlug = await generateUniquePublicSlug(name, existing._id);
    }
    const previousPublicId = existing.publicId;
    const previousPublicSlug = existing.publicSlug;
    const previousWasPublic = !!existing.public;

    await lists().updateOne(filter, { $set: update });
    const newDoc = await lists().findOne(filter);
    const recipients = [newDoc.owner, ...(newDoc.sharedWith || [])];
    recipients.forEach(u => io.to(u).emit("list:updated", newDoc));

    if (newDoc.public && newDoc.publicId) {
      io.to(`public-list:id:${newDoc.publicId}`).emit("public-list:updated", {
        list: {
          publicId: newDoc.publicId,
          publicSlug: newDoc.publicSlug,
          name: newDoc.name,
          items: newDoc.items || [],
        },
      });
    }
    if (newDoc.public && newDoc.publicSlug) {
      io.to(`public-list:slug:${newDoc.publicSlug}`).emit("public-list:updated", {
        list: {
          publicId: newDoc.publicId,
          publicSlug: newDoc.publicSlug,
          name: newDoc.name,
          items: newDoc.items || [],
        },
      });
    }

    // if public id changed, notify old subscribers too
    if (previousWasPublic && previousPublicId && previousPublicId !== newDoc.publicId) {
      io.to(`public-list:id:${previousPublicId}`).emit("public-list:updated", {
        list: {
          publicId: previousPublicId,
          publicSlug: previousPublicSlug,
          name: newDoc.name,
          items: newDoc.items || [],
        },
      });
    }

    // if public slug changed, notify old slug subscribers too
    if (previousWasPublic && previousPublicSlug && previousPublicSlug !== newDoc.publicSlug) {
      io.to(`public-list:slug:${previousPublicSlug}`).emit("public-list:updated", {
        list: {
          publicId: previousPublicId,
          publicSlug: previousPublicSlug,
          name: newDoc.name,
          items: newDoc.items || [],
        },
      });
    }

    res.json(newDoc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update list" });
  }
});

app.delete("/api/lists/:id", auth, async (req, res) => {
  try {
    const id = req.params.id;
    const userId = req.userId;
    const filter = { _id: new ObjectId(id) };
    const existing = await lists().findOne(filter);
    if (!existing) return res.json({ ok: true });
    if (existing.owner !== userId) return res.status(403).json({ error: "Forbidden" });
    const update = {
      archived: true,
      archivedAt: new Date(),
      public: false,
      publicId: null,
      publicSlug: null,
    };
    await lists().updateOne(filter, { $set: update });
    const archivedDoc = await lists().findOne(filter);
    const recipients = [archivedDoc.owner, ...(archivedDoc.sharedWith || [])];
    recipients.forEach(u => io.to(u).emit("list:updated", archivedDoc));
    if (existing.public && existing.publicId) {
      io.to(`public-list:id:${existing.publicId}`).emit("public-list:updated", {
        list: {
          publicId: existing.publicId,
          publicSlug: existing.publicSlug,
          name: existing.name,
          items: [],
          deleted: true,
        },
      });
    }
    if (existing.public && existing.publicSlug) {
      io.to(`public-list:slug:${existing.publicSlug}`).emit("public-list:updated", {
        list: {
          publicId: existing.publicId,
          publicSlug: existing.publicSlug,
          name: existing.name,
          items: [],
          deleted: true,
        },
      });
    }
    res.json({ ok: true, archived: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to archive list" });
  }
});

// public read-only access, no auth required
app.get("/api/public/:publicKey", async (req, res) => {
  try {
    const key = req.params.publicKey;
    let doc = await lists().findOne({ publicSlug: key, public: true });
    // backwards compatibility for old links that used UUID publicId
    if (!doc) {
      doc = await lists().findOne({ publicId: key, public: true });
    }
    if (!doc) return res.status(404).json({ error: "Not found" });

    const nextPublicViewCount = (doc.publicViewCount || 0) + 1;
    const currentViewedAt = new Date();
    await lists().updateOne(
      { _id: doc._id },
      { $set: { publicViewCount: nextPublicViewCount, publicLastViewedAt: currentViewedAt } }
    );

    const updatedDoc = {
      ...doc,
      publicViewCount: nextPublicViewCount,
      publicLastViewedAt: currentViewedAt,
    };
    const recipients = [updatedDoc.owner, ...(updatedDoc.sharedWith || [])];
    recipients.forEach((u) => io.to(u).emit("list:updated", updatedDoc));

    const { _id, owner, sharedWith, shareWithEmails, ...data } = updatedDoc;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load public list" });
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
