import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { flushSync } from 'react-dom';
import QRCode from 'qrcode';
import {
  ArrowUpRight, BedDouble, Bell, CalendarDays, ChartColumn, Check, CheckCircle2, ChevronDown,
  ChevronRight, CircleDollarSign, Clock3, Coffee, Download, Eye, FileText, ImagePlus,
  LayoutDashboard, LogOut, Minus, MoreHorizontal, Pencil, Plus, Printer, QrCode,
  ReceiptText, Search, Settings2, ShieldCheck, ShoppingBag, Trash2, UserRound, Users,
  Utensils, WalletCards, X, Activity, TrendingUp, Calendar, Lock, AlertCircle,
} from 'lucide-react';

const ETB = 'ETB';
const COMMON_CURRENCIES = ['ETB', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'CAD', 'AUD', 'CHF', 'JPY'];
const VALID_ROLES = ['Admin', 'Cashier'];
const PAYMENT_METHODS = ['Cash', 'Card', 'Bank transfer', 'Mobile money'];

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  desk: 'Front Desk',
  rooms: 'Rooms',
  menu: 'Menu',
  orders: 'Orders',
  receipts: 'Receipts',
  reports: 'Reports',
  audit: 'Audit Log',
  staff: 'Staff',
  template: 'Receipt Template',
  settings: 'Settings',
};

// ==================== API Helpers ====================

function api(url, options = {}) {
  const token = sessionStorage.getItem('haven-token');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { ...options, headers }).then(async (res) => {
    if (res.status === 401) {
      sessionStorage.removeItem('haven-token');
      sessionStorage.removeItem('haven-staff');
      window.location.reload();
      throw new Error('Session expired');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  });
}

