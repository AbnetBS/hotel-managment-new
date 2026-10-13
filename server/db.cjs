const crypto = require('node:crypto');
const fsAsync = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');

const DB_FILE = process.env.HOTEL_DB_FILE || path.join(__dirname, '..', '.hotel-data.db');
const SQL_WASM_DIR = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');

let dbPromise = null;
let initialized = false;

// Password hashing with PBKDF2 (Node built-in, no extra deps)
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, s, 310000, 64, 'sha512').toString('hex');
  return { hash, salt: s };
}

function verifyPassword(password, storedHash, salt) {
  const { hash } = hashPassword(password, salt);
  return hash === storedHash;
}

// Generate a secure session token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function getDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(SQL_WASM_DIR, file),
    });

    let db;
    try {
      const dbData = await fsAsync.readFile(DB_FILE);
      db = new SQL.Database(dbData);
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('DB read error:', err);
      db = new SQL.Database();
    }

    if (!initialized) {
      initializeSchema(db);
      seedIfEmpty(db);
      initialized = true;
      await persist(db);
    }

    return db;
  })();

  return dbPromise;
}

function initializeSchema(db) {
  const schema = `
    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Admin', 'Cashier')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      number TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      default_rate REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'occupied', 'cleaning')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stays (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      guest_name TEXT NOT NULL,
      guest_phone TEXT NOT NULL DEFAULT '',
      guest_email TEXT DEFAULT '',
      guest_nationality TEXT DEFAULT '',
      guest_document_id TEXT DEFAULT '',
      guest_count INTEGER NOT NULL DEFAULT 1,
      guest_notes TEXT DEFAULT '',
      check_in_at TEXT NOT NULL,
      rate_per_night REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'ETB',
      addons_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'checked_out')),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('room', 'table')),
      target_label TEXT NOT NULL,
      items_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'preparing', 'ready', 'completed', 'cancelled')),
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      invoice_no TEXT NOT NULL,
      order_no TEXT NOT NULL,
      printed_at TEXT NOT NULL,
      printed_by TEXT NOT NULL,
      waiter TEXT NOT NULL,
      table_label TEXT NOT NULL,
      guest_name TEXT,
      entity_type TEXT NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'Cash',
      room_days INTEGER NOT NULL DEFAULT 0,
      room_rate REAL NOT NULL DEFAULT 0,
      room_currency TEXT NOT NULL DEFAULT 'ETB',
      lines_json TEXT NOT NULL,
      currency_totals_json TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      template_json TEXT NOT NULL,
      print_count INTEGER NOT NULL DEFAULT 1,
      last_printed_at TEXT NOT NULL,
      last_printed_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS receipt_sequence (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      sequence INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS receipt_template (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      tin TEXT NOT NULL DEFAULT '',
      hotel_name TEXT NOT NULL DEFAULT 'Haven House Hotel',
      address_lines TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      fs_no TEXT NOT NULL DEFAULT '',
      invoice_title TEXT NOT NULL DEFAULT 'CASH INVOICE',
      footer_lines TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS menu_categories (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      category_id TEXT,
      emoji TEXT DEFAULT '',
      image TEXT DEFAULT '',
      FOREIGN KEY (category_id) REFERENCES menu_categories(id)
    );

    CREATE TABLE IF NOT EXISTS tables_list (
      id TEXT PRIMARY KEY,
      number TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (staff_id) REFERENCES staff(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      category TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      performed_by TEXT NOT NULL,
      performed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_target ON orders(target_id);
    CREATE INDEX IF NOT EXISTS idx_receipts_printed_at ON receipts(printed_at);
    CREATE INDEX IF NOT EXISTS idx_receipts_invoice ON receipts(invoice_no);
    CREATE INDEX IF NOT EXISTS idx_stays_room ON stays(room_id);
    CREATE INDEX IF NOT EXISTS idx_stays_status ON stays(status);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(performed_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_staff_username ON staff(username);
  `;

  db.run(schema);
}

