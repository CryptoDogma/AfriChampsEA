const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
app.use(cors());
app.use(express.json());

// Render persistent disk example: /data
const DB_PATH = process.env.DB_PATH || "/data/vip.sqlite";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "CHANGE_ME_NOW";

const db = new Database(DB_PATH);

// --- Ensure base table exists (old installs may not have tier column yet)
db.exec(`
  CREATE TABLE IF NOT EXISTS vip_accounts (
    login TEXT PRIMARY KEY,
    note  TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

function hasColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => String(c.name).toLowerCase() === String(column).toLowerCase());
}

// Migration: add tier column if missing (for older DBs)
if (!hasColumn("vip_accounts", "tier")) {
  console.log("🔧 Migrating DB: adding tier column...");
  db.exec(`ALTER TABLE vip_accounts ADD COLUMN tier TEXT NOT NULL DEFAULT 'VIP';`);
}

// Create index after ensuring the column exists
db.exec(`CREATE INDEX IF NOT EXISTS idx_vip_accounts_tier ON vip_accounts (tier);`);

// Create table
db.exec(`
  CREATE TABLE IF NOT EXISTS vip_accounts (
    login TEXT PRIMARY KEY,
    tier  TEXT NOT NULL DEFAULT 'VIP',
    note  TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_vip_accounts_tier ON vip_accounts (tier);
`);

function requireAdmin(req, res, next) {
  const secret = req.headers["x-admin-secret"];
  if (!secret || secret !== ADMIN_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

// Health check
app.get("/", (req, res) => res.send("VIP API is running ✅"));

// EA check endpoint (public)
const TIER_RANK = {
  AFFILIATE: 1,
  VIP: 2,
  MASTER: 3,
  ELITE: 4
};

function normalizeTier(t) {
  return String(t || "").trim().toUpperCase();
}

// EA check endpoint with hierarchy:
// /api/check/123456?tier=VIP  -> allow if client's tier rank >= VIP rank
app.get("/api/check/:login", (req, res) => {
  const login = String(req.params.login || "").trim();
  const requiredTier = normalizeTier(req.query.tier || "AFFILIATE"); // default lowest

  if (!login) return res.status(400).json({ ok: false, allowed: false, error: "Missing login" });
  if (!TIER_RANK[requiredTier]) {
    return res.status(400).json({ ok: false, allowed: false, error: "Invalid required tier" });
  }

  const row = db.prepare("SELECT login, tier FROM vip_accounts WHERE login = ?").get(login);

  if (!row) {
    return res.json({
      ok: true,
      allowed: false,
      reason: "NOT_FOUND",
      login,
      requiredTier
    });
  }

  const userTier = normalizeTier(row.tier);
  const userRank = TIER_RANK[userTier] || 0;
  const reqRank = TIER_RANK[requiredTier];

  const allowed = userRank >= reqRank;

  return res.json({
    ok: true,
    allowed,
    login,
    userTier,
    requiredTier,
    userRank,
    requiredRank: reqRank
  });
});

// Admin list
app.get("/api/admin/list", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT login, note, created_at FROM vip_accounts ORDER BY created_at DESC").all();
  res.json({ ok: true, rows });
});

// Admin add
app.post("/api/admin/add", requireAdmin, (req, res) => {
  const login = String(req.body.login || "").trim();
  const note = String(req.body.note || "").trim();
  if (!login) return res.status(400).json({ ok: false, error: "Missing login" });

  try {
    db.prepare("INSERT OR REPLACE INTO vip_accounts (login, note) VALUES (?, ?)").run(login, note);
    res.json({ ok: true, added: login });
  } catch (e) {
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

// Admin remove
app.post("/api/admin/remove", requireAdmin, (req, res) => {
  const login = String(req.body.login || "").trim();
  if (!login) return res.status(400).json({ ok: false, error: "Missing login" });

  db.prepare("DELETE FROM vip_accounts WHERE login = ?").run(login);
  res.json({ ok: true, removed: login });
});

// Serve the admin UI (optional)
app.use("/admin", express.static(path.join(__dirname, "admin")));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("VIP API listening on", PORT));



