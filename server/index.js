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
app.use(express.json({ limit: "10mb" }));

app.use((err, _req, res, next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Image is too large. Please choose a smaller file." });
  }
  return next(err);
});

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
  await db.collection("lists").updateMany(
    { publicId: null },
    { $unset: { publicId: "" } }
  );
  await db.collection("lists").updateMany(
    { publicSlug: null },
    { $unset: { publicSlug: "" } }
  );
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

function listItems() {
  return db.collection("list_items");
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

function canAccessList(listDoc, userId) {
  return listDoc.owner === userId || (listDoc.sharedWith || []).includes(userId);
}

function normalizeStoredItemRef(item) {
  if (typeof item === "string") {
    return { itemId: "", text: item, note: "", images: [], done: false };
  }

  if (!item || typeof item !== "object") {
    return { itemId: "", text: "", note: "", images: [], done: false };
  }

  const images = Array.isArray(item.images)
    ? item.images.map((img) => String(img || "").trim()).filter(Boolean)
    : [];

  return {
    itemId: String(item.itemId || item.id || ""),
    text: typeof item.text === "string" ? item.text : "",
    note: typeof item.note === "string" ? item.note : "",
    images,
    done: !!item.done,
    sourceItemId: item.sourceItemId || item.originItemId || null,
    createdAt: item.createdAt || null,
    createdBy: item.createdBy || null,
  };
}

async function persistListItemsForList(listDoc, rawItems = [], actorUserId = listDoc.owner) {
  const refs = [];
  const upserts = [];
  const now = new Date();

  for (const rawItem of rawItems) {
    const normalized = normalizeStoredItemRef(rawItem);
    const itemId = normalized.itemId || crypto.randomUUID();
    const text = String(normalized.text || "").trim();
    const note = String(normalized.note || "");
    const images = Array.isArray(normalized.images)
      ? normalized.images.map((img) => String(img || "").trim()).filter(Boolean)
      : [];

    if (!itemId || !text) continue;

    refs.push({ itemId, done: normalized.done });
    upserts.push({
      itemId,
      text,
      note,
      images,
      sourceItemId: String(normalized.sourceItemId || itemId),
      createdAt: normalized.createdAt ? new Date(normalized.createdAt) : now,
      createdBy: normalized.createdBy || actorUserId,
      updatedAt: now,
    });
  }

  if (upserts.length > 0) {
    await Promise.all(
      upserts.map((item) =>
        listItems().updateOne(
          { _id: item.itemId },
          {
            $set: {
              text: item.text,
              note: item.note,
              images: item.images,
              sourceItemId: item.sourceItemId,
              updatedAt: item.updatedAt,
            },
            $setOnInsert: {
              createdAt: item.createdAt,
              createdBy: item.createdBy,
            },
          },
          { upsert: true }
        )
      )
    );
  }

  return refs;
}

function listNeedsItemMigration(listDoc) {
  return Array.isArray(listDoc?.items) && listDoc.items.some((item) => {
    if (typeof item === "string") return true;
    if (!item || typeof item !== "object") return true;
    return !item.itemId || Object.prototype.hasOwnProperty.call(item, "text") || Object.prototype.hasOwnProperty.call(item, "id");
  });
}

async function migrateListItems(listDoc) {
  if (!listNeedsItemMigration(listDoc)) {
    return listDoc;
  }

  const refs = await persistListItemsForList(listDoc, listDoc.items || [], listDoc.owner);
  await lists().updateOne(
    { _id: listDoc._id },
    { $set: { items: refs } }
  );

  return { ...listDoc, items: refs };
}

async function hydrateListDoc(listDoc, options = {}) {
  if (!listDoc) return null;
  const includeImages = !!options.includeImages;

  const migrated = await migrateListItems(listDoc);
  const refs = Array.isArray(migrated.items)
    ? migrated.items
      .map((item) => ({ itemId: String(item?.itemId || ""), done: !!item?.done }))
      .filter((item) => item.itemId)
    : [];

  if (refs.length === 0) {
    return { ...migrated, items: [] };
  }

  const itemIds = [...new Set(refs.map((item) => item.itemId))];
  const itemDocs = await listItems().find({ _id: { $in: itemIds } }).toArray();
  const itemMap = new Map(itemDocs.map((item) => [String(item._id), item]));

  return {
    ...migrated,
    items: refs.map((ref) => {
      const itemDoc = itemMap.get(ref.itemId);
      const images = Array.isArray(itemDoc?.images) ? itemDoc.images : [];
      const note = itemDoc?.note || "";
      const hasImages = images.length > 0;
      return {
        id: ref.itemId,
        itemId: ref.itemId,
        text: itemDoc?.text || "",
        note,
        imageCount: images.length,
        hasAttachments: !!String(note).trim() || hasImages,
        ...(includeImages ? { images } : {}),
        done: ref.done,
        sourceItemId: itemDoc?.sourceItemId || ref.itemId,
        createdAt: itemDoc?.createdAt || null,
        updatedAt: itemDoc?.updatedAt || null,
        createdBy: itemDoc?.createdBy || null,
      };
    }),
  };
}

function publicListPayload(listDoc, overrides = {}) {
  const items = Array.isArray(listDoc.items)
    ? listDoc.items
      .filter((item) => !item?.done)
      .map((item) => ({
      id: String(item?.id || item?.itemId || ""),
      itemId: String(item?.itemId || item?.id || ""),
      text: String(item?.text || ""),
      done: !!item?.done,
      }))
    : [];

  return {
    listId: String(listDoc._id || ""),
    publicId: listDoc.publicId,
    publicSlug: listDoc.publicSlug,
    name: listDoc.name,
    items,
    ...overrides,
  };
}

async function buildPublicListResponse(listDoc) {
  const migrated = await migrateListItems(listDoc);
  const refs = Array.isArray(migrated.items)
    ? migrated.items
      .map((item) => ({ itemId: String(item?.itemId || ""), done: !!item?.done }))
      .filter((item) => item.itemId && !item.done)
    : [];

  if (refs.length === 0) {
    return {
      listId: String(migrated._id || ""),
      publicId: migrated.publicId,
      publicSlug: migrated.publicSlug,
      name: migrated.name,
      items: [],
    };
  }

  const itemIds = [...new Set(refs.map((item) => item.itemId))];
  const itemDocs = await listItems()
    .find(
      { _id: { $in: itemIds } },
      { projection: { _id: 1, text: 1 } }
    )
    .toArray();
  const textById = new Map(itemDocs.map((item) => [String(item._id), String(item.text || "")]));

  return {
    listId: String(migrated._id || ""),
    publicId: migrated.publicId,
    publicSlug: migrated.publicSlug,
    name: migrated.name,
    items: refs.map((ref) => ({
      id: ref.itemId,
      itemId: ref.itemId,
      text: textById.get(ref.itemId) || "",
      done: ref.done,
    })),
  };
}

async function emitHydratedListUpdate(listDoc) {
  const hydrated = await hydrateListDoc(listDoc);
  const recipients = [hydrated.owner, ...(hydrated.sharedWith || [])];
  recipients.forEach((recipient) => io.to(recipient).emit("list:updated", hydrated));

  if (hydrated.public && hydrated.publicId) {
    io.to(`public-list:id:${hydrated.publicId}`).emit("public-list:updated", {
      list: publicListPayload(hydrated),
    });
  }

  if (hydrated.public && hydrated.publicSlug) {
    io.to(`public-list:slug:${hydrated.publicSlug}`).emit("public-list:updated", {
      list: publicListPayload(hydrated),
    });
  }

  return hydrated;
}

async function emitSharedItemUpdated(itemId) {
  const normalizedItemId = String(itemId || "");
  if (!normalizedItemId) {
    return { item: null, hydratedLists: [] };
  }

  const itemDoc = await listItems().findOne({ _id: normalizedItemId });
  if (!itemDoc) {
    return { item: null, hydratedLists: [] };
  }

  const referencingLists = await lists().find({ "items.itemId": normalizedItemId }).toArray();
  const hydratedLists = await Promise.all(referencingLists.map((listDoc) => emitHydratedListUpdate(listDoc)));

  const payload = {
    item: {
      id: normalizedItemId,
      itemId: normalizedItemId,
      text: itemDoc.text || "",
      note: itemDoc.note || "",
      imageCount: Array.isArray(itemDoc.images) ? itemDoc.images.length : 0,
      hasAttachments: !!String(itemDoc.note || "").trim() || (Array.isArray(itemDoc.images) && itemDoc.images.length > 0),
      sourceItemId: itemDoc.sourceItemId || normalizedItemId,
      createdAt: itemDoc.createdAt || null,
      updatedAt: itemDoc.updatedAt || null,
      createdBy: itemDoc.createdBy || null,
    },
    listIds: hydratedLists.map((listDoc) => String(listDoc?._id || "")).filter(Boolean),
  };

  const recipients = new Set();
  hydratedLists.forEach((listDoc) => {
    recipients.add(listDoc.owner);
    (listDoc.sharedWith || []).forEach((userId) => recipients.add(userId));
  });
  recipients.forEach((recipient) => {
    io.to(recipient).emit("item-updated", payload);
    io.to(recipient).emit("item:updated", payload);
  });

  return { item: payload.item, hydratedLists };
}

async function removeOrphanedListItem(itemId) {
  if (!itemId) return;

  const usage = await lists().countDocuments({ "items.itemId": itemId });
  if (usage === 0) {
    // Explicitly clear image payloads before deleting the item document.
    await listItems().updateOne(
      { _id: itemId },
      { $set: { images: [] } }
    );
    await listItems().deleteOne({ _id: itemId });
  }
}

async function cloneListItem(sourceItemId, actorUserId) {
  const sourceItem = await listItems().findOne({ _id: sourceItemId });
  if (!sourceItem) return null;

  const newItemId = crypto.randomUUID();
  const now = new Date();
  const clonedItem = {
    _id: newItemId,
    text: sourceItem.text,
    note: sourceItem.note || "",
    images: Array.isArray(sourceItem.images) ? sourceItem.images : [],
    sourceItemId: String(sourceItem.sourceItemId || sourceItemId),
    createdAt: now,
    updatedAt: now,
    createdBy: actorUserId,
  };

  await listItems().insertOne(clonedItem);
  return clonedItem;
}

async function findAccessibleListOrThrow(id, userId) {
  if (!ObjectId.isValid(id)) {
    return { error: { status: 400, body: { error: "Invalid list id" } } };
  }

  const listDoc = await lists().findOne({ _id: new ObjectId(id) });
  if (!listDoc) {
    return { error: { status: 404, body: { error: "Not found" } } };
  }

  if (!canAccessList(listDoc, userId)) {
    return { error: { status: 403, body: { error: "Forbidden" } } };
  }

  return { listDoc };
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
    const hydratedDocs = await Promise.all(docs.map((doc) => hydrateListDoc(doc)));
    const enriched = hydratedDocs
      .map(d => ({ ...d, ownerEmail: ownerMap[d.owner] || "" }))
      .sort((a, b) => {
        const toOrder = (list) => {
          const value = Number(list?.sortOrder);
          return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
        };
        const byOrder = toOrder(a) - toOrder(b);
        if (byOrder !== 0) return byOrder;
        return String(a?.name || "").localeCompare(String(b?.name || ""));
      });

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
    const ownerLists = await lists().find({ owner }, { projection: { sortOrder: 1 } }).toArray();
    const minSortOrder = ownerLists.reduce((min, list) => {
      const value = Number(list?.sortOrder);
      return Number.isFinite(value) ? Math.min(min, value) : min;
    }, 0);
    const doc = {
      name,
      owner,
      items: [],
      sortOrder: minSortOrder - 1,
      sharedWith,
      shareWithEmails,
      publicViewCount: 0,
      publicLastViewedAt: null,
    };
    doc.items = await persistListItemsForList(doc, items, owner);
    if (isPublic) {
      doc.public = true;
      doc.publicId = crypto.randomUUID();
      doc.publicSlug = await generateUniquePublicSlug(name);
    }
    const result = await lists().insertOne(doc);
    const saved = await emitHydratedListUpdate({ ...doc, _id: result.insertedId });
    res.json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create list" });
  }
});

