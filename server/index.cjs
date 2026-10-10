const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const seed = require('../shared/seed.json');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const DATA_FILE = process.env.HOTEL_DATA_FILE || path.join(__dirname, '..', '.hotel-data.json');
let state = structuredClone(seed);
let version = 1;

app.use(express.json({ limit: '20mb' }));

function mergeState(incoming = {}) {
  const base = structuredClone(seed);
  const merged = { ...base, ...(incoming && typeof incoming === 'object' ? incoming : {}) };
  for (const key of ['rooms', 'tables', 'categories', 'menuItems', 'qrOrders', 'receipts', 'staff']) {
    if (!Array.isArray(merged[key])) merged[key] = base[key];
  }
  if (!merged.receiptTemplate || typeof merged.receiptTemplate !== 'object') merged.receiptTemplate = base.receiptTemplate;
  if (!Number.isFinite(Number(merged.receiptSequence))) merged.receiptSequence = 1;
  return merged;
}

async function persist() {
  const temporary = `${DATA_FILE}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(temporary, DATA_FILE);
}

async function load() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    state = mergeState(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read hotel data; using the starter data.', error);
    state = structuredClone(seed);
    await persist();
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/state', (_req, res) => res.json({ state, version }));

app.put('/api/state', async (req, res, next) => {
  try {
    state = mergeState(req.body?.state ?? req.body);
    version += 1;
    await persist();
    res.json({ state, version });
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.targetId || !Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ error: 'An order needs a target and at least one item.' });
    }
    const order = {
      id: `qr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      targetId: String(body.targetId),
      targetType: body.targetType === 'room' ? 'room' : 'table',
      targetLabel: String(body.targetLabel || 'Table'),
      items: body.items.map((item) => ({
        id: String(item.id || `line-${Math.random().toString(36).slice(2, 8)}`),
        menuItemId: String(item.menuItemId || ''),
        name: String(item.name || 'Menu item'),
        qty: Math.max(1, Number(item.qty) || 1),
        unitPrice: Math.max(0, Number(item.unitPrice) || 0),
      })),
      createdAt: new Date().toISOString(),
      status: 'new',
    };
    state.qrOrders.push(order);
    version += 1;
    await persist();
    res.status(201).json({ order, state, version });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/orders/:id', async (req, res, next) => {
  try {
    const order = state.qrOrders.find((entry) => entry.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (req.body?.status) order.status = String(req.body.status);
    version += 1;
    await persist();
    res.json({ order, state, version });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/orders/:id', async (req, res, next) => {
  try {
    state.qrOrders = state.qrOrders.filter((entry) => entry.id !== req.params.id);
    version += 1;
    await persist();
    res.json({ state, version });
  } catch (error) {
    next(error);
  }
});

const distDirectory = path.join(__dirname, '..', 'dist');
app.use(express.static(distDirectory));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distDirectory, 'index.html'), (error) => {
    if (error) next();
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'The hotel server could not save that change.' });
});

load().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hotel API ready on 0.0.0.0:${PORT}`);
  });
}).catch((error) => {
  console.error('Failed to initialize hotel data.', error);
  process.exit(1);
});
