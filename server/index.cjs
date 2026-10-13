const express = require('express');
const path = require('node:path');
const dbModule = require('./db.cjs');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const distDirectory = path.join(__dirname, '..', 'dist');

app.use(express.json({ limit: '20mb' }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Auth middleware
async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const db = await dbModule.getDatabase();
    const session = dbModule.validateSession(db, token);
    if (!session) return res.status(401).json({ error: 'Session expired or invalid' });
    req.user = session;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Helper
async function getDB() {
  return await dbModule.getDatabase();
}

// ============================================================
// Health & Auth
// ============================================================

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

    const db = await getDB();
    const result = db.exec(
      `SELECT id, username, password_hash, password_salt, name, role, active FROM staff WHERE username = ? AND active = 1`,
      [String(username).trim()]
    );

    if (!result.length || !result[0].values.length) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const cols = result[0].columns;
    const vals = result[0].values[0];
    const staff = {};
    cols.forEach((c, i) => staff[c] = vals[i]);

    if (!dbModule.verifyPassword(password, staff.password_hash, staff.password_salt)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    db.run(`UPDATE staff SET last_login_at = ? WHERE id = ?`, [new Date().toISOString(), staff.id]);

    const token = dbModule.createSession(db, staff.id);
    await dbModule.logAudit(db, 'login', 'auth', { username: staff.username }, staff.name);
    dbModule.persistSync(db);

    res.json({
      token,
      staff: { id: staff.id, username: staff.username, name: staff.name, role: staff.role },
    });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', requireAuth, async (req, res, next) => {
  try {
    const token = req.headers.authorization.replace('Bearer ', '');
    const db = await getDB();
    dbModule.destroySession(db, token);
    await dbModule.logAudit(db, 'logout', 'auth', {}, req.user.name);
    dbModule.persistSync(db);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({
    staff: { id: req.user.staff_id, username: req.user.username, name: req.user.name, role: req.user.role },
  });
});

app.post('/api/auth/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const db = await getDB();
    const result = db.exec(`SELECT password_hash, password_salt FROM staff WHERE id = ?`, [req.user.staff_id]);
    const cols = result[0].columns;
    const vals = result[0].values[0];
    const staff = {};
    cols.forEach((c, i) => staff[c] = vals[i]);

    if (!dbModule.verifyPassword(currentPassword, staff.password_hash, staff.password_salt)) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const { hash, salt } = dbModule.hashPassword(newPassword);
    db.run(`UPDATE staff SET password_hash = ?, password_salt = ? WHERE id = ?`,
      [hash, salt, req.user.staff_id]);
    await dbModule.logAudit(db, 'change_password', 'auth', {}, req.user.name);
    dbModule.persistSync(db);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// ============================================================
// Staff
// ============================================================

app.get('/api/staff', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const db = await getDB();
    const result = db.exec(`SELECT id, username, name, role, active, created_at, last_login_at FROM staff ORDER BY name`);
    const staff = [];
    if (result.length) {
      const cols = result[0].columns;
      for (const row of result[0].values) {
        const s = {}; cols.forEach((c, i) => s[c] = row[i]); staff.push(s);
      }
    }
    res.json({ staff });
  } catch (error) { next(error); }
});

app.post('/api/staff', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { username, name, role, password } = req.body || {};
    if (!username || !name || !role || !password) return res.status(400).json({ error: 'All fields required.' });
    if (!['Admin', 'Cashier'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const db = await getDB();
    const existing = db.exec(`SELECT id FROM staff WHERE username = ?`, [username.trim()]);
    if (existing.length && existing[0].values.length) return res.status(409).json({ error: 'Username exists.' });

    const id = `staff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const { hash, salt } = dbModule.hashPassword(password);
    const now = new Date().toISOString();

    db.run(`INSERT INTO staff (id, username, password_hash, password_salt, name, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, username.trim(), hash, salt, name.trim(), role, now]);
    await dbModule.logAudit(db, 'create_staff', 'staff', { username: username.trim(), role }, req.user.name);
    dbModule.persistSync(db);

    res.status(201).json({ id, username: username.trim(), name: name.trim(), role, active: true, created_at: now });
  } catch (error) { next(error); }
});