app.post("/api/lists/:id/items", auth, async (req, res) => {
  try {
    const lookup = await findAccessibleListOrThrow(req.params.id, req.userId);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const text = String(req.body.text || "").trim();
    if (!text) return res.status(400).json({ error: "Missing text" });

    const itemId = crypto.randomUUID();
    const now = new Date();
    await listItems().insertOne({
      _id: itemId,
      text,
      note: "",
      images: [],
      sourceItemId: itemId,
      createdAt: now,
      updatedAt: now,
      createdBy: req.userId,
    });

    await lists().updateOne(
      { _id: lookup.listDoc._id },
      { $push: { items: { $each: [{ itemId, done: false }], $position: 0 } } }
    );

    const updatedList = await lists().findOne({ _id: lookup.listDoc._id });
    const hydrated = await emitHydratedListUpdate(updatedList);
    res.json(hydrated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add item" });
  }
});

app.get("/api/lists/:id/items/:itemId", auth, async (req, res) => {
  try {
    const lookup = await findAccessibleListOrThrow(req.params.id, req.userId);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const itemId = String(req.params.itemId || "");
    const refs = Array.isArray(lookup.listDoc.items) ? lookup.listDoc.items : [];
    const ref = refs.find((item) => String(item?.itemId || "") === itemId);
    if (!ref) return res.status(404).json({ error: "Item not found" });

    const itemDoc = await listItems().findOne({ _id: itemId });
    if (!itemDoc) return res.status(404).json({ error: "Item not found" });

    const images = Array.isArray(itemDoc.images) ? itemDoc.images : [];
    const note = itemDoc.note || "";
    return res.json({
      id: itemId,
      itemId,
      text: itemDoc.text || "",
      note,
      images,
      imageCount: images.length,
      hasAttachments: !!String(note).trim() || images.length > 0,
      done: !!ref.done,
      sourceItemId: itemDoc.sourceItemId || itemId,
      createdAt: itemDoc.createdAt || null,
      updatedAt: itemDoc.updatedAt || null,
      createdBy: itemDoc.createdBy || null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to load item" });
  }
});

app.patch("/api/lists/:id/items/:itemId", auth, async (req, res) => {
  try {
    const lookup = await findAccessibleListOrThrow(req.params.id, req.userId);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const itemId = String(req.params.itemId || "");
    const refs = Array.isArray(lookup.listDoc.items) ? lookup.listDoc.items : [];
    const itemIndex = refs.findIndex((item) => String(item?.itemId || "") === itemId);
    if (itemIndex === -1) return res.status(404).json({ error: "Item not found" });

    const { text, done, note, images, addImage, removeImage } = req.body;
    const listUpdate = {};
    const itemUpdate = {};

    if (typeof done === "boolean") {
      const nextRefs = refs.map((item, index) =>
        index === itemIndex ? { ...item, done } : item
      );
      listUpdate.items = nextRefs;
    }

    if (text !== undefined) {
      const trimmed = String(text).trim();
      if (!trimmed) return res.status(400).json({ error: "Missing text" });
      itemUpdate.text = trimmed;
      itemUpdate.updatedAt = new Date();
    }

    if (note !== undefined) {
      itemUpdate.note = String(note || "");
      itemUpdate.updatedAt = new Date();
    }

    if (images !== undefined) {
      if (!Array.isArray(images)) {
        return res.status(400).json({ error: "images must be an array" });
      }
      if (images.length > 1) {
        return res.status(400).json({ error: "Only one image can be sent per request" });
      }
      itemUpdate.images = images.map((img) => String(img || "").trim()).filter(Boolean);
      itemUpdate.updatedAt = new Date();
    }

    if (addImage !== undefined) {
      const imageValue = String(addImage || "").trim();
      if (!imageValue) {
        return res.status(400).json({ error: "Missing addImage" });
      }
      await listItems().updateOne(
        { _id: itemId },
        { $push: { images: imageValue }, $set: { updatedAt: new Date() } }
      );
    }

    if (removeImage !== undefined) {
      const imageValue = String(removeImage || "").trim();
      if (!imageValue) {
        return res.status(400).json({ error: "Missing removeImage" });
      }
      await listItems().updateOne(
        { _id: itemId },
        { $pull: { images: imageValue }, $set: { updatedAt: new Date() } }
      );
    }

    if (Object.keys(itemUpdate).length > 0) {
      await listItems().updateOne({ _id: itemId }, { $set: itemUpdate });
    }

    if (Object.keys(listUpdate).length > 0) {
      await lists().updateOne({ _id: lookup.listDoc._id }, { $set: listUpdate });
    }

    let hydrated = null;
    if (Object.keys(itemUpdate).length > 0 || addImage !== undefined || removeImage !== undefined) {
      const sharedUpdate = await emitSharedItemUpdated(itemId);
      hydrated = sharedUpdate.hydratedLists.find(
        (listDoc) => String(listDoc?._id || "") === String(lookup.listDoc._id)
      ) || null;
    }

    if (!hydrated) {
      const updatedList = await lists().findOne({ _id: lookup.listDoc._id });
      hydrated = await emitHydratedListUpdate(updatedList);
    }

    res.json(hydrated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update item" });
  }
});

app.delete("/api/lists/:id/items/:itemId", auth, async (req, res) => {
  try {
    const lookup = await findAccessibleListOrThrow(req.params.id, req.userId);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const itemId = String(req.params.itemId || "");
    await lists().updateOne(
      { _id: lookup.listDoc._id },
      { $pull: { items: { itemId } } }
    );

    await removeOrphanedListItem(itemId);

    const updatedList = await lists().findOne({ _id: lookup.listDoc._id });
    const hydrated = await emitHydratedListUpdate(updatedList);
    res.json(hydrated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete item" });
  }
});

app.put("/api/lists/:id/items/reorder", auth, async (req, res) => {
  try {
    const lookup = await findAccessibleListOrThrow(req.params.id, req.userId);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const itemIds = Array.isArray(req.body.itemIds) ? req.body.itemIds.map((itemId) => String(itemId || "")).filter(Boolean) : [];
    const existingRefs = Array.isArray(lookup.listDoc.items) ? lookup.listDoc.items : [];
    const existingIds = existingRefs.map((item) => String(item?.itemId || "")).filter(Boolean);

    if (itemIds.length !== existingIds.length || itemIds.some((itemId) => !existingIds.includes(itemId))) {
      return res.status(400).json({ error: "Invalid itemIds" });
    }

    const refMap = new Map(existingRefs.map((item) => [String(item?.itemId || ""), item]));
    const reorderedRefs = itemIds.map((itemId) => refMap.get(itemId)).filter(Boolean);
    await lists().updateOne(
      { _id: lookup.listDoc._id },
      { $set: { items: reorderedRefs } }
    );

    const updatedList = await lists().findOne({ _id: lookup.listDoc._id });
    const hydrated = await emitHydratedListUpdate(updatedList);
    res.json(hydrated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reorder items" });
  }
});

app.post("/api/lists/:id/items/:itemId/transfer", auth, async (req, res) => {
  try {
    const sourceLookup = await findAccessibleListOrThrow(req.params.id, req.userId);
    if (sourceLookup.error) return res.status(sourceLookup.error.status).json(sourceLookup.error.body);

    const { targetListId, mode = "share" } = req.body;
    const targetLookup = await findAccessibleListOrThrow(targetListId, req.userId);
    if (targetLookup.error) return res.status(targetLookup.error.status).json(targetLookup.error.body);

    const sourceItemId = String(req.params.itemId || "");
    const sourceRef = (sourceLookup.listDoc.items || []).find((item) => String(item?.itemId || "") === sourceItemId);
    if (!sourceRef) return res.status(404).json({ error: "Item not found" });

    let targetItemId = sourceItemId;
    if (mode === "copy") {
      const clonedItem = await cloneListItem(sourceItemId, req.userId);
      if (!clonedItem) return res.status(404).json({ error: "Item not found" });
      targetItemId = clonedItem._id;
    } else if (mode !== "share") {
      return res.status(400).json({ error: "Invalid mode" });
    }

    const targetRefs = Array.isArray(targetLookup.listDoc.items) ? targetLookup.listDoc.items : [];
    if (mode === "share" && targetRefs.some((item) => String(item?.itemId || "") === targetItemId)) {
      const hydratedTarget = await hydrateListDoc(targetLookup.listDoc);
      return res.json({ targetList: hydratedTarget });
    }

    await lists().updateOne(
      { _id: targetLookup.listDoc._id },
      { $push: { items: { $each: [{ itemId: targetItemId, done: sourceRef.done }], $position: 0 } } }
    );

    const updatedTarget = await lists().findOne({ _id: targetLookup.listDoc._id });
    const hydratedTarget = await emitHydratedListUpdate(updatedTarget);
    res.json({ targetList: hydratedTarget });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to transfer item" });
  }
});

app.put("/api/lists/:id", auth, async (req, res) => {
  try {
    const id = req.params.id;
    const { name, items, shareWithEmails, public: isPublic, archived, sortOrder } = req.body;
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
    const setUpdate = {};
    const unsetUpdate = {};
    if (name !== undefined) setUpdate.name = name;
    if (items !== undefined) setUpdate.items = await persistListItemsForList(existing, items, userId);
    if (sharedWith !== undefined) setUpdate.sharedWith = sharedWith;
    if (shareWithEmails !== undefined) setUpdate.shareWithEmails = shareWithEmails;
    if (isPublic !== undefined) {
      setUpdate.public = isPublic;
      if (isPublic && !existing.publicId) setUpdate.publicId = crypto.randomUUID();
      if (isPublic && !existing.publicSlug) {
        const slugSource = name !== undefined ? name : existing.name;
        setUpdate.publicSlug = await generateUniquePublicSlug(slugSource, existing._id);
      }
      if (!isPublic) {
        unsetUpdate.publicId = "";
        unsetUpdate.publicSlug = "";
      }
    }
    if (archived !== undefined) {
      setUpdate.archived = !!archived;
      if (archived) {
        setUpdate.archivedAt = new Date();
      } else {
        unsetUpdate.archivedAt = "";
      }
      if (archived) {
        setUpdate.public = false;
        unsetUpdate.publicId = "";
        unsetUpdate.publicSlug = "";
      }
    }
    if (sortOrder !== undefined) {
      const numericOrder = Number(sortOrder);
      if (!Number.isFinite(numericOrder)) {
        return res.status(400).json({ error: "Invalid sortOrder" });
      }
      setUpdate.sortOrder = numericOrder;
    }
    if (name !== undefined && (isPublic === true || (isPublic === undefined && existing.public))) {
      setUpdate.publicSlug = await generateUniquePublicSlug(name, existing._id);
    }
    const previousPublicId = existing.publicId;
    const previousPublicSlug = existing.publicSlug;
    const previousWasPublic = !!existing.public;

    const mongoUpdate = {};
    if (Object.keys(setUpdate).length > 0) {
      mongoUpdate.$set = setUpdate;
    }
    if (Object.keys(unsetUpdate).length > 0) {
      mongoUpdate.$unset = unsetUpdate;
    }
    if (Object.keys(mongoUpdate).length > 0) {
      await lists().updateOne(filter, mongoUpdate);
    }
    const newDoc = await lists().findOne(filter);
    const hydrated = await emitHydratedListUpdate(newDoc);

    // if public id changed, notify old subscribers too
    if (previousWasPublic && previousPublicId && previousPublicId !== newDoc.publicId) {
      io.to(`public-list:id:${previousPublicId}`).emit("public-list:updated", {
        list: publicListPayload(hydrated, {
          publicId: previousPublicId,
          publicSlug: previousPublicSlug,
        }),
      });
    }

    // if public slug changed, notify old slug subscribers too
    if (previousWasPublic && previousPublicSlug && previousPublicSlug !== newDoc.publicSlug) {
      io.to(`public-list:slug:${previousPublicSlug}`).emit("public-list:updated", {
        list: publicListPayload(hydrated, {
          publicId: previousPublicId,
          publicSlug: previousPublicSlug,
        }),
      });
    }

    res.json(hydrated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update list" });
  }
});

app.delete("/api/lists/:id", auth, async (req, res) => {
  try {
    const id = req.params.id;
    const permanent = req.query.permanent === "true";
    const userId = req.userId;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid list id" });
    }
    const filter = { _id: new ObjectId(id) };
    const existing = await lists().findOne(filter);
    if (!existing) return res.json({ ok: true });
    if (existing.owner !== userId) return res.status(403).json({ error: "Forbidden" });

    if (permanent) {
      const itemIdsToCheck = (existing.items || []).map((item) => String(item?.itemId || item?.id || "")).filter(Boolean);
      await lists().deleteOne(filter);
      const recipients = [existing.owner, ...(existing.sharedWith || [])];
      recipients.forEach(u => io.to(u).emit("list:deleted", { id }));
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
      await Promise.all(itemIdsToCheck.map((itemId) => removeOrphanedListItem(itemId)));
      return res.json({ ok: true, permanent: true, id });
    }

    await lists().updateOne(filter, {
      $set: {
        archived: true,
        archivedAt: new Date(),
        public: false,
      },
      $unset: {
        publicId: "",
        publicSlug: "",
      },
    });
    const archivedDoc = await lists().findOne(filter);
    await emitHydratedListUpdate(archivedDoc);
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
    res.status(500).json({ error: "Failed to delete list" });
  }
});

// public read-only access, no auth required
app.get("/api/public/:publicKey", async (req, res) => {
  try {
    const key = req.params.publicKey;
    const projection = {
      _id: 1,
      publicId: 1,
      publicSlug: 1,
      name: 1,
      items: 1,
      owner: 1,
      sharedWith: 1,
    };
    let doc = await lists().findOne({ publicSlug: key, public: true }, { projection });
    // backwards compatibility for old links that used UUID publicId
    if (!doc) {
      doc = await lists().findOne({ publicId: key, public: true }, { projection });
    }
    if (!doc) return res.status(404).json({ error: "Not found" });

    const payload = await buildPublicListResponse(doc);
    res.json(payload);

    // Do not block public reads on analytics writes.
    lists()
      .updateOne(
        { _id: doc._id },
        {
          $inc: { publicViewCount: 1 },
          $set: { publicLastViewedAt: new Date() },
        }
      )
      .catch((updateErr) => {
        console.error("Failed to update public list view stats", updateErr);
      });
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