function seedIfEmpty(db) {
  const staffCount = db.exec('SELECT COUNT(*) as c FROM staff');
  if (staffCount.length > 0 && staffCount[0].values[0][0] > 0) return;

  const now = new Date().toISOString();

  // Default staff with passwords: admin/admin123, cashier/cashier123
  const adminPw = hashPassword('admin123');
  const cashierPw = hashPassword('cashier123');

  db.run(`INSERT INTO staff (id, username, password_hash, password_salt, name, role, active, created_at)
    VALUES ('staff-admin', 'admin', ?, ?, 'Evelyn Tesfaye', 'Admin', 1, ?)`,
    [adminPw.hash, adminPw.salt, now]);
  db.run(`INSERT INTO staff (id, username, password_hash, password_salt, name, role, active, created_at)
    VALUES ('staff-cashier', 'cashier', ?, ?, 'Liya Alemu', 'Cashier', 1, ?)`,
    [cashierPw.hash, cashierPw.salt, now]);

  // Rooms
  const rooms = [
    ['room-101', '101', 'Deluxe king', 2600, 'occupied'],
    ['room-102', '102', 'Courtyard queen', 2900, 'occupied'],
    ['room-103', '103', 'Standard twin', 2100, 'available'],
    ['room-104', '104', 'Standard twin', 2100, 'available'],
    ['room-105', '105', 'Deluxe king', 2600, 'available'],
    ['room-106', '106', 'Family suite', 3900, 'available'],
    ['room-107', '107', 'Courtyard queen', 2900, 'available'],
    ['room-108', '108', 'Standard twin', 2100, 'available'],
  ];
  for (const r of rooms) {
    db.run(`INSERT INTO rooms (id, number, type, default_rate, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [...r, now]);
  }

  // Occupied rooms with stays
  db.run(`INSERT INTO stays (id, room_id, guest_name, guest_phone, guest_email, guest_nationality, guest_document_id, guest_count, guest_notes, check_in_at, rate_per_night, currency, addons_json, status)
    VALUES ('stay-101', 'room-101', 'Nadia Bekele', '+251 911 234 567', 'nadia@example.com', 'Ethiopian', 'ET-104821', 2, 'Late checkout requested', '2026-10-08T10:00:00+03:00', 2400, 'ETB', '[{"id":"demo-101-1","name":"Coffee and breakfast","qty":2,"unitPrice":320,"kind":"food"}]', 'active')`);
  db.run(`INSERT INTO stays (id, room_id, guest_name, guest_phone, guest_email, guest_nationality, guest_document_id, guest_count, guest_notes, check_in_at, rate_per_night, currency, addons_json, status)
    VALUES ('stay-102', 'room-102', 'Lukas Meyer', '+49 151 1234567', 'lukas@example.com', 'German', 'P-921603', 1, '', '2026-10-09T13:00:00+03:00', 78, 'USD', '[{"id":"demo-102-1","name":"Laundry service","qty":1,"unitPrice":450,"kind":"service"},{"id":"demo-102-2","name":"Mineral water","qty":2,"unitPrice":85,"kind":"item"}]', 'active')`);

  // Tables
  for (let i = 1; i <= 6; i++) {
    db.run(`INSERT INTO tables_list (id, number, label) VALUES (?, ?, ?)`, [`table-${i}`, String(i), `Table ${i}`]);
  }

  // Menu categories
  const cats = [['cat-breakfast', 'Breakfast'], ['cat-mains', 'Mains'], ['cat-drinks', 'Drinks'], ['cat-dessert', 'Dessert']];
  for (const c of cats) {
    db.run(`INSERT INTO menu_categories (id, name) VALUES (?, ?)`, c);
  }

  // Menu items
  const items = [
    ['food-1', 'Shiro fitfit', 'Spiced chickpea stew with torn injera.', 280, 'cat-breakfast', '🍲'],
    ['food-2', 'Chechebsa', 'Warm flatbread tossed with berbere and niter kibbeh.', 240, 'cat-breakfast', ''],
    ['food-3', 'Avocado toast', 'Sourdough, avocado, lemon and herbs.', 360, 'cat-breakfast', '🥑'],
    ['food-4', 'Doro wat', 'Slow-cooked chicken, egg and house berbere.', 720, 'cat-mains', '🍛'],
    ['food-5', 'Grilled fish', 'Fresh catch with lemon, salad and rice.', 890, 'cat-mains', '🐟'],
    ['food-6', 'Veggie bowl', 'Seasonal greens, lentils and tahini dressing.', 540, 'cat-mains', ''],
    ['food-7', 'Ethiopian coffee', 'Freshly roasted, served jebena style.', 120, 'cat-drinks', '☕'],
    ['food-8', 'Fresh mango juice', 'Pressed to order, no added sugar.', 180, 'cat-drinks', '🥭'],
    ['food-9', 'Sparkling water', 'Chilled 500 ml bottle.', 85, 'cat-drinks', '🫧'],
    ['food-10', 'Honey cake', 'Soft sponge with local honey cream.', 260, 'cat-dessert', '🍰'],
  ];
  for (const item of items) {
    db.run(`INSERT INTO menu_items (id, name, description, price, category_id, emoji, image) VALUES (?, ?, ?, ?, ?, ?, '')`, item);
  }

  // QR order
  db.run(`INSERT INTO orders (id, target_id, target_type, target_label, items_json, status, created_at)
    VALUES ('demo-order-table-3', 'table-3', 'table', 'Table 3',
      '[{"id":"order-line-demo-1","menuItemId":"food-4","name":"Doro wat","qty":2,"unitPrice":720},{"id":"order-line-demo-2","menuItemId":"food-7","name":"Ethiopian coffee","qty":2,"unitPrice":120}]',
      'new', '2026-10-10T08:30:00+03:00')`);

  // Receipt template
  db.run(`INSERT INTO receipt_template (id, tin, hotel_name, address_lines, phone, fs_no, invoice_title, footer_lines)
    VALUES (1, 'TIN-________', 'Haven House Hotel', 'Bole Road\nAddis Ababa, Ethiopia', '+251 11 000 0000', 'FS-01', 'CASH INVOICE', 'Thank you for choosing Haven House!\nWe hope to see you again.')`);

  // Receipt sequence
  db.run(`INSERT INTO receipt_sequence (id, sequence) VALUES (1, 1)`);

  // App settings
  db.run(`INSERT INTO app_settings (key, value) VALUES ('hotel_name', 'Haven House Hotel')`);
  db.run(`INSERT INTO app_settings (key, value) VALUES ('hotel_timezone', 'Africa/Addis_Ababa')`);
  db.run(`INSERT INTO app_settings (key, value) VALUES ('hotel_currency', 'ETB')`);
  db.run(`INSERT INTO app_settings (key, value) VALUES ('hotel_phone', '+251 11 000 0000')`);
  db.run(`INSERT INTO app_settings (key, value) VALUES ('hotel_address', 'Bole Road, Addis Ababa, Ethiopia')`);
}

async function persist(db) {
  if (!db) return;
  const data = Buffer.from(db.export());
  await fsAsync.writeFile(DB_FILE, data);
}

function persistSync(db) {
  if (!db) return;
  const data = Buffer.from(db.export());
  fsSync.writeFileSync(DB_FILE, data);
}

// Audit helper
async function logAudit(db, action, category, details, performedBy) {
  const id = `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  db.run(`INSERT INTO audit_log (id, action, category, details_json, performed_by, performed_at)
    VALUES (?, ?, ?, ?, ?, ?)`,
    [id, action, category, JSON.stringify(details), performedBy, new Date().toISOString()]);
}

// Session helpers
function createSession(db, staffId) {
  const token = generateToken();
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
  db.run(`INSERT INTO sessions (token, staff_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    [token, staffId, now.toISOString(), expires.toISOString()]);
  return token;
}

function validateSession(db, token) {
  const row = db.exec(`SELECT s.*, st.username, st.name, st.role FROM sessions s
    JOIN staff st ON st.id = s.staff_id WHERE s.token = ? AND s.expires_at > ?`,
    [token, new Date().toISOString()]);
  if (!row.length || !row[0].values.length) return null;
  const cols = row[0].columns;
  const vals = row[0].values[0];
  const session = {};
  cols.forEach((c, i) => session[c] = vals[i]);
  return session;
}

function destroySession(db, token) {
  db.run(`DELETE FROM sessions WHERE token = ?`, [token]);
}

// Clean expired sessions
function cleanupSessions(db) {
  db.run(`DELETE FROM sessions WHERE expires_at < ?`, [new Date().toISOString()]);
}

module.exports = {
  getDatabase,
  hashPassword,
  verifyPassword,
  generateToken,
  createSession,
  validateSession,
  destroySession,
  cleanupSessions,
  logAudit,
  persist,
  persistSync,
};
