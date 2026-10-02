require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const CORS_ORIGINS = new Set(
  (process.env.CORS_ORIGINS || "https://macsubido29-bit.github.io")
    .split(",").map(origin => origin.trim()).filter(Boolean)
);
const SESSION_MS = 1000 * 60 * 60 * 24 * 14;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "recastrepublic29@gmail.com").trim().toLowerCase();
const DB_PATH = path.resolve(__dirname, process.env.DB_PATH || "data/recast-republic.sqlite");
const DEFAULT_PRODUCTS = [
  [1, "Anime Action Figure", 850, "🦸", "Anime-inspired action figure for display."],
  [2, "Miniature Wooden Cabinet", 450, "🗄️", "Miniature cabinet for 1:12 scale dioramas."],
  [3, "Chibi Character Figure", 550, "👾", "Cute chibi-style collectible."],
  [4, "Miniature School Desk", 350, "🪑", "Detailed miniature school desk."],
  [5, "Fantasy Warrior Figure", 1200, "⚔️", "Fantasy collectible display figure."],
  [6, "Miniature Room Set", 1500, "🏠", "Miniature room for dioramas."],
  [7, "Robot Collectible", 950, "🤖", "Robot-inspired display figure."],
  [8, "Custom Display Stand", 250, "🎁", "Stand for your favorite figures."]
];

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const database = new Database(DB_PATH);
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.pragma("busy_timeout = 5000");

let queryQueue = Promise.resolve();
function acquireDatabase() {
  let unlock;
  const previous = queryQueue;
  queryQueue = new Promise(resolve => { unlock = resolve; });
  return previous.then(() => unlock);
}

function executeQuery(sql, params = []) {
  const normalized = sql
    .replace(/now\(\)\s*\+\s*interval\s+'14 days'/gi, "datetime('now', '+14 days')")
    .replace(/now\(\)/gi, "CURRENT_TIMESTAMP")
    .replace(/::(?:bigint\[\]|bigint|int|date|jsonb)/gi, "")
    .replace(/\s+for update\b/gi, "")
    .replace(/\$\d+/g, "?")
    .trim();
  try {
    const statement = database.prepare(normalized);
    if (statement.reader) {
      const rows = statement.all(...params);
      return { rows, rowCount: rows.length };
    }
    const result = statement.run(...params);
    return { rows: [], rowCount: result.changes, lastInsertRowid: result.lastInsertRowid };
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      error.code = "23505";
    }
    throw error;
  }
}

const pool = {
  async query(sql, params = []) {
    const unlock = await acquireDatabase();
    try {
      return executeQuery(sql, params);
    } finally {
      unlock();
    }
  },
  async connect() {
    const unlock = await acquireDatabase();
    let released = false;
    return {
      query: async (sql, params = []) => executeQuery(sql, params),
      release: () => {
        if (released) return;
        released = true;
        unlock();
      }
    };
  },
  async end() {
    database.close();
  }
};
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin) {
    const sameOrigin = origin === `${req.protocol}://${req.get("host")}`;
    if (!sameOrigin && !CORS_ORIGINS.has(origin)) {
      return res.status(403).json({ error: "This website is not allowed to access the store API." });
    }
    if (!sameOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
    }
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "1mb", type: "application/json" }));
app.use((req, res, next) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) req.body = {};
  next();
});
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again later." }
});

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) return reject(error);
      resolve(`${salt}:${key.toString("hex")}`);
    });
  });
}

async function passwordMatches(password, stored) {
  const [salt, encoded] = String(stored).split(":");
  if (!salt || !encoded) return false;
  const actual = await passwordHash(password, salt);
  const expectedBuffer = Buffer.from(`${salt}:${encoded}`);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function publicUser(row) {
  return { id: Number(row.id), name: row.name, email: row.email, role: row.role };
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production";
  res.cookie("rr_session", token, {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    path: "/",
    maxAge: SESSION_MS
  });
}

function clearSessionCookie(res) {
  res.clearCookie("rr_session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/"
  });
}

async function requireUser(req, res, next) {
  const token = req.headers.cookie?.split(";")
    .map(part => part.trim())
    .find(part => part.startsWith("rr_session="))
    ?.slice("rr_session=".length);
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  try {
    const result = await pool.query(
      `select u.id, u.name, u.email, u.role
         from app_sessions s
         join app_users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now()`,
      [digest(decodeURIComponent(token))]
    );
    if (!result.rowCount) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
    req.user = publicUser(result.rows[0]);
    next();
  } catch (error) {
    next(error);
  }
}