app.patch('/api/staff/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name, role, active, password } = req.body || {};
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (role !== undefined) {
      if (!['Admin', 'Cashier'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
      updates.push('role = ?'); params.push(role);
    }
    if (active !== undefined) { updates.push('active = ?'); params.push(active ? 1 : 0); }
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      const { hash, salt } = dbModule.hashPassword(password);
      updates.push('password_hash = ?'); params.push(hash);
      updates.push('password_salt = ?'); params.push(salt);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No changes.' });

    const db = await getDB();
    params.push(req.params.id);
    db.run(`UPDATE staff SET ${updates.join(', ')} WHERE id = ?`, params);
    await dbModule.logAudit(db, 'update_staff', 'staff', { staff_id: req.params.id }, req.user.name);
    dbModule.persistSync(db);

    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.delete('/api/staff/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const db = await getDB();
    if (req.params.id === req.user.staff_id) return res.status(400).json({ error: 'Cannot delete your own account.' });
    db.run(`DELETE FROM staff WHERE id = ? AND id != ?`, [req.params.id, req.user.staff_id]);
    await dbModule.logAudit(db, 'delete_staff', 'staff', { staff_id: req.params.id }, req.user.name);
    dbModule.persistSync(db);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// ============================================================
// Rooms
// ============================================================

app.get('/api/rooms', requireAuth, async (req, res, next) => {
  try {
    const db = await getDB();
    const result = db.exec(`SELECT * FROM rooms ORDER BY number`);
    const rooms = [];
    if (result.length) {
      const cols = result[0].columns;
      for (const row of result[0].values) {
        const r = {}; cols.forEach((c, i) => r[c] = row[i]);
        if (r.status === 'occupied') {
          const stayResult = db.exec(`SELECT * FROM stays WHERE room_id = ? AND status = 'active'`, [r.id]);
          if (stayResult.length && stayResult[0].values.length) {
            const sc = stayResult[0].columns;
            const sv = stayResult[0].values[0];
            const stay = {}; sc.forEach((c, i) => stay[c] = sv[i]);
            r.stay = stay;
            r.guest = {
              name: stay.guest_name, phone: stay.guest_phone, email: stay.guest_email,
              nationality: stay.guest_nationality, documentId: stay.guest_document_id,
              guests: stay.guest_count, notes: stay.guest_notes,
            };
            r.checkInAt = stay.check_in_at;
            r.ratePerNight = stay.rate_per_night;
            r.currency = stay.currency;
            r.addons = JSON.parse(stay.addons_json || '[]');
          }
        }
        rooms.push(r);
      }
    }
    res.json({ rooms });
  } catch (error) { next(error); }
});

app.post('/api/rooms', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { number, type, defaultRate } = req.body || {};
    if (!number) return res.status(400).json({ error: 'Room number required.' });

    const db = await getDB();
    const existing = db.exec(`SELECT id FROM rooms WHERE number = ?`, [String(number).trim()]);
    if (existing.length && existing[0].values.length) return res.status(409).json({ error: 'Room number exists.' });

    const id = `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    db.run(`INSERT INTO rooms (id, number, type, default_rate, status, created_at) VALUES (?, ?, ?, ?, 'available', ?)`,
      [id, String(number).trim(), type || 'Standard twin', Number(defaultRate) || 0, new Date().toISOString()]);
    await dbModule.logAudit(db, 'create_room', 'rooms', { number }, req.user.name);
    dbModule.persistSync(db);

    res.status(201).json({ id, number: String(number).trim(), type: type || 'Standard twin', defaultRate: Number(defaultRate) || 0, status: 'available' });
  } catch (error) { next(error); }
});

app.patch('/api/rooms/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { number, type, defaultRate } = req.body || {};
    const updates = [];
    const params = [];
    if (number !== undefined) { updates.push('number = ?'); params.push(String(number).trim()); }
    if (type !== undefined) { updates.push('type = ?'); params.push(type); }
    if (defaultRate !== undefined) { updates.push('default_rate = ?'); params.push(Number(defaultRate)); }
    if (updates.length === 0) return res.status(400).json({ error: 'No changes.' });

    const db = await getDB();
    params.push(req.params.id);
    db.run(`UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`, params);
    await dbModule.logAudit(db, 'update_room', 'rooms', { room_id: req.params.id }, req.user.name);
    dbModule.persistSync(db);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.delete('/api/rooms/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const db = await getDB();
    const room = db.exec(`SELECT status FROM rooms WHERE id = ?`, [req.params.id]);
    if (room.length && room[0].values[0][0] === 'occupied') return res.status(400).json({ error: 'Check out guest first.' });
    db.run(`DELETE FROM rooms WHERE id = ?`, [req.params.id]);
    await dbModule.logAudit(db, 'delete_room', 'rooms', { room_id: req.params.id }, req.user.name);
    dbModule.persistSync(db);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// ============================================================
// Check-in / Check-out
// ============================================================

app.post('/api/checkin', requireAuth, async (req, res, next) => {
  try {
    const { roomId, guest, ratePerNight, currency } = req.body || {};
    if (!roomId || !guest?.name || !guest?.phone) return res.status(400).json({ error: 'Room, guest name and phone required.' });
    if (!(Number(ratePerNight) > 0)) return res.status(400).json({ error: 'Rate must be greater than zero.' });

    const db = await getDB();
    const room = db.exec(`SELECT status FROM rooms WHERE id = ?`, [roomId]);
    if (!room.length || !room[0].values.length) return res.status(404).json({ error: 'Room not found.' });
    if (room[0].values[0][0] !== 'available') return res.status(400).json({ error: 'Room not available.' });

    const stayId = `stay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    db.run(`INSERT INTO stays (id, room_id, guest_name, guest_phone, guest_email, guest_nationality, guest_document_id, guest_count, guest_notes, check_in_at, rate_per_night, currency, addons_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'active')`,
      [stayId, roomId, guest.name.trim(), (guest.phone || '').trim(), guest.email || '', guest.nationality || '',
       guest.documentId || '', Number(guest.guests) || 1, guest.notes || '', new Date().toISOString(), Number(ratePerNight), currency || 'ETB']);

    db.run(`UPDATE rooms SET status = 'occupied' WHERE id = ?`, [roomId]);
    await dbModule.logAudit(db, 'checkin', 'stays', { room_id: roomId, guest: guest.name }, req.user.name);
    dbModule.persistSync(db);

    res.status(201).json({ ok: true, stayId });
  } catch (error) { next(error); }
});

app.post('/api/checkout', requireAuth, async (req, res, next) => {
  try {
    const { roomId } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'Room ID required.' });

    const db = await getDB();
    db.run(`UPDATE stays SET status = 'checked_out' WHERE room_id = ? AND status = 'active'`, [roomId]);
    db.run(`UPDATE rooms SET status = 'available' WHERE id = ?`, [roomId]);
    await dbModule.logAudit(db, 'checkout', 'stays', { room_id: roomId }, req.user.name);
    dbModule.persistSync(db);

    res.json({ ok: true });
  } catch (error) { next(error); }
});

