const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
app.use(cors());
app.use(express.json());

// Render persistent disk
const DB_PATH = process.env.DB_PATH || "/data/vip.sqlite";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "CHANGE_ME_NOW";

const db = new Database(DB_PATH);

// ----- Tier logic
const TIER_RANK = {
  AFFILIATE: 1,
  VIP: 2,
  MASTER: 3,
  ELITE: 4
};
const VALID_TIERS = Object.keys(TIER_RANK);

function normalizeTier(t) {
  return String(t || "").trim().toUpperCase();
}

function hasColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => String(c.name).toLowerCase() === String(column).toLowerCase());
}

// ----- Create base table (old format)
db.exec(`
  CREATE TABLE IF NOT EXISTS vip_accounts (
    login TEXT PRIMARY KEY,
    note  TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ----- Migration: add tier if missing (old DBs)
if (!hasColumn("vip_accounts", "tier")) {
  console.log("🔧 Migrating DB: adding tier column...");
  db.exec(`ALTER TABLE vip_accounts ADD COLUMN tier TEXT NOT NULL DEFAULT 'AFFILIATE';`);
}

// ----- Backfill: if any tier is blank/null, set to AFFILIATE
db.prepare(`
  UPDATE vip_accounts
  SET tier = 'AFFILIATE'
  WHERE tier IS NULL OR TRIM(tier) = ''
`).run();

console.log("✅ DB ready (tier enabled).");

// Index after tier exists
db.exec(`CREATE INDEX IF NOT EXISTS idx_vip_accounts_tier ON vip_accounts (tier);`);

function requireAdmin(req, res, next) {
  const secret = req.headers["x-admin-secret"];
  if (!secret || secret !== ADMIN_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

// Health check
app.get("/", (req, res) => res.send("VIP API is running ✅"));

// ----- EA check endpoint with hierarchy
// /api/check/123456?tier=VIP -> allowed if userRank >= requiredRank
app.get("/api/check/:login", (req, res) => {
  const login = String(req.params.login || "").trim();
  const requiredTier = normalizeTier(req.query.tier || "AFFILIATE");

  if (!login) return res.status(400).json({ ok: false, allowed: false, error: "Missing login" });
  if (!TIER_RANK[requiredTier]) {
    return res.status(400).json({ ok: false, allowed: false, error: "Invalid required tier" });
  }

  const row = db.prepare("SELECT login, tier FROM vip_accounts WHERE login = ?").get(login);

  if (!row) {
    return res.json({
      allowed: false,
      reason: "NOT_FOUND",
      login,
      requiredTier
    });
  }

  const userTier = normalizeTier(row.tier);
  const userRank = TIER_RANK[userTier] || 0;
  const requiredRank = TIER_RANK[requiredTier];

  const allowed = userRank >= requiredRank;

  return res.json({
    ok: true,
    allowed,
    login,
    userTier,
    requiredTier,
    userRank,
    requiredRank
  });
});

// ----- Admin list (returns tier)
app.get("/api/admin/list", requireAdmin, (req, res) => {
  const tierQ = normalizeTier(req.query.tier || "");
  let rows;

  if (tierQ) {
    rows = db.prepare(
      "SELECT login, tier, note, created_at FROM vip_accounts WHERE UPPER(tier)=? ORDER BY created_at DESC"
    ).all(tierQ);
  } else {
    rows = db.prepare(
      "SELECT login, tier, note, created_at FROM vip_accounts ORDER BY created_at DESC"
    ).all();
  }

  res.json({ ok: true, rows });
});

// ----- Admin add (saves tier)
app.post("/api/admin/add", requireAdmin, (req, res) => {
  const login = String(req.body.login || "").trim();
  const tier = normalizeTier(req.body.tier || "AFFILIATE");
  const note = String(req.body.note || "").trim();

  if (!login) return res.status(400).json({ ok: false, error: "Missing login" });
  if (!VALID_TIERS.includes(tier)) return res.status(400).json({ ok: false, error: "Invalid tier" });

  try {
    db.prepare("INSERT OR REPLACE INTO vip_accounts (login, tier, note) VALUES (?, ?, ?)")
      .run(login, tier, note);

    res.json({ ok: true, added: login, tier });
  } catch (e) {
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

// ----- Admin remove
app.post("/api/admin/remove", requireAdmin, (req, res) => {
  const login = String(req.body.login || "").trim();
  if (!login) return res.status(400).json({ ok: false, error: "Missing login" });

  db.prepare("DELETE FROM vip_accounts WHERE login = ?").run(login);
  res.json({ ok: true, removed: login });
});

// Serve admin UI
app.use("/admin", express.static(path.join(__dirname, "admin")));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("VIP API listening on", PORT));

