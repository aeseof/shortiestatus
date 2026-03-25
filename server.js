/**
 * shortie.xo.je — Status Page API
 * Run: node server.js
 * Env vars: API_KEY, PORT (optional)
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── CONFIG ──────────────────────────────────────────────────
const API_KEY      = process.env.API_KEY || 'change-me-before-deploy';
const DATA_FILE    = path.join(__dirname, 'status-data.json');
const MAX_HISTORY  = 90; // days to keep

const STATUS_TYPES = ['operational', 'degraded', 'outage', 'maintenance'];

// ── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve status page frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

// ── DATA HELPERS ─────────────────────────────────────────────
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return defaultData();
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function defaultData() {
  return {
    current: {
      status: 'operational',
      message: 'All systems operational.',
      updated_at: new Date().toISOString()
    },
    services: [
      { id: 'api',      name: 'API',           status: 'operational' },
      { id: 'frontend', name: 'Frontend',       status: 'operational' },
      { id: 'redirect', name: 'Link Redirect',  status: 'operational' },
      { id: 'auth',     name: 'Auth / Accounts',status: 'operational' },
    ],
    history: []   // array of { date, status, note }
  };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function recordHistory(data) {
  const today = todayISO();
  // Worst status of the day wins
  const existing = data.history.find(h => h.date === today);
  const rank = { operational: 0, maintenance: 1, degraded: 2, outage: 3 };
  const incomingRank = rank[data.current.status] ?? 0;

  if (!existing) {
    data.history.push({ date: today, status: data.current.status, note: data.current.message });
  } else if ((rank[existing.status] ?? 0) < incomingRank) {
    existing.status = data.current.status;
    existing.note   = data.current.message;
  }

  // Trim to MAX_HISTORY days
  data.history.sort((a, b) => b.date.localeCompare(a.date));
  data.history = data.history.slice(0, MAX_HISTORY);
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────────
function requireKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (!key || key !== API_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

// ── PUBLIC ROUTES ─────────────────────────────────────────────

// GET /api/status  — full public read
app.get('/api/status', (req, res) => {
  const data = loadData();
  res.json({
    ok: true,
    current:  data.current,
    services: data.services,
    history:  data.history
  });
});

// ── PRIVATE ROUTES (require API key) ─────────────────────────

// POST /api/status/update
// Body: { status, message, services?: [{id, name, status}] }
app.post('/api/status/update', requireKey, (req, res) => {
  const { status, message, services } = req.body;

  if (!status || !STATUS_TYPES.includes(status)) {
    return res.status(400).json({ ok: false, error: `status must be one of: ${STATUS_TYPES.join(', ')}` });
  }

  const data = loadData();

  data.current = {
    status,
    message: message || '',
    updated_at: new Date().toISOString()
  };

  if (Array.isArray(services)) {
    services.forEach(svc => {
      const existing = data.services.find(s => s.id === svc.id);
      if (existing) {
        if (svc.status && STATUS_TYPES.includes(svc.status)) existing.status = svc.status;
        if (svc.name) existing.name = svc.name;
      } else {
        data.services.push({ id: svc.id, name: svc.name || svc.id, status: svc.status || 'operational' });
      }
    });
  }

  recordHistory(data);
  saveData(data);

  res.json({ ok: true, data: data.current });
});

// PATCH /api/status/service/:id  — update a single service
app.patch('/api/status/service/:id', requireKey, (req, res) => {
  const { id } = req.params;
  const { status, name } = req.body;

  if (status && !STATUS_TYPES.includes(status)) {
    return res.status(400).json({ ok: false, error: `Invalid status` });
  }

  const data = loadData();
  let svc = data.services.find(s => s.id === id);

  if (!svc) {
    svc = { id, name: name || id, status: status || 'operational' };
    data.services.push(svc);
  } else {
    if (status) svc.status = status;
    if (name)   svc.name   = name;
  }

  saveData(data);
  res.json({ ok: true, service: svc });
});

// DELETE /api/status/history  — clear history
app.delete('/api/status/history', requireKey, (req, res) => {
  const data = loadData();
  data.history = [];
  saveData(data);
  res.json({ ok: true });
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  shortie status API  →  http://localhost:${PORT}`);
  console.log(`  API key             →  ${API_KEY}`);
  console.log(`  Status page         →  http://localhost:${PORT}/\n`);
});