// ============================================================
// Orders
// ============================================================

app.get('/api/orders', requireAuth, async (req, res, next) => {
  try {
    const db = await getDB();
    const result = db.exec(`SELECT * FROM orders WHERE status != 'completed' ORDER BY created_at DESC`);
    const orders = [];
    if (result.length) {
      const cols = result[0].columns;
      for (const row of result[0].values) {
        const o = {}; cols.forEach((c, i) => o[c] = row[i]);
        o.items = JSON.parse(o.items_json || '[]');
        delete o.items_json;
        orders.push(o);
      }
    }
    res.json({ orders });
  } catch (error) { next(error); }
});

app.post('/api/orders', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.targetId || !Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ error: 'Order needs target and items.' });
    }

    const db = await getDB();
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

    db.run(`INSERT INTO orders (id, target_id, target_type, target_label, items_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [order.id, order.targetId, order.targetType, order.targetLabel, JSON.stringify(order.items), order.status, order.createdAt]);
    await dbModule.logAudit(db, 'new_order', 'orders', { order_id: order.id, target: order.targetLabel }, body.guestName || 'QR Guest');
    dbModule.persistSync(db);

    res.status(201).json({ order });
  } catch (error) { next(error); }
});

app.patch('/api/orders/:id', requireAuth, async (req, res, next) => {
  try {
    const db = await getDB();
    if (req.body?.status) {
      db.run(`UPDATE orders SET status = ?, completed_at = ? WHERE id = ?`,
        [String(req.body.status), req.body.status === 'completed' ? new Date().toISOString() : null, req.params.id]);
    }
    dbModule.persistSync(db);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.delete('/api/orders/:id', requireAuth, async (req, res, next) => {
  try {
    const db = await getDB();
    db.run(`DELETE FROM orders WHERE id = ?`, [req.params.id]);
    dbModule.persistSync(db);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// ============================================================
// Receipts
// ============================================================

app.get('/api/receipts', requireAuth, async (req, res, next) => {
  try {
    const db = await getDB();
    const result = db.exec(`SELECT * FROM receipts ORDER BY printed_at DESC`);
    const receipts = [];
    if (result.length) {
      const cols = result[0].columns;
      for (const row of result[0].values) {
        const r = {}; cols.forEach((c, i) => r[c] = row[i]);
        r.lines = JSON.parse(r.lines_json || '[]');
        r.currencyTotals = JSON.parse(r.currency_totals_json || '[]');
        r.template = JSON.parse(r.template_json || '{}');
        r.printEvents = [{ at: r.last_printed_at, by: r.last_printed_by }];
        delete r.lines_json; delete r.currency_totals_json; delete r.template_json;
        receipts.push(r);
      }
    }
    res.json({ receipts });
  } catch (error) { next(error); }
});

app.post('/api/receipts', requireAuth, async (req, res, next) => {
  try {
    const data = req.body || {};
    if (!data.lines || !data.lines.length) return res.status(400).json({ error: 'Receipt needs lines.' });

    const db = await getDB();
    const seqResult = db.exec(`SELECT sequence FROM receipt_sequence WHERE id = 1`);
    const sequence = seqResult.length ? seqResult[0].values[0][0] : 1;
    const nextSeq = sequence + 1;

    const date = new Date();
    const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const invoiceNo = `INV-${day}-${String(sequence).padStart(4, '0')}`;
    const orderNo = `ORD-${String(sequence).padStart(5, '0')}`;

    const currencyTotalsMap = new Map();
    data.lines.forEach((line) => {
      const currency = line.currency || 'ETB';
      currencyTotalsMap.set(currency, (currencyTotalsMap.get(currency) || 0) + Number(line.amount || 0));
    });
    const currencyTotals = [...currencyTotalsMap.entries()].map(([currency, amount]) => ({ currency, amount }));

    const id = `receipt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    db.run(`INSERT INTO receipts (id, invoice_no, order_no, printed_at, printed_by, waiter, table_label, guest_name, entity_type, payment_method, room_days, room_rate, room_currency, lines_json, currency_totals_json, item_count, template_json, print_count, last_printed_at, last_printed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, invoiceNo, orderNo, date.toISOString(), req.user.name, data.waiter || req.user.name,
       data.tableLabel || '', data.guestName || 'Walk-in guest', data.entityType || 'table', data.paymentMethod || 'Cash',
       data.roomDays || 0, data.roomRate || 0, data.roomCurrency || 'ETB',
       JSON.stringify(data.lines), JSON.stringify(currencyTotals),
       data.lines.reduce((sum, l) => sum + Math.max(0, Number(l.qty) || 0), 0),
       JSON.stringify(data.template || {}),
       date.toISOString(), req.user.name]);

    db.run(`UPDATE receipt_sequence SET sequence = ? WHERE id = 1`, [nextSeq]);

    if (data.releaseRoomId) {
      db.run(`UPDATE stays SET status = 'checked_out' WHERE room_id = ? AND status = 'active'`, [data.releaseRoomId]);
      db.run(`UPDATE rooms SET status = 'available' WHERE id = ?`, [data.releaseRoomId]);
    }
    if (data.removeOrderId) {
      db.run(`UPDATE orders SET status = 'completed', completed_at = ? WHERE id = ?`, [date.toISOString(), data.removeOrderId]);
    }

    await dbModule.logAudit(db, 'print_receipt', 'receipts', { invoice_no: invoiceNo }, req.user.name);
    dbModule.persistSync(db);

    res.status(201).json({
      id, invoiceNo, orderNo, printedAt: date.toISOString(), printedBy: req.user.name,
      waiter: data.waiter || req.user.name, tableLabel: data.tableLabel || '',
      guestName: data.guestName || 'Walk-in guest', entityType: data.entityType || 'table',
      paymentMethod: data.paymentMethod || 'Cash', roomDays: data.roomDays || 0,
      roomRate: data.roomRate || 0, roomCurrency: data.roomCurrency || 'ETB',
      lines: data.lines, currencyTotals,
      itemCount: data.lines.reduce((sum, l) => sum + Math.max(0, Number(l.qty) || 0), 0),
      template: data.template || {}, printCount: 1,
      lastPrintedAt: date.toISOString(), lastPrintedBy: req.user.name,
      printEvents: [{ at: date.toISOString(), by: req.user.name }],
    });
  } catch (error) { next(error); }
});

// ============================================================
// Receipt Template
// ============================================================

app.get('/api/receipt-template', requireAuth, async (req, res, next) => {
  try {
    const db = await getDB();
    const result = db.exec(`SELECT * FROM receipt_template WHERE id = 1`);
    if (!result.length || !result[0].values.length) return res.json({ template: {} });
    const cols = result[0].columns;
    const vals = result[0].values[0];
    const t = {}; cols.forEach((c, i) => t[c] = vals[i]);
    res.json({ template: t });
  } catch (error) { next(error); }
});

app.put('/api/receipt-template', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const t = req.body || {};
    const db = await getDB();
    db.run(`UPDATE receipt_template SET tin = ?, hotel_name = ?, address_lines = ?, phone = ?, fs_no = ?, invoice_title = ?, footer_lines = ? WHERE id = 1`,
      [t.tin || '', t.hotelName || '', t.addressLines || '', t.phone || '', t.fsNo || '', t.invoiceTitle || '', t.footerLines || '']);
    await dbModule.logAudit(db, 'update_template', 'settings', { keys: Object.keys(t) }, req.user.name);
    dbModule.persistSync(db);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// ============================================================
// Menu
// ============================================================

app.get('/api/menu', requireAuth, async (req, res, next) => {
  try {
    const db = await getDB();
    const cats = db.exec(`SELECT * FROM menu_categories ORDER BY name`);
    const items = db.exec(`SELECT * FROM menu_items ORDER BY name`);

    const categories = [];
    if (cats.length) {
      const cols = cats[0].columns;
      for (const row of cats[0].values) { const c = {}; cols.forEach((cc, i) => c[cc] = row[i]); categories.push(c); }
    }
    const menuItems = [];
    if (items.length) {
      const cols = items[0].columns;
      for (const row of items[0].values) { const it = {}; cols.forEach((cc, i) => it[cc] = row[i]); menuItems.push(it); }
    }
    res.json({ categories, menuItems });
  } catch (error) { next(error); }
});

app.post('/api/menu/items', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name, description, price, categoryId, emoji } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name required.' });

    const db = await getDB();
    const id = `food-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    db.run(`INSERT INTO menu_items (id, name, description, price, category_id, emoji, image) VALUES (?, ?, ?, ?, ?, ?, '')`,
      [id, name.trim(), description || '', Number(price) || 0, categoryId || null, emoji || '']);
    await dbModule.logAudit(db, 'create_menu_item', 'menu', { name: name.trim() }, req.user.name);
    dbModule.persistSync(db);
    res.status(201).json({ id, name: name.trim(), description, price: Number(price) || 0, categoryId, emoji });
  } catch (error) { next(error); }
});