async function optionalUser(req, res, next) {
  const token = req.headers.cookie?.split(";")
    .map(part => part.trim())
    .find(part => part.startsWith("rr_session="))
    ?.slice("rr_session=".length);
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const result = await pool.query(
      `select u.id, u.name, u.email, u.role
         from app_sessions s
         join app_users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now()`,
      [digest(decodeURIComponent(token))]
    );
    if (!result.rowCount) clearSessionCookie(res);
    req.user = result.rowCount ? publicUser(result.rows[0]) : null;
    next();
  } catch (error) {
    next(error);
  }
}

function requireSeller(req, res, next) {
  if (req.user.role !== "seller" && req.user.role !== "admin") {
    return res.status(403).json({ error: "Seller or admin access is required." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access is required." });
  next();
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validImageData(value, limit) {
  return typeof value === "string" && value.length <= limit &&
    (!value || /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value));
}

function productDto(row) {
  return {
    id: Number(row.id),
    name: row.name,
    price: Number(row.price),
    emoji: row.emoji,
    desc: row.description,
    photo: row.photo_data || ""
  };
}

function orderDto(row) {
  let items = row.items;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch {
      throw new Error(`Order ${row.id} contains invalid stored item data.`);
    }
  }
  return {
    id: row.id,
    buyer: row.buyer_email,
    buyerName: row.buyer_name,
    items,
    total: Number(row.total),
    address: row.delivery_address,
    payment: row.payment_method,
    status: row.status,
    date: new Date(row.created_at).toLocaleString()
  };
}

function messageDto(row) {
  return {
    buyer: row.buyer_email,
    sender: row.sender_role === "buyer" ? "buyer" : "seller",
    text: row.body,
    date: new Date(row.created_at).toLocaleString()
  };
}

async function notifyAdmin(subject, body, replyTo) {
  const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"];
  if (required.some(name => !process.env[name])) return false;
  const nodemailer = require("nodemailer");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: ADMIN_EMAIL,
    ...(validEmail(replyTo) ? { replyTo } : {}),
    subject,
    text: body
  });
  return true;
}

