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

// Create table
db.exec(`
  CREATE TABLE IF NOT EXISTS vip_accounts (
    login TEXT PRIMARY KEY,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
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
app.get("/api/check/:login", (req, res) => {
  const login = String(req.params.login || "").trim();
  if (!login) return res.status(400).json({ ok: false, vip: false, error: "Missing login" });

  const row = db.prepare("SELECT login FROM vip_accounts WHERE login = ?").get(login);
  return res.json({ ok: true, vip: !!row, login });
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