app.delete('/api/menu/items/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const db = await getDB();
    db.run(`DELETE FROM menu_items WHERE id = ?`, [req.params.id]);
    dbModule.persistSync(db);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// ============================================================
// Audit Log
// ============================================================

app.get('/api/audit', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const db = await getDB();
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const category = req.query.category || null;
    let query = 'SELECT * FROM audit_log';
    if (category) { query += ` WHERE category = '${category.replace(/'/g, "''")}'`; }
    query += ` ORDER BY performed_at DESC LIMIT ${limit}`;

    const result = db.exec(query);
    const logs = [];
    if (result.length) {
      const cols = result[0].columns;
      for (const row of result[0].values) {
        const l = {}; cols.forEach((c, i) => l[c] = row[i]);
        l.details = JSON.parse(l.details_json || '{}');
        delete l.details_json;
        logs.push(l);
      }
    }
    res.json({ logs });
  } catch (error) { next(error); }
});

// ============================================================
// Settings
// ============================================================

app.get('/api/settings', requireAuth, async (req, res, next) => {
  try {
    const db = await getDB();
    const result = db.exec(`SELECT * FROM app_settings`);
    const settings = {};
    if (result.length) {
      for (const row of result[0].values) { settings[row[0]] = row[1]; }
    }
    res.json({ settings });
  } catch (error) { next(error); }
});

app.put('/api/settings', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const settings = req.body || {};
    const db = await getDB();
    for (const [key, value] of Object.entries(settings)) {
      db.run(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
        [key, String(value), String(value)]);
    }
    await dbModule.logAudit(db, 'update_settings', 'settings', { keys: Object.keys(settings) }, req.user.name);
    dbModule.persistSync(db);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// ============================================================
// Static files
// ============================================================

app.use(express.static(distDirectory));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distDirectory, 'index.html'), (error) => { if (error) next(); });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error.' });
});

// Start
dbModule.getDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hotel API ready on 0.0.0.0:${PORT}`);
  });
}).catch((error) => {
  console.error('Failed to initialize database.', error);
  process.exit(1);
});