function formatMoney(amount, currency = ETB) {
  const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currency || ETB,
      currencyDisplay: 'code',
      minimumFractionDigits: 0, maximumFractionDigits: 2,
    }).format(safeAmount);
  } catch {
    return `${currency || ETB} ${safeAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
}

function dateLabel(value, options = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-ET', {
    dateStyle: options.dateStyle || 'medium',
    ...(options.time ? { timeStyle: 'short' } : {}),
  }).format(date);
}

function timeAgo(value) {
  if (!value) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getStayDays(checkInAt, now = new Date()) {
  if (!checkInAt) return 1;
  const startDate = new Date(checkInAt);
  if (Number.isNaN(startDate.getTime())) return 1;
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
}

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'H';
}

function calculateAddonTotal(addons = []) {
  return addons.reduce((total, line) => total + (Number(line.qty) || 0) * (Number(line.unitPrice) || 0), 0);
}

function makeId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ==================== Main App ====================

export default function App() {
  const [auth, setAuth] = useState(() => {
    const token = sessionStorage.getItem('haven-token');
    const staff = sessionStorage.getItem('haven-staff');
    if (token && staff) {
      try { return { token, staff: JSON.parse(staff) }; } catch {}
    }
    return null;
  });
  const [page, setPage] = useState('dashboard');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const notify = useCallback((msg) => setToast(msg), []);

  const handleLogin = async (username, password) => {
    setLoading(true);
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      sessionStorage.setItem('haven-token', data.token);
      sessionStorage.setItem('haven-staff', JSON.stringify(data.staff));
      setAuth({ token: data.token, staff: data.staff });
      setPage(data.staff.role === 'Admin' ? 'dashboard' : 'desk');
    } catch (err) {
      notify(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    sessionStorage.removeItem('haven-token');
    sessionStorage.removeItem('haven-staff');
    setAuth(null);
    setPage('dashboard');
  };

  if (!auth) {
    return <LoginPage onLogin={handleLogin} loading={loading} />;
  }

  const navItems = auth.staff.role === 'Admin'
    ? [
        { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { key: 'desk', label: 'Front Desk', icon: BedDouble },
        { key: 'rooms', label: 'Rooms', icon: QrCode },
        { key: 'orders', label: 'Orders', icon: ShoppingBag },
        { key: 'receipts', label: 'Receipts', icon: FileText },
        { key: 'menu', label: 'Menu', icon: Utensils },
        { key: 'reports', label: 'Reports', icon: ChartColumn },
        { key: 'audit', label: 'Audit Log', icon: Activity },
        { key: 'staff', label: 'Staff', icon: Users },
        { key: 'template', label: 'Template', icon: ReceiptText },
        { key: 'settings', label: 'Settings', icon: Settings2 },
      ]
    : [
        { key: 'desk', label: 'Front Desk', icon: BedDouble },
        { key: 'orders', label: 'Orders', icon: ShoppingBag },
        { key: 'receipts', label: 'Receipts', icon: FileText },
      ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><BedDouble size={20} strokeWidth={2.2} /></div>
          <div><div className="brand-name">Haven House</div><div className="brand-caption">HOTEL OPS</div></div>
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className={`nav-link ${page === item.key ? 'active' : ''}`} onClick={() => setPage(item.key)}>
                <Icon size={17} strokeWidth={1.9} /><span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-card">
            <div className="user-avatar">{initials(auth.staff.name)}</div>
            <div className="user-detail"><strong>{auth.staff.name}</strong><span>{auth.staff.role}</span></div>
            <button className="icon-button user-menu" aria-label="Sign out" title="Sign out" onClick={handleLogout}><LogOut size={15} /></button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-heading">
            <div className="breadcrumb">Haven House <ChevronRight size={13} /> <span>{PAGE_TITLES[page] || 'Dashboard'}</span></div>
          </div>
          <div className="topbar-actions">
            <div className="date-pill"><CalendarDays size={14} /><span>{new Intl.DateTimeFormat('en-ET', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span></div>
            <div className="operator-chip">
              <div className="user-avatar small">{initials(auth.staff.name)}</div>
              <div><strong>{auth.staff.name}</strong><span>{auth.staff.role}</span></div>
            </div>
          </div>
        </header>

        <div className="page-content">
          {page === 'dashboard' && auth.staff.role === 'Admin' && <DashboardPage />}
          {page === 'desk' && <FrontDeskPage staff={auth.staff} />}
          {page === 'rooms' && auth.staff.role === 'Admin' && <RoomsPage />}
          {page === 'orders' && <OrdersPage />}
          {page === 'receipts' && <ReceiptsPage />}
          {page === 'menu' && auth.staff.role === 'Admin' && <MenuPage />}
          {page === 'reports' && auth.staff.role === 'Admin' && <ReportsPage />}
          {page === 'audit' && auth.staff.role === 'Admin' && <AuditPage />}
          {page === 'staff' && auth.staff.role === 'Admin' && <StaffPage />}
          {page === 'template' && auth.staff.role === 'Admin' && <TemplatePage />}
          {page === 'settings' && auth.staff.role === 'Admin' && <SettingsPage />}
        </div>
      </main>

      {toast && <div className="toast"><CheckCircle2 size={16} />{toast}</div>}
    </div>
  );
}

// ==================== Login Page ====================

function LoginPage({ onLogin, loading }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) return setError('Please enter username and password.');
    onLogin(username.trim(), password);
  };

  return (
    <div className="signin-page">
      <div className="signin-art">
        <div className="signin-brand">
          <div className="brand-mark light"><BedDouble size={20} /></div>
          <span className="brand-name" style={{ color: '#fff' }}>Haven House Hotel</span>
        </div>
        <div className="signin-art-copy">
          <span className="eyebrow light-eyebrow">OPERATIONS PLATFORM</span>
          <h1>Manage your hotel<br />with confidence.</h1>
          <p>Room management, guest services, billing, and reporting — all in one secure system.</p>
          <div className="signin-art-note"><ShieldCheck size={15} /> Secure role-based access control</div>
        </div>
        <div className="art-horizon">
          <div className="art-building building-back" />
          <div className="art-building building-front" />
          <div className="art-window window-a" />
          <div className="art-window window-b" />
          <div className="art-window window-c" />
          <div className="art-plant">✦</div>
        </div>
      </div>
      <div className="signin-panel">
        <div className="signin-panel-inner">
          <span className="eyebrow">SECURE ACCESS</span>
          <h2>Sign in to your account</h2>
          <p className="muted">Enter your credentials to access the hotel management system.</p>

          <form onSubmit={submit}>
            <label className="field" style={{ marginBottom: '14px' }}>
              <span className="field-label">Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. admin" autoFocus />
            </label>
            <label className="field" style={{ marginBottom: '18px' }}>
              <span className="field-label">Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />
            </label>

            {error && <div className="form-error" style={{ marginBottom: '14px' }}>{error}</div>}

            <button className="button button-primary signin-submit" type="submit" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
              <ChevronRight size={16} />
            </button>
          </form>

          <div className="signin-footnote">
            <ShieldCheck size={14} /> Default: admin/admin123 or cashier/cashier123
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== Dashboard (Fana Cafe-inspired) ====================

function DashboardPage() {
  const [rooms, setRooms] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [period, setPeriod] = useState('today');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api('/api/rooms').then(d => setRooms(d.rooms)),
      api('/api/receipts').then(d => setReceipts(d.receipts)),
      api('/api/orders').then(d => setOrders(d.orders)),
    ]).finally(() => setLoading(false));
  }, []);

  const occupied = rooms.filter(r => r.status === 'occupied').length;
  const available = rooms.length - occupied;
  const pendingOrders = orders.filter(o => o.status === 'new').length;

  const today = new Date().toDateString();
  const todayReceipts = receipts.filter(r => new Date(r.printedAt).toDateString() === today);

  // Period calculations
  const getPeriodRange = (p) => {
    const now = new Date();
    const ranges = {
      today: { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), label: 'Today' },
      yesterday: { start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), end: new Date(now.getFullYear(), now.getMonth(), now.getDate()), label: 'Yesterday' },
      '7days': { start: new Date(now.getTime() - 6 * 86400000), label: 'Last 7 Days' },
      '30days': { start: new Date(now.getTime() - 29 * 86400000), label: 'Last 30 Days' },
    };
    return ranges[p] || ranges.today;
  };

  const periodRange = getPeriodRange(period);
  const periodReceipts = receipts.filter(r => {
    const d = new Date(r.printedAt);
    if (periodRange.end) return d >= periodRange.start && d < periodRange.end;
    return d >= periodRange.start;
  });

  const periodTotals = {};
  periodReceipts.forEach(r => {
    (r.currencyTotals || []).forEach(ct => {
      periodTotals[ct.currency] = (periodTotals[ct.currency] || 0) + ct.amount;
    });
  });

  const periods = [
    { key: 'today', label: 'TODAY' },
    { key: 'yesterday', label: 'YESTERDAY' },
    { key: '7days', label: 'LAST 7 DAYS' },
    { key: '30days', label: 'LAST 30 DAYS' },
  ];

  // Daily breakdown for last 7 days
  const dailyBreakdown = useMemo(() => {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 86400000);
      const dayReceipts = receipts.filter(r => new Date(r.printedAt).toDateString() === date.toDateString());
      let total = 0;
      dayReceipts.forEach(r => {
        (r.currencyTotals || []).forEach(ct => { total += ct.amount; });
      });
      days.push({ date, total, orders: dayReceipts.length, label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : `${i} days ago` });
    }
    return days;
  }, [receipts]);

  if (loading) return <div className="loading-state">Loading dashboard...</div>;

  return (
    <div className="dashboard-page">
      {/* Period Selector */}
      <div className="period-selector">
        {periods.map(p => (
          <button key={p.key} className={`period-card ${period === p.key ? 'active' : ''}`} onClick={() => setPeriod(p.key)}>
            <div className="period-label">{p.label}</div>
            <div className="period-value">
              {p.key === 'today' && `${Object.values(periodTotals).map(v => formatMoney(v)).join(' + ') || formatMoney(0)}`}
              {p.key === 'yesterday' && (() => {
                const r = getPeriodRange('yesterday');
                const rr = receipts.filter(x => { const d = new Date(x.printedAt); return d >= r.start && d < r.end; });
                const t = {}; rr.forEach(x => (x.currencyTotals || []).forEach(ct => { t[ct.currency] = (t[ct.currency] || 0) + ct.amount; }));
                return Object.values(t).map(v => formatMoney(v)).join(' + ') || formatMoney(0);
              })()}
              {p.key === '7days' && Object.values(periodTotals).map(v => formatMoney(v)).join(' + ')}
              {p.key === '30days' && Object.values(periodTotals).map(v => formatMoney(v)).join(' + ')}
            </div>
            <div className="period-count">
              {p.key === 'today' && `${todayReceipts.length} orders`}
              {p.key !== 'today' && `${periodReceipts.length} orders`}
            </div>
          </button>
        ))}
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon"><BedDouble size={18} /></div>
          <div className="stat-content">
            <div className="stat-label">Rooms Occupied</div>
            <div className="stat-value">{occupied} / {rooms.length}</div>
            <div className="stat-detail">{available} available</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><ShoppingBag size={18} /></div>
          <div className="stat-content">
            <div className="stat-label">Pending Orders</div>
            <div className="stat-value">{pendingOrders}</div>
            <div className="stat-detail">awaiting review</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><ReceiptText size={18} /></div>
          <div className="stat-content">
            <div className="stat-label">Receipts Today</div>
            <div className="stat-value">{todayReceipts.length}</div>
            <div className="stat-detail">completed transactions</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><CircleDollarSign size={18} /></div>
          <div className="stat-content">
            <div className="stat-label">Today's Revenue</div>
            <div className="stat-value">{Object.values(periodTotals).map(v => formatMoney(v)).join(' + ') || formatMoney(0)}</div>
            <div className="stat-detail">all currencies</div>
          </div>
        </div>
      </div>

      {/* Daily Breakdown Chart */}
      <div className="dashboard-section">
        <div className="section-header">
          <div>
            <div className="section-title">Daily Revenue — Last 7 Days</div>
            <div className="section-subtitle">Sliding window breakdown of daily sales</div>
          </div>
          <div className="section-total">
            <div className="total-label">7-DAY TOTAL</div>
            <div className="total-value">{Object.entries(periodTotals).map(([c, v]) => formatMoney(v, c)).join(' + ')}</div>
            <div className="total-count">{dailyBreakdown.reduce((s, d) => s + d.orders, 0)} orders</div>
          </div>
        </div>
        <div className="daily-chart">
          {dailyBreakdown.map((day, i) => {
            const maxVal = Math.max(...dailyBreakdown.map(d => d.total), 1);
            const pct = (day.total / maxVal) * 100;
            return (
              <div key={i} className={`daily-bar ${i === 6 ? 'today' : ''}`}>
                <div className="daily-label">{day.label}</div>
                <div className="daily-date">{dateLabel(day.date)}</div>
                <div className="daily-amount">{formatMoney(day.total)}</div>
                <div className="daily-orders">{day.orders} orders</div>
                <div className="daily-track"><div className="daily-fill" style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Room Status & Recent Activity */}
      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <div className="panel-header">
            <div className="section-title">Room Status</div>
          </div>
          <div className="room-status-list">
            {rooms.slice(0, 8).map(room => (
              <div key={room.id} className={`room-status-item ${room.status}`}>
                <div className="room-number">{room.number}</div>
                <div className="room-info">
                  <div className="room-type">{room.type}</div>
                  {room.status === 'occupied' && room.guest && (
                    <div className="room-guest">{room.guest.name} · {getStayDays(room.checkInAt)} days</div>
                  )}
                </div>
                <div className={`room-status-badge ${room.status}`}>
                  {room.status === 'occupied' ? 'Occupied' : 'Available'}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="panel-header">
            <div className="section-title">Recent Receipts</div>
          </div>
          <div className="recent-list">
            {receipts.slice(0, 6).map(r => (
              <div key={r.id} className="recent-item">
                <div className="recent-icon"><ReceiptText size={16} /></div>
                <div className="recent-info">
                  <div className="recent-title">{r.tableLabel}</div>
                  <div className="recent-meta">{r.invoiceNo} · {timeAgo(r.printedAt)}</div>
                </div>
                <div className="recent-amount">
                  {(r.currencyTotals || []).map(ct => <div key={ct.currency}>{formatMoney(ct.amount, ct.currency)}</div>)}
                </div>
              </div>
            ))}
            {receipts.length === 0 && <div className="empty-hint">No receipts yet</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== Front Desk Page ====================

function FrontDeskPage({ staff }) {
  const [rooms, setRooms] = useState([]);
  const [checkInRoom, setCheckInRoom] = useState(null);
  const [activeRoom, setActiveRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  useEffect(() => {
    api('/api/rooms').then(d => setRooms(d.rooms)).finally(() => setLoading(false));
  }, []);

  const refreshRooms = () => api('/api/rooms').then(d => setRooms(d.rooms));

  const handleCheckIn = async (roomId, guest, rate, currency) => {
    try {
      await api('/api/checkin', { method: 'POST', body: JSON.stringify({ roomId, guest, ratePerNight: rate, currency }) });
      setToast('Guest checked in successfully');
      setCheckInRoom(null);
      refreshRooms();
    } catch (err) {
      setToast(err.message);
    }
  };

  const handleCheckout = async (room, paymentMethod) => {
    const days = getStayDays(room.stay?.checkInAt);
    const roomTotal = days * (room.ratePerNight || 0);
    const addons = room.addons || [];
    const addonsTotal = calculateAddonTotal(addons);

    const lines = [
      { id: makeId('line'), description: `Room ${room.number} · ${days} day${days === 1 ? '' : 's'}`, qty: days, price: room.ratePerNight || 0, amount: roomTotal, currency: room.currency || ETB, kind: 'room' },
      ...addons.map(a => ({ id: makeId('line'), description: a.name, qty: a.qty || 1, price: a.unitPrice || 0, amount: (a.qty || 1) * (a.unitPrice || 0), currency: ETB, kind: a.kind || 'service' })),
    ];

    const template = { hotelName: 'Haven House Hotel', tin: 'TIN-________', addressLines: 'Bole Road\nAddis Ababa, Ethiopia', phone: '+251 11 000 0000', fsNo: 'FS-01', invoiceTitle: 'CASH INVOICE', footerLines: 'Thank you for choosing Haven House!' };

    try {
      const data = await api('/api/receipts', {
        method: 'POST',
        body: JSON.stringify({
          lines, paymentMethod, entityType: 'room',
          tableLabel: `Room ${room.number}`, guestName: room.guest?.name,
          roomDays: days, roomRate: room.ratePerNight, roomCurrency: room.currency,
          template, releaseRoomId: room.id,
          waiter: staff.name,
        }),
      });
      setToast('Checkout complete. Receipt archived.');
      refreshRooms();
      setActiveRoom(null);
    } catch (err) {
      setToast(err.message);
    }
  };

  if (loading) return <div className="loading-state">Loading rooms...</div>;

  return (
    <div className="front-desk-page">
      <div className="fd-header">
        <div>
          <div className="fd-title">Front Desk</div>
          <div className="fd-subtitle">{rooms.filter(r => r.status === 'occupied').length} occupied · {rooms.filter(r => r.status === 'available').length} available</div>
        </div>
      </div>

      <div className="room-grid-fd">
        {rooms.map(room => (
          <div
            key={room.id}
            className={`room-card-fd ${room.status}`}
            onClick={() => room.status === 'available' ? setCheckInRoom(room) : setActiveRoom(room)}
          >
            <div className="rc-header">
              <div className="rc-number">{room.number}</div>
              <div className={`rc-status ${room.status}`}>{room.status === 'occupied' ? 'Occupied' : 'Available'}</div>
            </div>
            <div className="rc-type">{room.type}</div>
            {room.status === 'occupied' && room.guest && (
              <div className="rc-guest">
                <div className="rc-guest-name">{room.guest.name}</div>
                <div className="rc-guest-meta">{getStayDays(room.stay?.checkInAt)} days · {formatMoney(room.ratePerNight, room.currency)}/night</div>
              </div>
            )}
            {room.status === 'available' && <div className="rc-vacant">Tap to check in</div>}
          </div>
        ))}
      </div>

      {checkInRoom && <CheckInModal room={checkInRoom} onClose={() => setCheckInRoom(null)} onSave={handleCheckIn} />}
      {activeRoom && <RoomBillDrawer room={activeRoom} onClose={() => setActiveRoom(null)} onCheckout={handleCheckout} />}
      {toast && <div className="toast"><CheckCircle2 size={16} />{toast}</div>}
    </div>
  );
}

// ==================== Check-in Modal ====================

function CheckInModal({ room, onClose, onSave }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', nationality: '', documentId: '', guests: '1', notes: '', rate: String(room.defaultRate || ''), currency: ETB });
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return setError('Guest name and phone are required.');
    if (!(Number(form.rate) > 0)) return setError('Rate must be greater than zero.');
    onSave(room.id, form, Number(form.rate), form.currency);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div><div className="modal-title">Check In · Room {room.number}</div><div className="modal-subtitle">{room.type} · Reference rate: {formatMoney(room.defaultRate)}</div></div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <div className="form-grid">
            <label className="field"><span className="field-label">Guest Name *</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus /></label>
            <label className="field"><span className="field-label">Phone *</span><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
            <label className="field"><span className="field-label">Email</span><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
            <label className="field"><span className="field-label">Nationality</span><input value={form.nationality} onChange={e => setForm({ ...form, nationality: e.target.value })} /></label>
            <label className="field"><span className="field-label">ID/Passport</span><input value={form.documentId} onChange={e => setForm({ ...form, documentId: e.target.value })} /></label>
            <label className="field"><span className="field-label">Guests</span><input type="number" min="1" value={form.guests} onChange={e => setForm({ ...form, guests: e.target.value })} /></label>
          </div>
          <label className="field"><span className="field-label">Notes</span><textarea rows="2" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>

          <div className="rate-section">
            <div className="section-title" style={{ marginBottom: '10px' }}>Rate & Currency</div>
            <div className="form-grid">
              <label className="field"><span className="field-label">Rate per Night *</span><input type="number" min="0" step="0.01" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} /></label>
              <label className="field"><span className="field-label">Currency</span><select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}><option value="ETB">ETB</option><option value="USD">USD</option><option value="EUR">EUR</option></select></label>
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Check In</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==================== Room Bill Drawer ====================

function RoomBillDrawer({ room, onClose, onCheckout }) {
  const [payment, setPayment] = useState('Cash');
  const days = getStayDays(room.stay?.checkInAt);
  const roomTotal = days * (room.ratePerNight || 0);
  const addonTotal = calculateAddonTotal(room.addons);
  const total = roomTotal + addonTotal;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-content" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div><div className="drawer-title">Room {room.number}</div><div className="drawer-subtitle">{room.type}</div></div>
          <button className="drawer-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="drawer-guest">
          <div className="drawer-guest-avatar">{initials(room.guest?.name)}</div>
          <div className="drawer-guest-info">
            <div className="drawer-guest-name">{room.guest?.name}</div>
            <div className="drawer-guest-phone">{room.guest?.phone} · {days} days</div>
          </div>
        </div>

        <div className="drawer-billing">
          <div className="billing-row">
            <div className="billing-label">Room ({days} nights × {formatMoney(room.ratePerNight, room.currency)})</div>
            <div className="billing-amount">{formatMoney(roomTotal, room.currency)}</div>
          </div>
          {(room.addons || []).map(a => (
            <div key={a.id} className="billing-row">
              <div className="billing-label">{a.name} ({a.qty} × {formatMoney(a.unitPrice)})</div>
              <div className="billing-amount">{formatMoney((a.qty || 1) * (a.unitPrice || 0))}</div>
            </div>
          ))}
          <div className="billing-total">
            <div className="billing-label">Total Due</div>
            <div className="billing-total-amount">{formatMoney(total, room.currency)}</div>
          </div>
        </div>

        <div className="drawer-actions">
          <select value={payment} onChange={e => setPayment(e.target.value)} className="payment-select">
            {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
          </select>
          <button className="btn-primary btn-full" onClick={() => onCheckout(room, payment)}>
            <Printer size={16} /> Complete Checkout
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== Rooms Page ====================

function RoomsPage() {
  const [rooms, setRooms] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newRoom, setNewRoom] = useState({ number: '', type: 'Standard twin', defaultRate: '2100' });
  const [toast, setToast] = useState('');

  useEffect(() => { api('/api/rooms').then(d => setRooms(d.rooms)); }, []);

  const addRoom = async (e) => {
    e.preventDefault();
    try {
      await api('/api/rooms', { method: 'POST', body: JSON.stringify(newRoom) });
      setToast('Room added');
      setShowAdd(false);
      setNewRoom({ number: '', type: 'Standard twin', defaultRate: '2100' });
      api('/api/rooms').then(d => setRooms(d.rooms));
    } catch (err) { setToast(err.message); }
  };

  const deleteRoom = async (id) => {
    if (!window.confirm('Remove this room?')) return;
    try {
      await api(`/api/rooms/${id}`, { method: 'DELETE' });
      setToast('Room removed');
      api('/api/rooms').then(d => setRooms(d.rooms));
    } catch (err) { setToast(err.message); }
  };

  return (
    <div className="rooms-page">
      <div className="page-header">
        <div><div className="page-title">Rooms Management</div><div className="page-subtitle">{rooms.length} rooms · {rooms.filter(r => r.status === 'occupied').length} occupied</div></div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Add Room</button>
      </div>

      <div className="rooms-grid">
        {rooms.map(room => (
          <div key={room.id} className="room-card-mgmt">
            <div className="room-card-top">
              <div className="room-card-number">{room.number}</div>
              <div className={`room-card-status ${room.status}`}>{room.status}</div>
            </div>
            <div className="room-card-type">{room.type}</div>
            <div className="room-card-rate">{formatMoney(room.defaultRate)}/night</div>
            <button className="room-card-delete" onClick={() => deleteRoom(room.id)} disabled={room.status === 'occupied'}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Add Room</div>
              <button className="modal-close" onClick={() => setShowAdd(false)}><X size={18} /></button>
            </div>
            <form onSubmit={addRoom} className="modal-body">
              <label className="field"><span className="field-label">Room Number *</span><input value={newRoom.number} onChange={e => setNewRoom({ ...newRoom, number: e.target.value })} autoFocus required /></label>
              <label className="field"><span className="field-label">Type</span><select value={newRoom.type} onChange={e => setNewRoom({ ...newRoom, type: e.target.value })}><option>Standard twin</option><option>Courtyard queen</option><option>Deluxe king</option><option>Family suite</option></select></label>
              <label className="field"><span className="field-label">Default Rate (ETB)</span><input type="number" value={newRoom.defaultRate} onChange={e => setNewRoom({ ...newRoom, defaultRate: e.target.value })} /></label>
              <div className="modal-footer">
                <button type="button" className="btn-outline" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Add Room</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {toast && <div className="toast"><CheckCircle2 size={16} />{toast}</div>}
    </div>
  );
}

// ==================== Orders Page ====================

function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api('/api/orders').then(d => { setOrders(d.orders.filter(o => o.status !== 'completed')); setLoading(false); }); }, []);

  const deleteOrder = async (id) => {
    try { await api(`/api/orders/${id}`, { method: 'DELETE' }); setOrders(orders.filter(o => o.id !== id)); } catch {}
  };

  if (loading) return <div className="loading-state">Loading orders...</div>;

  return (
    <div className="orders-page">
      <div className="page-header">
        <div><div className="page-title">Active Orders</div><div className="page-subtitle">{orders.length} pending orders</div></div>
      </div>

      {orders.length === 0 ? (
        <div className="empty-state"><ShoppingBag size={32} /><div className="empty-title">No active orders</div><div className="empty-text">New orders will appear here</div></div>
      ) : (
        <div className="orders-grid">
          {orders.map(order => (
            <div key={order.id} className="order-card">
              <div className="order-header">
                <div className="order-target">{order.targetLabel}</div>
                <div className="order-time">{timeAgo(order.createdAt)}</div>
                <button className="order-delete" onClick={() => deleteOrder(order.id)}><X size={16} /></button>
              </div>
              <div className="order-items">
                {order.items.map(item => (
                  <div key={item.id} className="order-item">
                    <span>{item.qty}× {item.name}</span>
                    <span>{formatMoney(item.qty * item.unitPrice)}</span>
                  </div>
                ))}
              </div>
              <div className="order-total">
                <span>Total</span>
                <strong>{formatMoney(order.items.reduce((s, i) => s + i.qty * i.unitPrice, 0))}</strong>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== Receipts Page ====================

function ReceiptsPage() {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { api('/api/receipts').then(d => setReceipts(d.receipts)).finally(() => setLoading(false)); }, []);

  const filtered = receipts.filter(r =>
    `${r.invoiceNo} ${r.tableLabel} ${r.guestName}`.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="loading-state">Loading receipts...</div>;

  return (
    <div className="receipts-page">
      <div className="page-header">
        <div><div className="page-title">Receipt Archive</div><div className="page-subtitle">{receipts.length} total receipts</div></div>
        <input className="search-input" placeholder="Search receipts..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state"><ReceiptText size={32} /><div className="empty-title">No receipts found</div></div>
      ) : (
        <div className="receipts-list">
          {filtered.map(r => (
            <div key={r.id} className="receipt-card">
              <div className="receipt-info">
                <div className="receipt-invoice">{r.invoiceNo}</div>
                <div className="receipt-label">{r.tableLabel} · {r.guestName}</div>
                <div className="receipt-date">{dateLabel(r.printedAt, { time: true })}</div>
              </div>
              <div className="receipt-amounts">
                {(r.currencyTotals || []).map(ct => <div key={ct.currency} className="receipt-amount">{formatMoney(ct.amount, ct.currency)}</div>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== Menu Page ====================

function MenuPage() {
  const [menu, setMenu] = useState({ categories: [], menuItems: [] });
  const [loading, setLoading] = useState(true);
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', description: '', price: '', categoryId: '', emoji: '🍽️' });
  const [toast, setToast] = useState('');

  useEffect(() => { api('/api/menu').then(d => setMenu(d)).finally(() => setLoading(false)); }, []);

  const addItem = async (e) => {
    e.preventDefault();
    try {
      await api('/api/menu/items', { method: 'POST', body: JSON.stringify({ ...newItem, price: Number(newItem.price) }) });
      setToast('Item added');
      setShowAddItem(false);
      setNewItem({ name: '', description: '', price: '', categoryId: '', emoji: '🍽️' });
      api('/api/menu').then(d => setMenu(d));
    } catch (err) { setToast(err.message); }
  };

  const deleteItem = async (id) => {
    if (!window.confirm('Remove this item?')) return;
    try { await api(`/api/menu/items/${id}`, { method: 'DELETE' }); api('/api/menu').then(d => setMenu(d)); } catch {}
  };

  if (loading) return <div className="loading-state">Loading menu...</div>;

  return (
    <div className="menu-page">
      <div className="page-header">
        <div><div className="page-title">Menu Management</div><div className="page-subtitle">{menu.menuItems.length} items · {menu.categories.length} categories</div></div>
        <button className="btn-primary" onClick={() => setShowAddItem(true)}><Plus size={16} /> Add Item</button>
      </div>

      <div className="menu-items-grid">
        {menu.menuItems.map(item => (
          <div key={item.id} className="menu-item-card">
            <div className="menu-item-emoji">{item.emoji || '️'}</div>
            <div className="menu-item-info">
              <div className="menu-item-name">{item.name}</div>
              <div className="menu-item-desc">{item.description}</div>
              <div className="menu-item-price">{formatMoney(item.price)}</div>
            </div>
            <button className="menu-item-delete" onClick={() => deleteItem(item.id)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      {showAddItem && (
        <div className="modal-overlay" onClick={() => setShowAddItem(false)}>
          <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Add Menu Item</div>
              <button className="modal-close" onClick={() => setShowAddItem(false)}><X size={18} /></button>
            </div>
            <form onSubmit={addItem} className="modal-body">
              <label className="field"><span className="field-label">Name *</span><input value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} autoFocus required /></label>
              <label className="field"><span className="field-label">Description</span><textarea rows="2" value={newItem.description} onChange={e => setNewItem({ ...newItem, description: e.target.value })} /></label>
              <label className="field"><span className="field-label">Price (ETB) *</span><input type="number" value={newItem.price} onChange={e => setNewItem({ ...newItem, price: e.target.value })} required /></label>
              <label className="field"><span className="field-label">Category</span><select value={newItem.categoryId} onChange={e => setNewItem({ ...newItem, categoryId: e.target.value })}><option value="">Select...</option>{menu.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label className="field"><span className="field-label">Emoji</span><input value={newItem.emoji} onChange={e => setNewItem({ ...newItem, emoji: e.target.value })} /></label>
              <div className="modal-footer">
                <button type="button" className="btn-outline" onClick={() => setShowAddItem(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Add Item</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {toast && <div className="toast"><CheckCircle2 size={16} />{toast}</div>}
    </div>
  );
}

// ==================== Reports Page ====================

function ReportsPage() {
  const [receipts, setReceipts] = useState([]);
  const [period, setPeriod] = useState('7days');
  const [loading, setLoading] = useState(true);

  useEffect(() => { api('/api/receipts').then(d => setReceipts(d.receipts)).finally(() => setLoading(false)); }, []);

  const getFiltered = (p) => {
    const now = new Date();
    const ranges = {
      today: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      '7days': new Date(now.getTime() - 6 * 86400000),
      '30days': new Date(now.getTime() - 29 * 86400000),
      all: new Date(0),
    };
    return receipts.filter(r => new Date(r.printedAt) >= ranges[p]);
  };

  const filtered = getFiltered(period);
  const totals = {};
  filtered.forEach(r => (r.currencyTotals || []).forEach(ct => { totals[ct.currency] = (totals[ct.currency] || 0) + ct.amount; }));

  if (loading) return <div className="loading-state">Loading reports...</div>;

  return (
    <div className="reports-page">
      <div className="page-header">
        <div><div className="page-title">Financial Reports</div><div className="page-subtitle">{filtered.length} transactions in period</div></div>
        <select className="period-select" value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="today">Today</option>
          <option value="7days">Last 7 Days</option>
          <option value="30days">Last 30 Days</option>
          <option value="all">All Time</option>
        </select>
      </div>

      <div className="report-summary">
        {Object.entries(totals).map(([currency, amount]) => (
          <div key={currency} className="report-total-card">
            <div className="report-total-label">{currency}</div>
            <div className="report-total-value">{formatMoney(amount, currency)}</div>
          </div>
        ))}
        {Object.keys(totals).length === 0 && <div className="empty-hint">No revenue in this period</div>}
      </div>

      <div className="report-breakdown">
        <div className="section-title">Transaction Types</div>
        <div className="breakdown-list">
          <div className="breakdown-row">
            <span>Room Checkouts</span>
            <strong>{filtered.filter(r => r.entityType === 'room').length}</strong>
          </div>
          <div className="breakdown-row">
            <span>Table Orders</span>
            <strong>{filtered.filter(r => r.entityType === 'table').length}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== Audit Page ====================

function AuditPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('all');

  useEffect(() => {
    api('/api/audit' + (category !== 'all' ? `?category=${category}` : '')).then(d => setLogs(d.logs)).finally(() => setLoading(false));
  }, [category]);

  if (loading) return <div className="loading-state">Loading audit log...</div>;

  return (
    <div className="audit-page">
      <div className="page-header">
        <div><div className="page-title">Audit Log</div><div className="page-subtitle">{logs.length} recent actions</div></div>
        <select className="category-select" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="all">All Categories</option>
          <option value="auth">Authentication</option>
          <option value="staff">Staff</option>
          <option value="rooms">Rooms</option>
          <option value="stays">Stays</option>
          <option value="orders">Orders</option>
          <option value="receipts">Receipts</option>
          <option value="menu">Menu</option>
          <option value="settings">Settings</option>
        </select>
      </div>

      {logs.length === 0 ? (
        <div className="empty-state"><Activity size={32} /><div className="empty-title">No audit entries</div></div>
      ) : (
        <div className="audit-list">
          {logs.map(log => (
            <div key={log.id} className="audit-entry">
              <div className="audit-icon"><Activity size={16} /></div>
              <div className="audit-info">
                <div className="audit-action">{log.action}</div>
                <div className="audit-meta">{log.performedBy} · {dateLabel(log.performedAt, { time: true })}</div>
              </div>
              <div className="audit-details">{JSON.stringify(log.details)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== Staff Page ====================

function StaffPage() {
  const [staff, setStaff] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newStaff, setNewStaff] = useState({ username: '', name: '', role: 'Cashier', password: '' });
  const [toast, setToast] = useState('');

  useEffect(() => { api('/api/staff').then(d => setStaff(d.staff)); }, []);

  const addStaff = async (e) => {
    e.preventDefault();
    try {
      await api('/api/staff', { method: 'POST', body: JSON.stringify(newStaff) });
      setToast('Staff member added');
      setShowAdd(false);
      setNewStaff({ username: '', name: '', role: 'Cashier', password: '' });
      api('/api/staff').then(d => setStaff(d.staff));
    } catch (err) { setToast(err.message); }
  };

  const deleteStaff = async (id) => {
    if (!window.confirm('Remove this staff member?')) return;
    try { await api(`/api/staff/${id}`, { method: 'DELETE' }); api('/api/staff').then(d => setStaff(d.staff)); } catch {}
  };

  return (
    <div className="staff-page">
      <div className="page-header">
        <div><div className="page-title">Staff Management</div><div className="page-subtitle">{staff.length} team members</div></div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Add Staff</button>
      </div>

      <div className="staff-list">
        {staff.map(s => (
          <div key={s.id} className="staff-card">
            <div className="staff-avatar">{initials(s.name)}</div>
            <div className="staff-info">
              <div className="staff-name">{s.name}</div>
              <div className="staff-username">@{s.username}</div>
            </div>
            <div className={`staff-role ${s.role.toLowerCase()}`}>{s.role}</div>
            <button className="staff-delete" onClick={() => deleteStaff(s.id)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Add Staff Member</div>
              <button className="modal-close" onClick={() => setShowAdd(false)}><X size={18} /></button>
            </div>
            <form onSubmit={addStaff} className="modal-body">
              <label className="field"><span className="field-label">Full Name *</span><input value={newStaff.name} onChange={e => setNewStaff({ ...newStaff, name: e.target.value })} autoFocus required /></label>
              <label className="field"><span className="field-label">Username *</span><input value={newStaff.username} onChange={e => setNewStaff({ ...newStaff, username: e.target.value })} required /></label>
              <label className="field"><span className="field-label">Password * (min 6 chars)</span><input type="password" value={newStaff.password} onChange={e => setNewStaff({ ...newStaff, password: e.target.value })} required minLength="6" /></label>
              <label className="field"><span className="field-label">Role</span><select value={newStaff.role} onChange={e => setNewStaff({ ...newStaff, role: e.target.value })}><option>Cashier</option><option>Admin</option></select></label>
              <div className="modal-footer">
                <button type="button" className="btn-outline" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Add Staff</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {toast && <div className="toast"><CheckCircle2 size={16} />{toast}</div>}
    </div>
  );
}

// ==================== Template Page ====================

function TemplatePage() {
  const [template, setTemplate] = useState({});
  const [form, setForm] = useState({});
  const [toast, setToast] = useState('');

  useEffect(() => {
    api('/api/receipt-template').then(d => {
      setTemplate(d.template);
      setForm(d.template);
    });
  }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/api/receipt-template', { method: 'PUT', body: JSON.stringify(form) });
      setToast('Template saved');
    } catch (err) { setToast(err.message); }
  };

  return (
    <div className="template-page">
      <div className="page-header">
        <div><div className="page-title">Receipt Template</div><div className="page-subtitle">Customize your receipt layout</div></div>
      </div>

      <form onSubmit={save} className="template-form">
        <label className="field"><span className="field-label">Hotel Name</span><input value={form.hotelName || ''} onChange={e => setForm({ ...form, hotelName: e.target.value })} /></label>
        <label className="field"><span className="field-label">TIN</span><input value={form.tin || ''} onChange={e => setForm({ ...form, tin: e.target.value })} /></label>
        <label className="field"><span className="field-label">Address</span><textarea rows="3" value={form.addressLines || ''} onChange={e => setForm({ ...form, addressLines: e.target.value })} /></label>
        <label className="field"><span className="field-label">Phone</span><input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
        <label className="field"><span className="field-label">FS Number</span><input value={form.fsNo || ''} onChange={e => setForm({ ...form, fsNo: e.target.value })} /></label>
        <label className="field"><span className="field-label">Invoice Title</span><input value={form.invoiceTitle || ''} onChange={e => setForm({ ...form, invoiceTitle: e.target.value })} /></label>
        <label className="field"><span className="field-label">Footer</span><textarea rows="3" value={form.footerLines || ''} onChange={e => setForm({ ...form, footerLines: e.target.value })} /></label>
        <button type="submit" className="btn-primary">Save Template</button>
      </form>
      {toast && <div className="toast"><CheckCircle2 size={16} />{toast}</div>}
    </div>
  );
}

// ==================== Settings Page ====================

function SettingsPage() {
  const [settings, setSettings] = useState({});
  const [toast, setToast] = useState('');

  useEffect(() => { api('/api/settings').then(d => setSettings(d.settings)); }, []);

  const save = async () => {
    try { await api('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }); setToast('Settings saved'); } catch (err) { setToast(err.message); }
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <div><div className="page-title">System Settings</div><div className="page-subtitle">Hotel configuration</div></div>
        <button className="btn-primary" onClick={save}>Save Settings</button>
      </div>

      <div className="settings-form">
        <label className="field"><span className="field-label">Hotel Name</span><input value={settings.hotel_name || ''} onChange={e => setSettings({ ...settings, hotel_name: e.target.value })} /></label>
        <label className="field"><span className="field-label">Timezone</span><input value={settings.hotel_timezone || ''} onChange={e => setSettings({ ...settings, hotel_timezone: e.target.value })} /></label>
        <label className="field"><span className="field-label">Default Currency</span><input value={settings.hotel_currency || ''} onChange={e => setSettings({ ...settings, hotel_currency: e.target.value })} /></label>
        <label className="field"><span className="field-label">Phone</span><input value={settings.hotel_phone || ''} onChange={e => setSettings({ ...settings, hotel_phone: e.target.value })} /></label>
        <label className="field"><span className="field-label">Address</span><textarea rows="3" value={settings.hotel_address || ''} onChange={e => setSettings({ ...settings, hotel_address: e.target.value })} /></label>
      </div>
      {toast && <div className="toast"><CheckCircle2 size={16} />{toast}</div>}
    </div>
  );
}