app.get("/api/health", async (req, res, next) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/register", authLimiter, async (req, res, next) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = req.body.password;
  if (req.body.privacyConsent !== true) {
    return res.status(400).json({ error: "Consent to the account data storage notice is required." });
  }
  if (!name || name.length > 100 || !validEmail(email) ||
      typeof password !== "string" || password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: "Enter a name, valid email, and password of at least 8 characters." });
  }
  const client = await pool.connect();
  try {
    const hash = await passwordHash(password);
    await client.query("begin");
    const created = await client.query(
      `insert into app_users(email, name, password_hash)
       values ($1, $2, $3) returning id, name, email, role`,
      [email, name, hash]
    );
    await client.query("insert into profiles(user_id) values ($1)", [created.rows[0].id]);
    const token = crypto.randomBytes(32).toString("base64url");
    await client.query(
      "insert into app_sessions(token_hash, user_id, expires_at) values ($1, $2, now() + interval '14 days')",
      [digest(token), created.rows[0].id]
    );
    await client.query("commit");
    setSessionCookie(res, token);
    res.status(201).json({ user: publicUser(created.rows[0]) });
  } catch (error) {
    await client.query("rollback");
    if (error.code === "23505") return res.status(409).json({ error: "An account with this email already exists." });
    next(error);
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", authLimiter, async (req, res, next) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = req.body.password;
  if (!validEmail(email) || typeof password !== "string" || !password) {
    return res.status(400).json({ error: "Enter a valid email and password." });
  }
  try {
    const result = await pool.query(
      "select id, name, email, role, password_hash from app_users where email = $1",
      [email]
    );
    if (!result.rowCount || !(await passwordMatches(password, result.rows[0].password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    const account = result.rows[0];
    const token = crypto.randomBytes(32).toString("base64url");
    await pool.query(
      "insert into app_sessions(token_hash, user_id, expires_at) values ($1, $2, now() + interval '14 days')",
      [digest(token), account.id]
    );
    setSessionCookie(res, token);
    res.json({ user: publicUser(account) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/session", optionalUser, (req, res) => res.json({ user: req.user }));

app.post("/api/auth/logout", requireUser, async (req, res, next) => {
  try {
    const token = req.headers.cookie.split(";").map(part => part.trim())
      .find(part => part.startsWith("rr_session=")).slice("rr_session=".length);
    await pool.query("delete from app_sessions where token_hash = $1", [digest(decodeURIComponent(token))]);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/products", async (req, res, next) => {
  try {
    const result = await pool.query(
      "select id, name, description, price, emoji, photo_data from products order by created_at desc, id desc"
    );
    res.json(result.rows.map(productDto));
  } catch (error) {
    next(error);
  }
});

app.post("/api/products", requireUser, requireSeller, async (req, res, next) => {
  const { name, desc, price, emoji, photo } = req.body;
  if (typeof name !== "string" || !name.trim() || name.length > 160 ||
      typeof desc !== "string" || desc.length > 5000 ||
      !Number.isFinite(Number(price)) || Number(price) <= 0 ||
      typeof (emoji || "📦") !== "string" || String(emoji || "📦").length > 32 ||
      !validImageData(photo || "", 400000)) {
    return res.status(400).json({ error: "Enter valid product details and a photo under the storage limit." });
  }
  try {
    const result = await pool.query(
      `insert into products(owner_id, name, description, price, emoji, photo_data)
       values ($1, $2, $3, $4, $5, $6)
       returning id, name, description, price, emoji, photo_data`,
      [req.user.id, name.trim(), desc.trim(), Number(price), emoji || "📦", photo || ""]
    );
    res.status(201).json(productDto(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/products/:id", requireUser, requireSeller, async (req, res, next) => {
  const { name, desc, price, emoji, photo } = req.body;
  if (typeof name !== "string" || !name.trim() || name.length > 160 ||
      typeof desc !== "string" || desc.length > 5000 ||
      !Number.isFinite(Number(price)) || Number(price) <= 0 ||
      typeof (emoji || "📦") !== "string" || String(emoji || "📦").length > 32 ||
      !validImageData(photo || "", 400000)) {
    return res.status(400).json({ error: "Enter valid product details." });
  }
  try {
    const result = await pool.query(
      `update products set name=$1, description=$2, price=$3, emoji=$4, photo_data=$5, updated_at=now()
        where id=$6 and ($7 = 'admin' or owner_id=$8)
        returning id, name, description, price, emoji, photo_data`,
      [name.trim(), desc.trim(), Number(price), emoji || "📦", photo || "", Number(req.params.id), req.user.role, req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Product not found or not editable by this account." });
    res.json(productDto(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/products/:id", requireUser, requireSeller, async (req, res, next) => {
  try {
    const result = await pool.query(
      "delete from products where id=$1 and ($2='admin' or owner_id=$3)",
      [Number(req.params.id), req.user.role, req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Product not found or not editable by this account." });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/profile", requireUser, async (req, res, next) => {
  try {
    const result = await pool.query(
      "select gender, birthday, phone, address, avatar_data from profiles where user_id=$1",
      [req.user.id]
    );
    const row = result.rows[0] || {};
    res.json({
      name: req.user.name, email: req.user.email, gender: row.gender || "",
      birthday: row.birthday || "", phone: row.phone || "", address: row.address || "",
      pfp: row.avatar_data || ""
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/profile", requireUser, async (req, res, next) => {
  const { name, gender, birthday, phone, address, pfp } = req.body;
  if (typeof name !== "string" || !name.trim() || name.length > 100 ||
      typeof gender !== "string" || gender.length > 40 ||
      typeof phone !== "string" || phone.length > 40 ||
      typeof address !== "string" || address.length > 2000 ||
      !validImageData(pfp || "", 700000) ||
      (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday))) {
    return res.status(400).json({ error: "Enter valid profile details." });
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("update app_users set name=$1 where id=$2", [name.trim(), req.user.id]);
    await client.query(
      `insert into profiles(user_id, gender, birthday, phone, address, avatar_data, updated_at)
       values ($1, $2, nullif($3, '')::date, $4, $5, $6, now())
       on conflict(user_id) do update set gender=excluded.gender, birthday=excluded.birthday,
       phone=excluded.phone, address=excluded.address, avatar_data=excluded.avatar_data, updated_at=now()`,
      [req.user.id, gender, birthday || "", phone, address, pfp || ""]
    );
    await client.query("commit");
    res.json({ name: name.trim(), email: req.user.email, gender, birthday: birthday || "", phone, address, pfp: pfp || "" });
  } catch (error) {
    await client.query("rollback");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/api/address", requireUser, async (req, res, next) => {
  try {
    const result = await pool.query("select address, address_data from profiles where user_id=$1", [req.user.id]);
    const stored = result.rows[0]?.address_data;
    const data = typeof stored === "string" ? JSON.parse(stored) : (stored || {});
    res.json({ ...data, full: result.rows[0]?.address || "" });
  } catch (error) {
    next(error);
  }
});

app.put("/api/address", requireUser, async (req, res, next) => {
  const { name, phone, street, city, province, zip } = req.body;
  if (["name", "phone", "street", "city", "province", "zip"].some(field =>
    typeof req.body[field] !== "string" || req.body[field].length > 300) ||
    !street.trim() || !city.trim()) {
    return res.status(400).json({ error: "Street and city are required." });
  }
  const full = [name, phone, street, city, province, zip].map(value => value.trim()).filter(Boolean).join(", ");
  try {
    await pool.query(
      `insert into profiles(user_id, address, address_data) values ($1, $2, $3)
       on conflict(user_id) do update set address=excluded.address,
       address_data=excluded.address_data, updated_at=now()`,
      [req.user.id, full, JSON.stringify({ name, phone, street, city, province, zip, full })]
    );
    res.json({ name, phone, street, city, province, zip, full });
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders", requireUser, async (req, res, next) => {
  try {
    const result = req.user.role === "admin" || req.user.role === "seller"
      ? await pool.query("select * from orders order by created_at desc")
      : await pool.query("select * from orders where buyer_id=$1 order by created_at desc", [req.user.id]);
    res.json(result.rows.map(orderDto));
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders", requireUser, async (req, res, next) => {
  const { items, address, payment } = req.body;
  if (!Array.isArray(items) || !items.length || items.length > 100 ||
      typeof address !== "string" || !address.trim() || address.length > 2000 ||
      typeof payment !== "string" || payment.length > 80) {
    return res.status(400).json({ error: "Add items, a delivery address, and a payment method." });
  }
  const itemMap = new Map();
  for (const item of items) {
    const id = Number(item.id);
    const qty = Number(item.qty);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(qty) || qty < 1 || qty > 99) {
      return res.status(400).json({ error: "One or more cart items are invalid." });
    }
    itemMap.set(id, (itemMap.get(id) || 0) + qty);
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    const itemIds = [...itemMap.keys()];
    const productRows = await client.query(
      `select id, name, price, emoji from products where id in (${itemIds.map(() => "?").join(",")})`,
      itemIds
    );
    if (productRows.rowCount !== itemMap.size) {
      await client.query("rollback");
      return res.status(400).json({ error: "A cart item is no longer available. Refresh the catalog and try again." });
    }
    const orderItems = productRows.rows.map(product => ({
      id: Number(product.id), name: product.name, price: Number(product.price),
      emoji: product.emoji, qty: itemMap.get(Number(product.id))
    }));
    const total = orderItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    const id = `RR${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const inserted = await client.query(
      `insert into orders(id, buyer_id, buyer_email, buyer_name, items, total, delivery_address, payment_method)
       values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [id, req.user.id, req.user.email, req.user.name, JSON.stringify(orderItems), total, address.trim(), payment]
    );
    await client.query(
      "insert into notifications(user_id, body) values ($1, $2)",
      [req.user.id, `Order ${id} placed successfully.`]
    );
    await client.query("commit");
    const order = orderDto(inserted.rows[0]);
    let emailSent = false;
    try {
      emailSent = await notifyAdmin(
        `New Recast Republic order ${id}`,
        `Order: ${id}\nBuyer: ${req.user.name} (${req.user.email})\nTotal: PHP ${total}\nDelivery address: ${address.trim()}\nStatus: To Ship\nItems: ${JSON.stringify(orderItems)}`,
        req.user.email
      );
    } catch (emailError) {
      console.error("Could not send new-order admin email:", emailError.message);
    }
    res.status(201).json({ order, adminEmailSent: emailSent });
  } catch (error) {
    await client.query("rollback");
    next(error);
  } finally {
    client.release();
  }
});

app.patch("/api/orders/:id", requireUser, async (req, res, next) => {
  const { status } = req.body;
  const allowed = ["To Ship", "To Receive", "Completed", "Cancelled"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid order status." });
  const client = await pool.connect();
  let order;
  let updatedOrder;
  try {
    await client.query("begin");
    const current = await client.query("select * from orders where id=$1 for update", [req.params.id]);
    if (!current.rowCount) {
      await client.query("rollback");
      return res.status(404).json({ error: "Order not found." });
    }
    order = current.rows[0];
    const isBuyer = String(order.buyer_id) === String(req.user.id);
    const buyerCancel = isBuyer && order.status === "To Ship" && status === "Cancelled";
    const buyerReceived = isBuyer && order.status === "To Receive" && status === "Completed";
    const sellerUpdate = (req.user.role === "seller" || req.user.role === "admin") &&
      ["To Ship", "To Receive", "Completed", "Cancelled"].includes(status);
    if (!buyerCancel && !buyerReceived && !sellerUpdate) {
      await client.query("rollback");
      return res.status(403).json({ error: "You cannot change this order status." });
    }
    const updated = await client.query(
      "update orders set status=$1, updated_at=now() where id=$2 returning *",
      [status, req.params.id]
    );
    await client.query("insert into notifications(user_id, body) values ($1, $2)", [
      order.buyer_id, `Your order ${order.id} is now ${status}.`
    ]);
    await client.query("commit");
    updatedOrder = updated.rows[0];
  } catch (error) {
    await client.query("rollback");
    next(error);
    return;
  } finally {
    client.release();
  }
  try {
    const text = `Your order ${order.id} is now ${status}.`;
    let emailSent = false;
    try {
      emailSent = await notifyAdmin(
        `Order ${order.id} updated to ${status}`,
        `Order: ${order.id}\nBuyer: ${order.buyer_name} (${order.buyer_email})\nDelivery address: ${order.delivery_address}\nStatus: ${status}\nTotal: PHP ${order.total}`,
        order.buyer_email
      );
    } catch (emailError) {
      console.error("Could not send order-status admin email:", emailError.message);
    }
    res.json({ order: orderDto(updatedOrder), adminEmailSent: emailSent });
  } catch (error) {
    next(error);
  }
});

app.get("/api/notifications", requireUser, async (req, res, next) => {
  try {
    const result = await pool.query(
      "select body, created_at from notifications where user_id=$1 order by created_at desc limit 200",
      [req.user.id]
    );
    res.json(result.rows.map(row => ({ buyer: req.user.email, text: row.body, date: new Date(row.created_at).toLocaleString() })));
  } catch (error) {
    next(error);
  }
});

app.get("/api/messages", requireUser, async (req, res, next) => {
  try {
    const result = req.user.role === "admin" || req.user.role === "seller"
      ? await pool.query(
        `select m.*, u.email as buyer_email from messages m
         join app_users u on u.id=m.buyer_id order by m.created_at asc limit 5000`
      )
      : await pool.query(
        `select m.*, u.email as buyer_email from messages m
         join app_users u on u.id=m.buyer_id where m.buyer_id=$1 order by m.created_at asc`,
        [req.user.id]
      );
    res.json(result.rows.map(messageDto));
  } catch (error) {
    next(error);
  }
});

app.post("/api/messages", requireUser, async (req, res, next) => {
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  const buyerEmail = typeof req.body.buyer === "string" ? req.body.buyer.trim().toLowerCase() : "";
  if (!text || text.length > 5000) return res.status(400).json({ error: "Message must be 1–5000 characters." });
  if ((req.user.role === "seller" || req.user.role === "admin") && !validEmail(buyerEmail)) {
    return res.status(400).json({ error: "Choose a valid buyer conversation." });
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    let buyerId = req.user.id;
    if (req.user.role === "seller" || req.user.role === "admin") {
      const buyer = await client.query("select id from app_users where email=$1", [buyerEmail]);
      if (!buyer.rowCount) {
        await client.query("rollback");
        return res.status(404).json({ error: "Buyer account not found." });
      }
      buyerId = buyer.rows[0].id;
    }
    const result = await client.query(
      `insert into messages(buyer_id, sender_id, sender_role, body)
       values ($1,$2,$3,$4)
       returning id, buyer_id, sender_id, sender_role, body, created_at`,
      [buyerId, req.user.id, req.user.role, text]
    );
    if (req.user.role !== "buyer") {
      await client.query(
        "insert into notifications(user_id, body) values ($1, $2)",
        [buyerId, "The seller replied to your message."]
      );
    }
    const buyer = await client.query("select email from app_users where id=$1", [buyerId]);
    await client.query("commit");
    let emailSent = false;
    try {
      emailSent = await notifyAdmin(
        `New Recast Republic ${req.user.role === "buyer" ? "customer" : "seller"} message`,
        `From: ${req.user.name} (${req.user.email})\nCustomer: ${buyer.rows[0].email}\nMessage: ${text}`,
        req.user.role === "buyer" ? req.user.email : buyer.rows[0].email
      );
    } catch (emailError) {
      console.error("Could not send message admin email:", emailError.message);
    }
    res.status(201).json({
      ...messageDto({ ...result.rows[0], buyer_email: buyer.rows[0].email }),
      adminEmailSent: emailSent
    });
  } catch (error) {
    await client.query("rollback");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/api/admin/export", requireUser, requireAdmin, async (req, res, next) => {
  try {
    const [users, profiles, orders, messages, products, notifications] = await Promise.all([
      pool.query("select id, email, name, role, privacy_consent_at, created_at from app_users order by created_at desc"),
      pool.query(
        `select u.email, p.gender, p.birthday, p.phone, p.address, p.address_data, p.avatar_data, p.updated_at
         from profiles p join app_users u on u.id=p.user_id order by p.updated_at desc`
      ),
      pool.query("select * from orders order by created_at desc"),
      pool.query(
        `select u.email as buyer_email, m.sender_role, m.body, m.created_at
         from messages m join app_users u on u.id=m.buyer_id order by m.created_at desc`
      ),
      pool.query("select id, owner_id, name, description, price, emoji, photo_data, created_at from products order by created_at desc"),
      pool.query(
        `select u.email, n.body, n.created_at, n.read_at
         from notifications n join app_users u on u.id=n.user_id order by n.created_at desc`
      )
    ]);
    res.json({
      generatedAt: new Date().toISOString(),
      users: users.rows,
      profiles: profiles.rows,
      orders: orders.rows.map(orderDto),
      messages: messages.rows.map(row => ({
        buyer: row.buyer_email, sender: row.sender_role, text: row.body, date: row.created_at
      })),
      products: products.rows,
      notifications: notifications.rows
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/restore-products", requireUser, requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from products");
    for (const [id, name, price, emoji, description] of DEFAULT_PRODUCTS) {
      await client.query(
        "insert into products(id, name, price, emoji, description) values($1,$2,$3,$4,$5)",
        [id, name, price, emoji, description]
      );
    }
    await client.query("commit");
    const result = await client.query(
      "select id, name, description, price, emoji, photo_data from products order by id"
    );
    res.json(result.rows.map(productDto));
  } catch (error) {
    await client.query("rollback");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/api-config.js", (req, res) => {
  res.type("application/javascript").sendFile(path.join(__dirname, "api-config.js"));
});
app.use((req, res) => res.status(404).json({ error: "Not found." }));
app.use((error, req, res, next) => {
  console.error("API request failed:", error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "The server could not complete the request. Please try again." });
});

async function start() {
  database.exec(fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf8"));
  const count = await pool.query("select count(*) as count from products");
  if (count.rows[0].count === 0) {
    for (const [id, name, price, emoji, description] of DEFAULT_PRODUCTS) {
      await pool.query(
        `insert into products(id, name, price, emoji, description)
         values($1, $2, $3, $4, $5) on conflict(id) do nothing`,
        [id, name, price, emoji, description]
      );
    }
  }
  const server = app.listen(PORT, HOST, () => console.log(`Recast Republic listening on http://${HOST}:${PORT}`));
  const shutdown = () => server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch(error => {
  console.error("Server startup failed:", error);
  process.exit(1);
});