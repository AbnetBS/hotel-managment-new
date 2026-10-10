import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import QRCode from 'qrcode';
import {
  ArrowUpRight,
  BedDouble,
  Bell,
  CalendarDays,
  ChartColumn,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Coffee,
  Download,
  Eye,
  FileText,
  ImagePlus,
  LayoutDashboard,
  LogOut,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UserRound,
  Users,
  Utensils,
  WalletCards,
  X,
} from 'lucide-react';
import {
  CURRENCIES,
  ETB,
  cloneSeed,
  dateLabel,
  formatMoney,
  getOrderTotal,
  getStayDays,
  makeId,
  timeAgo,
} from './utils.js';

const ORDER_QUERY = new URLSearchParams(window.location.search).get('order');
const VALID_ROLES = ['Admin', 'Cashier'];
const PAYMENT_METHODS = ['Cash', 'Card', 'Bank transfer', 'Mobile money'];
const PAGE_TITLES = {
  dashboard: 'Overview',
  desk: 'Front desk',
  rooms: 'Rooms & QR codes',
  menu: 'Menu builder',
  template: 'Receipt template',
  archive: 'Receipt archive',
  reports: 'Reports',
  staff: 'Staff & access',
};

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function currentDateLong() {
  return new Intl.DateTimeFormat('en-ET', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());
}

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'H';
}

function calculateAddonTotal(addons = []) {
  return addons.reduce((total, line) => total + (Number(line.qty) || 0) * (Number(line.unitPrice) || 0), 0);
}

function getCurrencyTotals(receipt) {
  if (Array.isArray(receipt?.currencyTotals)) return receipt.currencyTotals;
  const totals = new Map();
  (receipt?.lines || []).forEach((line) => {
    const currency = line.currency || ETB;
    totals.set(currency, (totals.get(currency) || 0) + Number(line.amount || 0));
  });
  return [...totals.entries()].map(([currency, amount]) => ({ currency, amount }));
}

function makeInvoice(sequence, date = new Date()) {
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `INV-${day}-${String(sequence).padStart(4, '0')}`;
}

function makeReceipt({ data, operator, label, guestName, lines, paymentMethod, entityType, roomDays = 0, roomRate = 0, roomCurrency = ETB }) {
  const date = new Date();
  const sequence = Number(data.receiptSequence || 1);
  const currencyTotalsMap = new Map();
  lines.forEach((line) => {
    currencyTotalsMap.set(line.currency || ETB, (currencyTotalsMap.get(line.currency || ETB) || 0) + Number(line.amount || 0));
  });
  const currencyTotals = [...currencyTotalsMap.entries()].map(([currency, amount]) => ({ currency, amount }));
  return {
    id: makeId('receipt'),
    invoiceNo: makeInvoice(sequence, date),
    orderNo: `ORD-${String(sequence).padStart(5, '0')}`,
    printedAt: date.toISOString(),
    printedBy: operator,
    operator,
    waiter: entityType === 'room' ? 'Front desk' : operator,
    tableLabel: label,
    guestName: guestName || 'Walk-in guest',
    entityType,
    paymentMethod: paymentMethod || 'Cash',
    roomDays,
    roomRate,
    roomCurrency,
    lines,
    currencyTotals,
    itemCount: lines.reduce((sum, line) => sum + Math.max(0, Number(line.qty) || 0), 0),
    template: { ...data.receiptTemplate },
    printCount: 1,
    lastPrintedAt: date.toISOString(),
    lastPrintedBy: operator,
    printEvents: [{ at: date.toISOString(), by: operator }],
  };
}

function roomReceipt(room, data, operator, paymentMethod) {
  const days = getStayDays(room.checkInAt);
  const roomTotal = days * Number(room.ratePerNight || 0);
  const addons = room.addons || [];
  const lines = [
    {
      id: makeId('line'),
      description: `Room ${room.number} · ${days} day${days === 1 ? '' : 's'}`,
      qty: days,
      price: Number(room.ratePerNight || 0),
      amount: roomTotal,
      currency: room.currency || ETB,
      kind: 'room',
    },
    ...addons.map((line) => ({
      id: makeId('line'),
      description: line.name,
      qty: Number(line.qty) || 1,
      price: Number(line.unitPrice) || 0,
      amount: (Number(line.qty) || 1) * (Number(line.unitPrice) || 0),
      currency: ETB,
      kind: line.kind || 'service',
    })),
  ];
  return makeReceipt({
    data,
    operator,
    label: `Room ${room.number}`,
    guestName: room.guest?.name,
    lines,
    paymentMethod,
    entityType: 'room',
    roomDays: days,
    roomRate: Number(room.ratePerNight || 0),
    roomCurrency: room.currency || ETB,
  });
}

function orderReceipt(order, data, operator, paymentMethod = 'Cash') {
  const lines = (order.items || []).map((item) => ({
    id: makeId('line'),
    description: item.name,
    qty: Number(item.qty) || 1,
    price: Number(item.unitPrice) || 0,
    amount: (Number(item.qty) || 1) * (Number(item.unitPrice) || 0),
    currency: ETB,
    kind: 'food',
  }));
  return makeReceipt({
    data,
    operator,
    label: order.targetLabel || 'Table order',
    guestName: order.guestName || (order.targetType === 'room' ? 'Room guest' : 'Walk-in guest'),
    lines,
    paymentMethod,
    entityType: order.targetType === 'room' ? 'room-order' : 'table',
  });
}

function App() {
  const [data, setData] = useState(() => cloneSeed());
  const [loaded, setLoaded] = useState(false);
  const [apiOnline, setApiOnline] = useState(true);
  const versionRef = useRef(0);
  const localEditRef = useRef(0);
  const [role, setRole] = useState(() => {
    const stored = sessionStorage.getItem('haven-role');
    return VALID_ROLES.includes(stored) ? stored : '';
  });
  const [operator, setOperator] = useState(() => sessionStorage.getItem('haven-operator') || 'Liya Alemu');
  const [page, setPage] = useState(() => sessionStorage.getItem('haven-role') === 'Cashier' ? 'desk' : 'dashboard');
  const [activeRoom, setActiveRoom] = useState(null);
  const [checkInRoom, setCheckInRoom] = useState(null);
  const [outdoorRoom, setOutdoorRoom] = useState(null);
  const [serviceRoom, setServiceRoom] = useState(null);
  const [previewReceipt, setPreviewReceipt] = useState(null);
  const [printReceipt, setPrintReceipt] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/state')
      .then((response) => {
        if (!response.ok) throw new Error('Hotel API is not available');
        return response.json();
      })
      .then((payload) => {
        if (!alive) return;
        const remote = payload.state || payload;
        setData({ ...cloneSeed(), ...remote });
        versionRef.current = Number(payload.version) || 0;
        setApiOnline(true);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        const fallback = safeJson(localStorage.getItem('haven-hotel-state'), cloneSeed());
        setData({ ...cloneSeed(), ...fallback });
        setApiOnline(false);
        setLoaded(true);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!loaded) return undefined;
    try { localStorage.setItem('haven-hotel-state', JSON.stringify(data)); } catch { /* large uploaded images can exceed local cache */ }
    if (!localEditRef.current) return undefined;
    const editedAt = localEditRef.current;
    const timer = window.setTimeout(() => {
      fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: data }),
      })
        .then((response) => {
          if (!response.ok) throw new Error('Could not sync hotel changes');
          return response.json();
        })
        .then((payload) => {
          versionRef.current = Number(payload.version) || versionRef.current;
          setApiOnline(true);
          if (localEditRef.current === editedAt) localEditRef.current = 0;
        })
        .catch(() => setApiOnline(false));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [data, loaded]);

  useEffect(() => {
    if (!loaded) return undefined;
    const poll = window.setInterval(() => {
      fetch('/api/state')
        .then((response) => response.ok ? response.json() : null)
        .then((payload) => {
          if (!payload?.state || Number(payload.version) <= versionRef.current) return;
          versionRef.current = Number(payload.version) || versionRef.current;
          setApiOnline(true);
          if (localEditRef.current && Date.now() - localEditRef.current < 1200) {
            setData((current) => ({ ...current, qrOrders: payload.state.qrOrders || current.qrOrders }));
          } else {
            localEditRef.current = 0;
            setData({ ...cloneSeed(), ...payload.state });
          }
        })
        .catch(() => setApiOnline(false));
    }, 4000);
    return () => window.clearInterval(poll);
  }, [loaded]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const updateData = (updater) => {
    localEditRef.current = Date.now();
    setData((current) => typeof updater === 'function' ? updater(current) : updater);
  };

  const notify = (message) => setToast(message);

  const selectRole = (nextRole, name) => {
    if (!VALID_ROLES.includes(nextRole)) return;
    const operatorName = name?.trim() || (nextRole === 'Admin' ? 'Evelyn Tesfaye' : 'Liya Alemu');
    sessionStorage.setItem('haven-role', nextRole);
    sessionStorage.setItem('haven-operator', operatorName);
    setRole(nextRole);
    setOperator(operatorName);
    setPage(nextRole === 'Cashier' ? 'desk' : 'dashboard');
  };

  const signOut = () => {
    sessionStorage.removeItem('haven-role');
    setRole('');
    setPage('dashboard');
  };

  const handleQrOrder = async (orderDraft) => {
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderDraft),
      });
      if (!response.ok) throw new Error('Could not send your order. Please ask a team member.');
      const payload = await response.json();
      versionRef.current = Math.max(versionRef.current, Number(payload.version) || 0);
      setData((current) => ({ ...current, qrOrders: payload.state?.qrOrders || [...current.qrOrders, payload.order] }));
      return true;
    } catch {
      return false;
    }
  };

  const removeOrder = async (orderId) => {
    try {
      await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' });
    } catch { /* the data sync below remains a fallback */ }
    updateData((current) => ({ ...current, qrOrders: current.qrOrders.filter((order) => order.id !== orderId) }));
  };

  const performPrint = (receipt, { isNew = false, releaseRoomId = null, removeOrderId = null } = {}) => {
    let nextState = data;
    if (isNew) {
      nextState = {
        ...data,
        receipts: [receipt, ...data.receipts],
        receiptSequence: Number(data.receiptSequence || 1) + 1,
      };
    } else {
      const event = { at: new Date().toISOString(), by: operator };
      nextState = {
        ...data,
        receipts: data.receipts.map((saved) => saved.id === receipt.id
          ? { ...saved, printCount: Number(saved.printCount || 1) + 1, lastPrintedAt: event.at, lastPrintedBy: operator, printEvents: [...(saved.printEvents || []), event] }
          : saved),
      };
    }
    if (removeOrderId) nextState = { ...nextState, qrOrders: nextState.qrOrders.filter((order) => order.id !== removeOrderId) };
    localEditRef.current = Date.now();
    setData(nextState);
    try { localStorage.setItem('haven-hotel-state', JSON.stringify(nextState)); } catch { /* server is the primary store */ }
    flushSync(() => setPrintReceipt(receipt));
    try {
      window.print();
    } catch {
      notify('Receipt saved to the archive. Your browser could not open the printer dialog.');
    }
    flushSync(() => setPrintReceipt(null));
    if (releaseRoomId) {
      updateData((current) => ({
        ...current,
        rooms: current.rooms.map((room) => room.id === releaseRoomId
          ? { ...room, status: 'available', guest: null, checkInAt: null, ratePerNight: null, currency: ETB, addons: [] }
          : room),
      }));
      setActiveRoom(null);
      notify('Checkout complete. Receipt archived and room is available.');
    } else if (removeOrderId) {
      notify('Order receipt printed and saved to the archive.');
    } else {
      notify('Receipt printed and saved to the archive.');
    }
  };

  const handleCheckout = (room, paymentMethod) => {
    const receipt = roomReceipt(room, data, operator, paymentMethod);
    performPrint(receipt, { isNew: true, releaseRoomId: room.id });
  };

  const handleSettleOrder = (order, paymentMethod = 'Cash') => {
    const receipt = orderReceipt(order, data, operator, paymentMethod);
    performPrint(receipt, { isNew: true, removeOrderId: order.id });
  };


  if (!loaded) return <div className="app-loading"><div className="loading-mark"><BedDouble size={26} /></div><span>Opening your hotel desk…</span></div>;

  if (ORDER_QUERY) {
    return <GuestOrderingPage data={data} targetKey={ORDER_QUERY} onSubmit={handleQrOrder} />;
  }

  if (!role) return <SignInScreen onSignIn={selectRole} />;

  const navItems = role === 'Admin'
    ? [
        { key: 'dashboard', label: 'Overview', icon: LayoutDashboard },
        { key: 'desk', label: 'Front desk', icon: BedDouble },
        { key: 'rooms', label: 'Rooms & QR codes', icon: QrCode },
        { key: 'menu', label: 'Menu builder', icon: Utensils },
        { key: 'template', label: 'Receipt template', icon: ReceiptText },
        { key: 'archive', label: 'Receipt archive', icon: FileText },
        { key: 'reports', label: 'Reports', icon: ChartColumn },
        { key: 'staff', label: 'Staff & access', icon: Users },
      ]
    : [
        { key: 'desk', label: 'Front desk', icon: BedDouble },
      ];

  const title = PAGE_TITLES[page] || 'Front desk';
  const canManage = role === 'Admin';

  const addCheckIn = (roomId, guest, rate, currency) => {
    updateData((current) => ({
      ...current,
      rooms: current.rooms.map((room) => room.id === roomId
        ? { ...room, status: 'occupied', guest, checkInAt: new Date().toISOString(), ratePerNight: Number(rate), currency, addons: [] }
        : room),
    }));
    setCheckInRoom(null);
    notify('Guest checked in. Room is now occupied.');
  };

  const addRoomLines = (roomId, lines) => {
    updateData((current) => ({
      ...current,
      rooms: current.rooms.map((room) => room.id === roomId
        ? { ...room, addons: [...(room.addons || []), ...lines.map((line) => ({ ...line, id: makeId('addon') }))] }
        : room),
    }));
    setOutdoorRoom(null);
    setServiceRoom(null);
    setActiveRoom(data.rooms.find((room) => room.id === roomId) || null);
    notify('Saved to the guest bill. Food and services stay in ETB.');
  };

  const addOrderToRoom = (order) => {
    const targetRoom = data.rooms.find((room) => room.id === order.targetId);
    if (!targetRoom || targetRoom.status !== 'occupied') {
      notify('That room is not checked in, so the order was left in the queue.');
      return;
    }
    updateData((current) => ({
      ...current,
      rooms: current.rooms.map((room) => room.id === order.targetId
        ? { ...room, addons: [...(room.addons || []), ...order.items.map((item) => ({ id: makeId('addon'), name: item.name, qty: item.qty, unitPrice: item.unitPrice, kind: 'food' }))] }
        : room),
      qrOrders: current.qrOrders.filter((entry) => entry.id !== order.id),
    }));
    notify(`${order.targetLabel} order added to the room bill.`);
  };

  return (
    <div className={`app-shell ${page === 'desk' ? 'cashier-reference-theme' : ''}`}>
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><BedDouble size={21} strokeWidth={2.2} /></div>
          <div><div className="brand-name">Haven House</div><div className="brand-caption">HOTEL DESK</div></div>
        </div>
        <div className="property-switcher">
          <div className="property-thumb">H</div>
          <div className="property-info"><strong>Haven House Hotel</strong><span>Addis Ababa, ET</span></div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-kicker">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button key={item.key} className={`nav-link ${page === item.key ? 'active' : ''}`} onClick={() => setPage(item.key)}>
              <Icon size={18} strokeWidth={1.85} /><span>{item.label}</span>
              {item.key === 'desk' && data.qrOrders.filter((order) => order.status === 'new').length > 0 && <span className="nav-count">{data.qrOrders.filter((order) => order.status === 'new').length}</span>}
            </button>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className={`connection-status ${apiOnline ? '' : 'offline'}`}><span className="status-dot" />{apiOnline ? 'Data synced' : 'Offline · local backup'}</div>
          <div className="user-card">
            <div className="user-avatar">{initials(operator)}</div>
            <div className="user-detail"><strong>{operator}</strong><span>{role}</span></div>
            <button className="icon-button user-menu" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={16} /></button>
          </div>
          <div className="role-switch-note">Only Admin and Cashier access</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-heading"><div className="breadcrumb">Haven House <ChevronRight size={14} /> <span>{title}</span></div><h1>{title}</h1></div>
          <div className="topbar-actions">
            <div className="date-pill"><CalendarDays size={16} /><span>{currentDateLong()}</span></div>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={18} /><span className="notification-dot" /></button>
            <div className="operator-chip"><div className="user-avatar small">{initials(operator)}</div><div><strong>{operator}</strong><span>{role}</span></div><button className="role-menu-trigger" aria-label="Switch role" title="Switch role" onClick={() => selectRole(role === 'Admin' ? 'Cashier' : 'Admin', role === 'Admin' ? 'Liya Alemu' : 'Evelyn Tesfaye')}><ChevronDown size={14} /></button></div>
          </div>
        </header>

        <div className="page-content">
          {page === 'dashboard' && canManage && <AdminOverview data={data} onNavigate={setPage} />}
          {page === 'desk' && <FrontDesk data={data} role={role} onOpenRoom={(room) => room.status === 'available' ? setCheckInRoom(room) : setActiveRoom(room)} onSettleOrder={handleSettleOrder} onAddOrderToRoom={addOrderToRoom} onRemoveOrder={removeOrder} />}
          {page === 'rooms' && canManage && <RoomQrManagement data={data} updateData={updateData} notify={notify} />}
          {page === 'menu' && canManage && <MenuBuilder data={data} updateData={updateData} notify={notify} />}
          {page === 'template' && canManage && <ReceiptTemplatePage template={data.receiptTemplate} onSave={(template) => { updateData((current) => ({ ...current, receiptTemplate: template })); notify('Receipt template saved for new prints.'); }} />}
          {page === 'archive' && canManage && <ReceiptArchive receipts={data.receipts} onOpen={setPreviewReceipt} onPrint={(receipt) => performPrint(receipt)} />}
          {page === 'reports' && canManage && <ReportsPage receipts={data.receipts} />}
          {page === 'staff' && canManage && <StaffPage staff={data.staff} updateData={updateData} notify={notify} />}
        </div>
      </main>

      {activeRoom && <RoomBillDrawer room={data.rooms.find((room) => room.id === activeRoom.id) || activeRoom} onClose={() => setActiveRoom(null)} onOutdoor={() => setOutdoorRoom(data.rooms.find((room) => room.id === activeRoom.id) || activeRoom)} onService={() => setServiceRoom(data.rooms.find((room) => room.id === activeRoom.id) || activeRoom)} onCheckout={handleCheckout} />}
      {checkInRoom && <CheckInModal room={checkInRoom} onClose={() => setCheckInRoom(null)} onSave={addCheckIn} />}
      {outdoorRoom && <OutdoorOrderModal data={data} onClose={() => setOutdoorRoom(null)} onSave={(lines) => addRoomLines(outdoorRoom.id, lines)} />}
      {serviceRoom && <OtherServiceModal onClose={() => setServiceRoom(null)} onSave={(lines) => addRoomLines(serviceRoom.id, lines)} />}
      {previewReceipt && <ReceiptPreviewModal receipt={previewReceipt} onClose={() => setPreviewReceipt(null)} onPrint={() => performPrint(previewReceipt)} />}
      {printReceipt && <div className="print-only-layer"><ReceiptPaper receipt={printReceipt} /></div>}
      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
    </div>
  );
}

function SignInScreen({ onSignIn }) {
  const [selectedRole, setSelectedRole] = useState('Cashier');
  const [name, setName] = useState('Liya Alemu');
  const chooseRole = (next) => {
    setSelectedRole(next);
    setName(next === 'Admin' ? 'Evelyn Tesfaye' : 'Liya Alemu');
  };
  return <div className="signin-page">
    <div className="signin-art"><div className="signin-art-orb orb-one" /><div className="signin-art-orb orb-two" /><div className="signin-brand"><div className="brand-mark light"><BedDouble size={21} /></div><span>Haven House</span></div><div className="signin-art-copy"><span className="eyebrow light-eyebrow">A CALMER WAY TO HOST</span><h1>Make every<br />stay feel special.</h1><p>A thoughtful front desk for rooms, guest orders and clear receipts.</p><div className="signin-art-note"><ShieldCheck size={16} /> Simple access for your hotel team</div></div><div className="art-horizon"><div className="art-building building-back" /><div className="art-building building-front" /><div className="art-window window-a" /><div className="art-window window-b" /><div className="art-window window-c" /><div className="art-plant">✦</div></div></div>
    <div className="signin-panel"><div className="signin-panel-inner"><div className="mobile-brand"><div className="brand-mark"><BedDouble size={19} /></div><strong>Haven House</strong></div><span className="eyebrow">WELCOME BACK</span><h2>Sign in to your desk</h2><p className="muted">Choose one of the two hotel roles to continue.</p>
      <div className="role-choice-grid">
        <button className={`role-choice ${selectedRole === 'Admin' ? 'selected' : ''}`} onClick={() => chooseRole('Admin')}><span className="role-icon admin-role"><Settings2 size={19} /></span><strong>Admin</strong><small>Manage hotel setup and reports</small><span className="radio-dot" /></button>
        <button className={`role-choice ${selectedRole === 'Cashier' ? 'selected' : ''}`} onClick={() => chooseRole('Cashier')}><span className="role-icon cashier-role"><WalletCards size={19} /></span><strong>Cashier</strong><small>Rooms, orders and checkout</small><span className="radio-dot" /></button>
      </div>
      <label className="field-label" htmlFor="operator-name">Your name</label><div className="input-with-icon"><UserRound size={17} /><input id="operator-name" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onSignIn(selectedRole, name)} placeholder="Name for printed receipts" /></div>
      <button className="button button-primary signin-submit" onClick={() => onSignIn(selectedRole, name)}>Continue as {selectedRole}<ChevronRight size={17} /></button>
      <div className="signin-footnote"><ShieldCheck size={15} /> Role-based demo sign-in · no other roles</div>
    </div></div>
  </div>;
}

function AdminOverview({ data, onNavigate }) {
  const occupied = data.rooms.filter((room) => room.status === 'occupied').length;
  const available = data.rooms.length - occupied;
  const today = new Date().toDateString();
  const printedToday = data.receipts.filter((receipt) => new Date(receipt.printedAt).toDateString() === today);
  const totalOrders = data.qrOrders.filter((order) => order.status === 'new').length;
  const todayGroups = aggregateCurrencyTotals(printedToday);
  return <div className="page-stack">
    <div className="welcome-banner"><div><span className="eyebrow">TODAY AT A GLANCE</span><h2>Good day, hotel team <span className="wave">✦</span></h2><p>Here’s what’s happening at Haven House today.</p></div><div className="welcome-date"><CalendarDays size={18} /><div><strong>{currentDateLong().split(',').slice(1).join(',').trim()}</strong><span>Addis Ababa · Ethiopia</span></div></div></div>
    <div className="metric-grid">
      <MetricCard icon={BedDouble} iconTone="green" label="Rooms occupied" value={`${occupied} / ${data.rooms.length}`} detail={`${available} available to check in`} trend={`${Math.round((occupied / Math.max(data.rooms.length, 1)) * 100)}% occupancy`} />
      <MetricCard icon={ReceiptText} iconTone="blue" label="Receipts printed today" value={String(printedToday.length).padStart(2, '0')} detail="All completed checkouts and bills" trend="View archive" onClick={() => onNavigate('archive')} />
      <MetricCard icon={ShoppingBag} iconTone="orange" label="Orders to review" value={String(totalOrders).padStart(2, '0')} detail="New table and room QR orders" trend="Open front desk" onClick={() => onNavigate('desk')} />
      <MetricCard icon={CircleDollarSign} iconTone="violet" label="Today's printed total" value={todayGroups.length ? todayGroups.map((entry) => formatMoney(entry.amount, entry.currency)).join(' · ') : formatMoney(0, ETB)} detail="Shown separately by currency" trend="Reports" onClick={() => onNavigate('reports')} />
    </div>
    <section className="panel overview-panel"><div className="panel-heading"><div><span className="eyebrow">ROOM STATUS</span><h3>Rooms at a glance</h3><p>Orange is occupied. Green is available.</p></div><button className="button button-outline button-small" onClick={() => onNavigate('desk')}>Open front desk<ArrowUpRight size={15} /></button></div><div className="overview-room-strip">{data.rooms.slice(0, 6).map((room) => <div key={room.id} className={`overview-room ${room.status}`}><span className="room-number">{room.number}</span><span>{room.status === 'occupied' ? room.guest?.name : room.type}</span><small>{room.status === 'occupied' ? 'Occupied' : 'Available'}</small></div>)}</div></section>
    <div className="overview-bottom-grid"><section className="panel quick-actions-panel"><div className="panel-heading"><div><span className="eyebrow">QUICK ACCESS</span><h3>Hotel setup</h3></div></div><div className="quick-action-list"><QuickAction icon={QrCode} title="Rooms & unique QR codes" description="Edit room rates, tables and QR links" onClick={() => onNavigate('rooms')} /><QuickAction icon={Utensils} title="Build your menu" description="Add categories, dishes and photos" onClick={() => onNavigate('menu')} /><QuickAction icon={ReceiptText} title="Receipt paper template" description="Update TIN, hotel details and footer" onClick={() => onNavigate('template')} /></div></section><section className="panel overview-recent"><div className="panel-heading"><div><span className="eyebrow">RECENT PRINTS</span><h3>Latest receipts</h3></div><button className="text-button" onClick={() => onNavigate('archive')}>See all<ChevronRight size={14} /></button></div>{data.receipts.length ? data.receipts.slice(0, 4).map((receipt) => <ReceiptMiniRow key={receipt.id} receipt={receipt} />) : <EmptyState icon={ReceiptText} title="No receipts yet" text="Printed bills and checkouts will show up here." />}</section></div>
  </div>;
}

function MetricCard({ icon: Icon, iconTone, label, value, detail, trend, onClick }) {
  return <button className={`metric-card ${onClick ? 'clickable' : ''}`} onClick={onClick} disabled={!onClick}><div className="metric-top"><div className={`metric-icon ${iconTone}`}><Icon size={19} /></div>{onClick && <ArrowUpRight size={15} className="metric-arrow" />}</div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><span className="metric-detail">{detail}</span><span className="metric-trend">{trend}</span></button>;
}

function QuickAction({ icon: Icon, title, description, onClick }) {
  return <button className="quick-action" onClick={onClick}><span className="quick-action-icon"><Icon size={18} /></span><span className="quick-action-copy"><strong>{title}</strong><small>{description}</small></span><ChevronRight size={16} /></button>;
}

function FrontDesk({ data, role, onOpenRoom, onSettleOrder, onAddOrderToRoom, onRemoveOrder }) {
  const [statusFilter, setStatusFilter] = useState('All rooms');
  const [query, setQuery] = useState('');
  const [orderPayment, setOrderPayment] = useState({});
  const occupied = data.rooms.filter((room) => room.status === 'occupied').length;
  const available = data.rooms.length - occupied;
  const visibleRooms = data.rooms.filter((room) => {
    const matchesStatus = statusFilter === 'All rooms' || (statusFilter === 'Occupied' ? room.status === 'occupied' : room.status === 'available');
    const search = query.toLowerCase().trim();
    const matchesQuery = !search || room.number.toLowerCase().includes(search) || room.guest?.name?.toLowerCase().includes(search);
    return matchesStatus && matchesQuery;
  });
  const newOrders = [...data.qrOrders].filter((order) => order.status !== 'completed').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const today = new Date().toDateString();
  const todayReceipts = data.receipts.filter((receipt) => new Date(receipt.printedAt).toDateString() === today).length;
  return <div className="page-stack desk-page">
    <div className="desk-welcome"><div><span className="eyebrow">FRONT DESK · {role.toUpperCase()}</span><h2>Ready for your next guest?</h2><p>Choose a free room to check in, or open an occupied room to see its live bill.</p></div><div className="desk-clock"><Clock3 size={18} /><span>{new Intl.DateTimeFormat('en-ET', { hour: '2-digit', minute: '2-digit' }).format(new Date())}</span></div></div>
    <div className="desk-stat-row"><div className="desk-stat"><span className="desk-stat-icon green-soft"><BedDouble size={18} /></span><div><span>Available</span><strong>{available}<small> rooms</small></strong></div></div><div className="desk-stat"><span className="desk-stat-icon orange-soft"><UserRound size={18} /></span><div><span>Occupied</span><strong>{occupied}<small> rooms</small></strong></div></div><div className="desk-stat"><span className="desk-stat-icon blue-soft"><ShoppingBag size={18} /></span><div><span>New QR orders</span><strong>{newOrders.length}<small> to review</small></strong></div></div><div className="desk-stat"><span className="desk-stat-icon violet-soft"><ReceiptText size={18} /></span><div><span>Printed today</span><strong>{todayReceipts}<small> receipts</small></strong></div></div></div>
    <section className="desk-section"><div className="section-title-row"><div><div className="title-with-count"><h3>Rooms</h3><span className="count-pill">{data.rooms.length}</span></div><p className="muted">Tap any room rectangle to open its check-in or active bill.</p></div><div className="room-controls"><div className="room-search"><Search size={15} /><input aria-label="Search rooms or guests" placeholder="Room or guest" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘ K</kbd></div><div className="segmented-control">{['All rooms', 'Occupied', 'Available'].map((filter) => <button key={filter} className={statusFilter === filter ? 'selected' : ''} onClick={() => setStatusFilter(filter)}>{filter}</button>)}</div></div></div>
      {visibleRooms.length ? <div className="room-grid">{visibleRooms.map((room) => <RoomCard key={room.id} room={room} onClick={() => onOpenRoom(room)} />)}</div> : <EmptyState icon={Search} title="No matching rooms" text="Try another room number or guest name." />}
    </section>
    <section className="desk-section order-section"><div className="section-title-row"><div><div className="title-with-count"><h3>QR orders</h3>{newOrders.length > 0 && <span className="count-pill count-pill-orange">{newOrders.length} new</span>}</div><p className="muted">Orders sent from the room and table menus appear here, below the rooms.</p></div><span className="live-indicator"><span />Live desk</span></div>
      {newOrders.length ? <div className="order-grid">{newOrders.map((order) => <QrOrderCard key={order.id} order={order} paymentMethod={orderPayment[order.id] || 'Cash'} onPayment={(payment) => setOrderPayment((current) => ({ ...current, [order.id]: payment }))} onSettle={() => onSettleOrder(order, orderPayment[order.id] || 'Cash')} onAddToRoom={() => onAddOrderToRoom(order)} onDismiss={() => onRemoveOrder(order.id)} />)}</div> : <div className="empty-order-strip"><div className="empty-order-icon"><QrCode size={19} /></div><div><strong>All caught up</strong><span>New scanned-menu orders will appear here with their Table or Room label.</span></div></div>}
    </section>
    <div className="desk-footnote"><ShieldCheck size={15} /><span>Room prices are set per guest at check-in. Food and other services are recorded separately in ETB.</span></div>
  </div>;
}

function RoomCard({ room, onClick }) {
  const occupied = room.status === 'occupied';
  const days = occupied ? getStayDays(room.checkInAt) : 0;
  const guestSummary = occupied ? `${room.guest?.name || 'Guest'} · ${days} day${days === 1 ? '' : 's'} · ${formatMoney(room.ratePerNight, room.currency)}/night` : 'Tap to check in';
  return <button className={`room-card ${occupied ? 'occupied' : 'available'}`} onClick={onClick} title={`${occupied ? 'Open active bill' : 'Check in'} · Room ${room.number} · ${guestSummary}`} aria-label={`${occupied ? 'Occupied' : 'Free'} room ${room.number}. ${guestSummary}`}>
    <span className="room-tile-label">Room {room.number}</span>
    <span className={`room-tile-status ${occupied ? 'occupied' : 'available'}`}>{occupied ? 'OCCUPIED' : 'FREE'}</span>
  </button>;
}

function QrOrderCard({ order, paymentMethod, onPayment, onSettle, onAddToRoom, onDismiss }) {
  const amount = getOrderTotal(order);
  const isRoom = order.targetType === 'room';
  return <article className="qr-order-card"><div className="qr-order-head"><div className={`order-type-icon ${isRoom ? 'order-room' : 'order-table'}`}>{isRoom ? <BedDouble size={18} /> : <Utensils size={18} />}</div><div className="order-target"><strong>{order.targetLabel || (isRoom ? 'Room order' : 'Table order')}</strong><span>{timeAgo(order.createdAt)}</span></div><span className="order-new-tag">New</span><button className="icon-button subtle" onClick={onDismiss} title="Remove order" aria-label="Remove order"><X size={16} /></button></div><div className="qr-order-lines">{order.items.map((item) => <div className="qr-order-line" key={item.id}><span><b>{item.qty}×</b> {item.name}</span><span>{formatMoney(item.qty * item.unitPrice, ETB)}</span></div>)}</div><div className="qr-order-total"><span>Order total</span><strong>{formatMoney(amount, ETB)}</strong></div>{isRoom ? <button className="button button-primary button-full" onClick={onAddToRoom}>Add to room bill<ChevronRight size={15} /></button> : <div className="order-settle-actions"><select className="compact-select" value={paymentMethod} onChange={(event) => onPayment(event.target.value)} aria-label="Payment method">{PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}</select><button className="button button-primary" onClick={onSettle}><Printer size={15} />Print bill</button></div>}</article>;
}

function RoomBillDrawer({ room, onClose, onOutdoor, onService, onCheckout }) {
  const [payment, setPayment] = useState('Cash');
  if (!room) return null;
  const days = getStayDays(room.checkInAt);
  const roomTotal = days * Number(room.ratePerNight || 0);
  const addonTotal = calculateAddonTotal(room.addons);
  const foreign = (room.currency || ETB) !== ETB;
  const total = foreign ? null : roomTotal + addonTotal;
  return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="room-drawer">
    <div className="drawer-header"><div><span className="eyebrow">OCCUPIED ROOM</span><h2>Room {room.number}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close room bill"><X size={18} /></button></div>
    <div className="drawer-guest"><div className="guest-avatar-large">{initials(room.guest?.name)}</div><div><strong>{room.guest?.name || 'Guest'}</strong><span>{room.guest?.phone || 'No phone number'} · {room.guest?.guests || 1} guest{Number(room.guest?.guests || 1) === 1 ? '' : 's'}</span></div><button className="icon-button subtle" title="Guest details"><MoreHorizontal size={18} /></button></div>
    <div className="stay-counter"><div className="stay-counter-top"><div><span className="counter-overline">RUNNING ROOM TOTAL</span><strong>{formatMoney(roomTotal, room.currency)}</strong></div><span className="counter-days"><CalendarDays size={15} />{days} day{days === 1 ? '' : 's'}</span></div><div className="stay-equation"><span>{days} day{days === 1 ? '' : 's'} spent</span><span>×</span><span>{formatMoney(room.ratePerNight, room.currency)} / night</span></div><div className="counter-divider" /><div className="stay-meta"><span>Checked in {dateLabel(room.checkInAt, { time: true })}</span><span>{room.currency || ETB}</span></div></div>
    <div className="drawer-service-buttons"><button className="service-action outdoor-action" onClick={onOutdoor}><span className="service-action-icon"><Utensils size={18} /></span><span><strong>Outdoor</strong><small>Open the hotel menu and add food</small></span><ChevronRight size={17} /></button><button className="service-action" onClick={onService}><span className="service-action-icon service-icon-laundry"><SparklesIcon /></span><span><strong>Other service</strong><small>Add laundry or a priced item</small></span><ChevronRight size={17} /></button></div>
    <div className="drawer-lines-head"><div><h3>Bill details</h3><span>{(room.addons || []).length + 1} line{(room.addons || []).length === 0 ? '' : 's'}</span></div><span className="currency-note">Food & services in ETB</span></div>
    <div className="drawer-lines">
      <div className="bill-line"><span className="bill-line-icon room-bill-icon"><BedDouble size={15} /></span><div className="bill-line-copy"><strong>Room stay</strong><small>{days} day{days === 1 ? '' : 's'} × {formatMoney(room.ratePerNight, room.currency)}/night</small></div><strong className="bill-line-amount">{formatMoney(roomTotal, room.currency)}</strong></div>
      {(room.addons || []).map((line) => <div className="bill-line" key={line.id}><span className="bill-line-icon"><Coffee size={15} /></span><div className="bill-line-copy"><strong>{line.name}</strong><small>{line.qty} × {formatMoney(line.unitPrice, ETB)}</small></div><strong className="bill-line-amount">{formatMoney(line.qty * line.unitPrice, ETB)}</strong></div>)}
      {(room.addons || []).length === 0 && <div className="bill-empty-note">No outdoor food or other services added yet.</div>}
    </div>
    <div className="drawer-total-box"><div className="drawer-total-row"><span>{foreign ? 'Room total' : 'Total'}</span><strong>{formatMoney(roomTotal, room.currency)}</strong></div>{foreign && <div className="drawer-total-row"><span>Food & services total</span><strong>{formatMoney(addonTotal, ETB)}</strong></div>}{!foreign && addonTotal > 0 && <div className="drawer-total-row"><span>Food & services</span><strong>{formatMoney(addonTotal, ETB)}</strong></div>}<div className="drawer-grand-total"><span>{foreign ? 'TOTAL · SEPARATE CURRENCIES' : 'TOTAL DUE'}</span>{foreign ? <strong>{formatMoney(roomTotal, room.currency)} <i>+</i> {formatMoney(addonTotal, ETB)}</strong> : <strong>{formatMoney(total, ETB)}</strong>}</div></div>
    <div className="drawer-payment"><label className="field-label" htmlFor="checkout-payment">Payment line</label><select id="checkout-payment" value={payment} onChange={(event) => setPayment(event.target.value)}>{PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}</select></div>
    <div className="drawer-footer"><button className="button button-outline" onClick={onClose}>Keep open</button><button className="button button-primary checkout-button" onClick={() => onCheckout(room, payment)}><Printer size={17} />Print checkout & release</button></div>
    <div className="drawer-help"><ShieldCheck size={14} />The receipt is archived before printing. Room turns green after the print dialog closes.</div>
  </aside></div>;
}

function SparklesIcon() {
  return <span className="service-sparkle">✦</span>;
}

function CheckInModal({ room, onClose, onSave }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', nationality: '', documentId: '', guests: '1', notes: '', rate: String(room.defaultRate || ''), currency: ETB });
  const [error, setError] = useState('');
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return setError('Guest name and phone number are required.');
    if (!(Number(form.rate) > 0)) return setError('Enter a price per night greater than zero.');
    onSave(room.id, {
      name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(), nationality: form.nationality.trim(), documentId: form.documentId.trim(), guests: Math.max(1, Number(form.guests) || 1), notes: form.notes.trim(),
    }, Number(form.rate), form.currency);
  };
  return <Modal onClose={onClose} title={`Check in · Room ${room.number}`} subtitle={`${room.type} · Admin reference rate ${formatMoney(room.defaultRate, ETB)}`} size="wide">
    <form onSubmit={submit} className="checkin-form">
      <div className="form-section-label"><span className="section-number">01</span><div><strong>Guest information</strong><small>Details for the front desk and receipt.</small></div></div>
      <div className="form-grid two-col"><Field label="Guest name *"><input autoFocus value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Selamawit Bekele" /></Field><Field label="Phone number *"><input value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="+251 …" /></Field><Field label="Email address"><input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="guest@email.com" /></Field><Field label="Nationality"><input value={form.nationality} onChange={(event) => update('nationality', event.target.value)} placeholder="e.g. Ethiopian" /></Field><Field label="ID or passport number"><input value={form.documentId} onChange={(event) => update('documentId', event.target.value)} placeholder="Document number" /></Field><Field label="Number of guests"><input min="1" type="number" value={form.guests} onChange={(event) => update('guests', event.target.value)} /></Field></div>
      <Field label="Guest notes"><textarea rows="2" value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Any useful check-in notes…" /></Field>
      <div className="checkin-divider" />
      <div className="form-section-label"><span className="section-number">02</span><div><strong>Agreed room rate</strong><small>Set the price this guest agreed to pay per night.</small></div></div>
      <div className="form-grid rate-grid"><Field label="Price per night *"><div className="price-input"><input type="number" min="0" step="0.01" value={form.rate} onChange={(event) => update('rate', event.target.value)} placeholder="0.00" /><span>/ night</span></div></Field><Field label="Room currency"><CurrencySelect value={form.currency} onChange={(value) => update('currency', value)} /></Field></div>
      <div className="currency-info-note"><CircleDollarSign size={16} /><span>Room nights will use this currency. Food and other services will be charged separately in ETB.</span></div>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-footer"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit"><Check size={16} />Check in guest</button></div>
    </form>
  </Modal>;
}

function CurrencySelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapper = useRef(null);
  useEffect(() => {
    const close = (event) => { if (wrapper.current && !wrapper.current.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const selected = CURRENCIES.find((currency) => currency.code === value) || CURRENCIES[0];
  const filtered = search.trim()
    ? CURRENCIES.filter((currency) => `${currency.code} ${currency.name}`.toLowerCase().includes(search.toLowerCase())).slice(0, 80)
    : CURRENCIES;
  return <div className="currency-picker" ref={wrapper}>
    <button type="button" className={`currency-trigger ${open ? 'open' : ''}`} onClick={() => { setOpen((current) => !current); setSearch(''); }}><span className="currency-code-pill">{selected.code}</span><span className="currency-selected-name">{selected.name}</span><ChevronDown size={16} /></button>
    {open && <div className="currency-popover"><div className="currency-search"><Search size={15} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search currency or code…" /></div><div className="currency-result-list">{filtered.map((currency, index) => <button type="button" key={currency.code} className={`currency-option ${value === currency.code ? 'selected' : ''} ${!search && index === 0 ? 'first-currency' : ''}`} onClick={() => { onChange(currency.code); setOpen(false); }}><span className="currency-option-code">{currency.code}</span><span>{currency.name}</span>{value === currency.code && <Check size={15} />}</button>)}{filtered.length === 0 && <div className="currency-no-results">No matching currency.</div>}</div><div className="currency-popover-footer">{search ? `${filtered.length} matches` : 'Common currencies shown first · search all currencies'}</div></div>}
  </div>;
}

function RoomQrManagement({ data, updateData, notify }) {
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [showAddTable, setShowAddTable] = useState(false);
  const [newRoom, setNewRoom] = useState({ number: '', type: 'Standard twin', defaultRate: '2100' });
  const [editingRoom, setEditingRoom] = useState(null);
  const [tableLabel, setTableLabel] = useState('');
  const occupiedCount = data.rooms.filter((room) => room.status === 'occupied').length;
  const addRoom = (event) => {
    event.preventDefault();
    if (!newRoom.number.trim() || data.rooms.some((room) => room.number === newRoom.number.trim())) return notify('Enter a unique room number.');
    updateData((current) => ({ ...current, rooms: [...current.rooms, { id: makeId('room'), number: newRoom.number.trim(), type: newRoom.type, defaultRate: Number(newRoom.defaultRate) || 0, status: 'available', guest: null, checkInAt: null, ratePerNight: null, currency: ETB, addons: [] }] }));
    setNewRoom({ number: '', type: 'Standard twin', defaultRate: '2100' }); setShowAddRoom(false); notify('Room added with its own QR code.');
  };
  const saveRoom = (event) => {
    event.preventDefault();
    updateData((current) => ({ ...current, rooms: current.rooms.map((room) => room.id === editingRoom.id ? { ...room, number: editingRoom.number, type: editingRoom.type, defaultRate: Number(editingRoom.defaultRate) || 0 } : room) }));
    setEditingRoom(null); notify('Room settings updated.');
  };
  const addTable = (event) => {
    event.preventDefault();
    const number = tableLabel.trim() ? tableLabel.trim() : String(Math.max(0, ...data.tables.map((table) => Number(table.number) || 0)) + 1);
    if (data.tables.some((table) => String(table.number) === number)) return notify('That table number already exists.');
    updateData((current) => ({ ...current, tables: [...current.tables, { id: makeId('table'), number, label: `Table ${number}` }] }));
    setTableLabel(''); setShowAddTable(false); notify(`Table ${number} added with a unique QR code.`);
  };
  const deleteRoom = (room) => {
    if (room.status === 'occupied') return notify('Check out the guest before removing this room.');
    if (!window.confirm(`Remove Room ${room.number} and its QR code?`)) return;
    updateData((current) => ({ ...current, rooms: current.rooms.filter((entry) => entry.id !== room.id) }));
  };
  const deleteTable = (table) => {
    if (!window.confirm(`Remove ${table.label} and its QR code?`)) return;
    updateData((current) => ({ ...current, tables: current.tables.filter((entry) => entry.id !== table.id) }));
  };
  return <div className="page-stack">
    <div className="page-intro-row"><div><span className="eyebrow">ADMIN · PROPERTY SETUP</span><h2>Rooms & QR codes</h2><p>Manage rooms, reference prices, dining tables and their unique scan-to-order links.</p></div><div className="setup-stat"><BedDouble size={17} /><strong>{occupiedCount}/{data.rooms.length}</strong><span>rooms occupied</span></div></div>
    <section className="panel setup-panel"><div className="panel-heading setup-heading"><div><span className="eyebrow">ROOM INVENTORY</span><h3>Guest rooms</h3><p>Every room has a unique QR menu link. Set the reference price; the cashier enters the agreed nightly rate at check-in.</p></div><button className="button button-primary" onClick={() => setShowAddRoom(true)}><Plus size={16} />Add room</button></div><div className="qr-management-grid">{data.rooms.map((room) => <div className="qr-manage-card" key={room.id}><div className="qr-manage-card-top"><span className="qr-target-label"><BedDouble size={15} />Room {room.number}</span><button className="icon-button subtle" title="Edit room" onClick={() => setEditingRoom({ ...room, defaultRate: String(room.defaultRate || 0) })}><Pencil size={15} /></button></div><div className="qr-content-row"><QrTile targetId={room.id} label={`Room ${room.number}`} /><div className="qr-manage-details"><span className={`mini-status ${room.status}`}>{room.status === 'occupied' ? 'Occupied' : 'Available'}</span><strong>{room.type}</strong><span>Reference {formatMoney(room.defaultRate, ETB)} / night</span><span className="qr-hint">Unique room menu QR</span><button className="text-button remove-link" onClick={() => deleteRoom(room)}><Trash2 size={13} />Remove room</button></div></div></div>)}</div></section>
    <section className="panel setup-panel"><div className="panel-heading setup-heading"><div><span className="eyebrow">DINING</span><h3>Tables</h3><p>Table QR codes open the same menu and route orders to the cashier desk as “Table N”.</p></div><button className="button button-outline" onClick={() => setShowAddTable(true)}><Plus size={16} />Add table</button></div><div className="qr-management-grid table-qr-grid">{data.tables.map((table) => <div className="qr-manage-card table-qr-card" key={table.id}><div className="qr-manage-card-top"><span className="qr-target-label"><Utensils size={15} />{table.label}</span><button className="icon-button subtle" title="Remove table" onClick={() => deleteTable(table)}><Trash2 size={15} /></button></div><div className="qr-content-row"><QrTile targetId={table.id} label={table.label} /><div className="qr-manage-details"><span className="mini-status table-status">Active QR</span><strong>Scan to see menu</strong><span>Orders appear below room cards.</span><span className="qr-hint">Unique table menu QR</span></div></div></div>)}</div></section>
    {(showAddRoom || editingRoom) && <Modal onClose={() => { setShowAddRoom(false); setEditingRoom(null); }} title={editingRoom ? `Edit Room ${editingRoom.number}` : 'Add a room'} subtitle="Room rates are reference prices; the cashier confirms the guest’s agreed rate." size="small"><form className="stack-form" onSubmit={editingRoom ? saveRoom : addRoom}><Field label="Room number"><input required value={editingRoom ? editingRoom.number : newRoom.number} onChange={(event) => editingRoom ? setEditingRoom({ ...editingRoom, number: event.target.value }) : setNewRoom({ ...newRoom, number: event.target.value })} placeholder="e.g. 109" /></Field><Field label="Room type"><select value={editingRoom ? editingRoom.type : newRoom.type} onChange={(event) => editingRoom ? setEditingRoom({ ...editingRoom, type: event.target.value }) : setNewRoom({ ...newRoom, type: event.target.value })}><option>Standard twin</option><option>Courtyard queen</option><option>Deluxe king</option><option>Family suite</option><option>Single room</option><option>Other</option></select></Field><Field label="Reference price per night (ETB)"><input required min="0" type="number" value={editingRoom ? editingRoom.defaultRate : newRoom.defaultRate} onChange={(event) => editingRoom ? setEditingRoom({ ...editingRoom, defaultRate: event.target.value }) : setNewRoom({ ...newRoom, defaultRate: event.target.value })} /></Field><div className="modal-footer"><button type="button" className="button button-outline" onClick={() => { setShowAddRoom(false); setEditingRoom(null); }}>Cancel</button><button className="button button-primary" type="submit"><Check size={15} />{editingRoom ? 'Save room' : 'Add room'}</button></div></form></Modal>}
    {showAddTable && <Modal onClose={() => setShowAddTable(false)} title="Add a dining table" subtitle="A unique QR menu link will be created for this table." size="small"><form className="stack-form" onSubmit={addTable}><Field label="Table number (leave blank to use next number)"><input autoFocus value={tableLabel} onChange={(event) => setTableLabel(event.target.value)} placeholder={String(Math.max(0, ...data.tables.map((table) => Number(table.number) || 0)) + 1)} /></Field><div className="modal-footer"><button type="button" className="button button-outline" onClick={() => setShowAddTable(false)}>Cancel</button><button className="button button-primary"><Plus size={15} />Create table QR</button></div></form></Modal>}
  </div>;
}

function QrTile({ targetId, label }) {
  const [image, setImage] = useState('');
  const url = useMemo(() => {
    const link = new URL(window.location.href);
    link.search = '';
    link.searchParams.set('order', targetId);
    return link.toString();
  }, [targetId]);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { width: 176, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#173a32', light: '#ffffff' } }).then((result) => { if (alive) setImage(result); }).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  return <div className="qr-image-wrap" title={`${label} QR menu`}>
    {image ? <img src={image} alt={`${label} unique QR code`} /> : <div className="qr-placeholder"><QrCode size={34} /></div>}
    {image && <a className="qr-download" href={image} download={`${label.toLowerCase().replaceAll(' ', '-')}-menu-qr.png`} title={`Download ${label} QR`} aria-label={`Download ${label} QR`}><Download size={13} /></a>}
  </div>;
}

function MenuBuilder({ data, updateData, notify }) {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [addCategory, setAddCategory] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [itemModal, setItemModal] = useState(null);
  const categories = data.categories || [];
  const visibleItems = data.menuItems.filter((item) => selectedCategory === 'all' || item.categoryId === selectedCategory);
  const createCategory = (event) => {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name) return;
    if (categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) return notify('A category with that name already exists.');
    const nextCategory = { id: makeId('category'), name };
    updateData((current) => ({ ...current, categories: [...current.categories, nextCategory] }));
    setCategoryName(''); setAddCategory(false); setSelectedCategory(nextCategory.id); notify('Menu category created.');
  };
  const saveItem = (item) => {
    updateData((current) => ({ ...current, menuItems: item.id ? current.menuItems.map((entry) => entry.id === item.id ? item : entry) : [...current.menuItems, { ...item, id: makeId('food') }] }));
    setItemModal(null); notify(item.id ? 'Menu item updated.' : 'Menu item added.');
  };
  const removeItem = (item) => {
    if (!window.confirm(`Remove ${item.name} from the menu?`)) return;
    updateData((current) => ({ ...current, menuItems: current.menuItems.filter((entry) => entry.id !== item.id) }));
    notify('Menu item removed.');
  };
  const removeCategory = (category) => {
    if (!window.confirm(`Remove “${category.name}”? Its menu items will move to the first remaining category.`)) return;
    const remaining = categories.filter((entry) => entry.id !== category.id);
    updateData((current) => ({ ...current, categories: remaining, menuItems: current.menuItems.map((item) => item.categoryId === category.id ? { ...item, categoryId: remaining[0]?.id || '' } : item) }));
    setSelectedCategory('all'); notify('Category removed.');
  };
  return <div className="page-stack">
    <div className="page-intro-row"><div><span className="eyebrow">ADMIN · RESTAURANT SETUP</span><h2>Build your menu</h2><p>Categories and items appear on every room and table QR menu, and in the cashier’s Outdoor menu.</p></div><button className="button button-primary" onClick={() => setItemModal({ name: '', description: '', price: '', categoryId: categories[0]?.id || '', emoji: '🍽️', image: '' })}><Plus size={16} />Add menu item</button></div>
    <section className="panel menu-builder-panel"><div className="menu-toolbar"><div className="category-tabs"><button className={selectedCategory === 'all' ? 'active' : ''} onClick={() => setSelectedCategory('all')}>All items <span>{data.menuItems.length}</span></button>{categories.map((category) => <div className={`category-tab-wrap ${selectedCategory === category.id ? 'active' : ''}`} key={category.id}><button className={selectedCategory === category.id ? 'active' : ''} onClick={() => setSelectedCategory(category.id)}>{category.name}</button><button className="category-remove" title={`Remove ${category.name}`} onClick={() => removeCategory(category)}><X size={12} /></button></div>)}</div><button className="button button-outline button-small" onClick={() => setAddCategory((value) => !value)}><Plus size={14} />New category</button></div>
      {addCategory && <form className="inline-add-category" onSubmit={createCategory}><input autoFocus value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Category name, e.g. Sides" /><button className="button button-primary button-small"><Check size={14} />Create category</button><button type="button" className="icon-button subtle" onClick={() => setAddCategory(false)}><X size={16} /></button></form>}
      <div className="menu-items-heading"><div><strong>{selectedCategory === 'all' ? 'All menu items' : categories.find((entry) => entry.id === selectedCategory)?.name}</strong><span>{visibleItems.length} item{visibleItems.length === 1 ? '' : 's'}</span></div><span className="menu-order-hint"><QrCode size={14} />Visible on QR menus</span></div>
      {visibleItems.length ? <div className="menu-item-admin-grid">{visibleItems.map((item) => <MenuAdminCard key={item.id} item={item} categoryName={categories.find((category) => category.id === item.categoryId)?.name || 'Uncategorized'} onEdit={() => setItemModal({ ...item })} onDelete={() => removeItem(item)} />)}</div> : <EmptyState icon={Utensils} title="No items in this category" text="Add a menu item to get started." />}
    </section>
    {itemModal && <MenuItemModal item={itemModal} categories={categories} onClose={() => setItemModal(null)} onSave={saveItem} />}
  </div>;
}

function MenuAdminCard({ item, categoryName, onEdit, onDelete }) {
  return <article className="menu-admin-card"><div className="menu-admin-photo">{item.image ? <img src={item.image} alt={item.name} /> : <span>{item.emoji || '🍽️'}</span>}<span className="menu-category-badge">{categoryName}</span><div className="menu-card-actions"><button title="Edit item" aria-label="Edit item" onClick={onEdit}><Pencil size={14} /></button><button title="Remove item" aria-label="Remove item" onClick={onDelete}><Trash2 size={14} /></button></div></div><div className="menu-admin-copy"><h4>{item.name}</h4><p>{item.description || 'No description yet.'}</p><strong>{formatMoney(item.price, ETB)}</strong></div></article>;
}

function MenuItemModal({ item, categories, onClose, onSave }) {
  const [draft, setDraft] = useState({ ...item });
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const uploadImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('Choose an image file.');
    if (file.size > 2.5 * 1024 * 1024) return setError('Choose an image smaller than 2.5 MB.');
    const reader = new FileReader();
    reader.onload = () => { update('image', String(reader.result || '')); setError(''); };
    reader.readAsDataURL(file);
  };
  const submit = (event) => {
    event.preventDefault();
    if (!draft.name.trim() || !(Number(draft.price) >= 0) || !draft.categoryId) return setError('Enter an item name, price and category.');
    onSave({ ...draft, name: draft.name.trim(), description: draft.description.trim(), price: Number(draft.price) });
  };
  return <Modal onClose={onClose} title={draft.id ? 'Edit menu item' : 'Add menu item'} subtitle="This item appears on the room and table QR menus." size="wide"><form className="menu-item-form" onSubmit={submit}>
    <div className="menu-image-upload" onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && fileRef.current?.click()}>{draft.image ? <img src={draft.image} alt="Menu item preview" /> : <div><ImagePlus size={26} /><strong>Upload item photo</strong><small>PNG or JPG · max 2.5 MB</small></div>}<input ref={fileRef} type="file" accept="image/*" onChange={uploadImage} hidden /></div>
    <div className="menu-item-fields"><Field label="Item title *"><input autoFocus value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Doro wat" /></Field><Field label="Description"><textarea rows="3" value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder="A short description for guests…" /></Field><div className="form-grid two-col"><Field label="Price (ETB) *"><input min="0" step="0.01" type="number" value={draft.price} onChange={(event) => update('price', event.target.value)} placeholder="0.00" /></Field><Field label="Category *"><select value={draft.categoryId} onChange={(event) => update('categoryId', event.target.value)}>{categories.length ? categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>) : <option value="">Create a category first</option>}</select></Field></div><Field label="Emoji (used if no image is uploaded)"><input value={draft.emoji || ''} onChange={(event) => update('emoji', event.target.value)} placeholder="🍽️" /></Field></div>
    {error && <div className="form-error">{error}</div>}<div className="modal-footer"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary"><Check size={16} />Save menu item</button></div>
  </form></Modal>;
}

function ReceiptTemplatePage({ template, onSave }) {
  const [draft, setDraft] = useState({ ...template });
  const [saved, setSaved] = useState(false);
  const update = (key, value) => { setDraft((current) => ({ ...current, [key]: value })); setSaved(false); };
  const submit = (event) => { event.preventDefault(); onSave({ ...draft }); setSaved(true); };
  const demoReceipt = {
    id: 'preview', invoiceNo: 'INV-20261010-0001', orderNo: 'ORD-00001', printedAt: new Date().toISOString(), printedBy: 'Liya Alemu', operator: 'Liya Alemu', waiter: 'Front desk', tableLabel: 'Room 101', guestName: 'Sample Guest', entityType: 'room', paymentMethod: 'Cash', roomDays: 1, roomRate: 2400, roomCurrency: ETB,
    lines: [{ id: 'p1', description: 'Room 101 · 1 day', qty: 1, price: 2400, amount: 2400, currency: ETB }, { id: 'p2', description: 'Coffee and breakfast', qty: 1, price: 320, amount: 320, currency: ETB }], currencyTotals: [{ currency: ETB, amount: 2720 }], itemCount: 2, template: draft,
  };
  return <div className="page-stack">
    <div className="page-intro-row"><div><span className="eyebrow">ADMIN · PRINT SETUP</span><h2>Receipt template</h2><p>Set the hotel-specific paper header and footer. Every new receipt saves a copy of this template.</p></div><div className="print-size-badge"><Printer size={16} /><div><strong>80 mm thermal</strong><span>Cash invoice · no tax lines or QR</span></div></div></div>
    <div className="template-layout"><section className="panel template-form-panel"><div className="panel-heading"><div><span className="eyebrow">HOTEL DETAILS</span><h3>Paper receipt content</h3><p>Use the same wording printed on your hotel’s official paper receipt.</p></div></div><form className="template-form" onSubmit={submit}><div className="form-grid two-col"><Field label="TIN"><input value={draft.tin} onChange={(event) => update('tin', event.target.value)} placeholder="TIN-________" /></Field><Field label="FS No."><input value={draft.fsNo} onChange={(event) => update('fsNo', event.target.value)} placeholder="FS-01" /></Field></div><Field label="Hotel name"><input value={draft.hotelName} onChange={(event) => update('hotelName', event.target.value)} placeholder="Hotel name" /></Field><Field label="Address lines"><textarea rows="3" value={draft.addressLines} onChange={(event) => update('addressLines', event.target.value)} placeholder={'Street / area\nCity, country'} /></Field><Field label="Phone"><input value={draft.phone} onChange={(event) => update('phone', event.target.value)} placeholder="TEL-…" /></Field><Field label="Invoice title"><input value={draft.invoiceTitle} onChange={(event) => update('invoiceTitle', event.target.value)} placeholder="CASH INVOICE" /></Field><Field label="Footer lines"><textarea rows="3" value={draft.footerLines} onChange={(event) => update('footerLines', event.target.value)} placeholder={'Thank you for visiting.\nPlease come again.'} /></Field><div className="template-helper"><ShieldCheck size={15} />Tax and QR code lines are intentionally excluded from this non-fiscal receipt.</div><div className="template-form-footer"><span>{saved ? <><CheckCircle2 size={15} />Saved for new receipts</> : 'Changes appear in the preview'}</span><button className="button button-primary"><Check size={16} />Save template</button></div></form></section><section className="template-preview-section"><div className="preview-heading"><div><span className="eyebrow">LIVE PREVIEW</span><h3>80 mm paper</h3></div><span className="preview-dot">Updated</span></div><div className="receipt-preview-frame"><ReceiptPaper receipt={demoReceipt} /></div><div className="preview-caption"><Printer size={14} />Browser print dialog · choose your 80 mm order printer</div></section></div>
  </div>;
}

function ReceiptPaper({ receipt }) {
  if (!receipt) return null;
  const template = receipt.template || {};
  const rawTin = String(template.tin || '').trim();
  const tinValue = rawTin.toUpperCase().startsWith('TIN') ? rawTin.slice(3).trim().replace(/^[-:]/, '').trim() : rawTin;
  const totals = getCurrencyTotals(receipt);
  const foreignSplit = totals.length > 1;
  return <div className="thermal-receipt">
    <div className="receipt-header"><div className="receipt-tin">TIN: {tinValue || '________________'}</div><strong className="receipt-business-name">{template.hotelName || 'Hotel name'}</strong>{String(template.addressLines || '').split('\n').filter(Boolean).map((line, index) => <div className="receipt-address" key={`${line}-${index}`}>{line}</div>)}<div className="receipt-phone">TEL-{String(template.phone || '').replace(/^TEL-?/i, '')}</div></div>
    <div className="receipt-dash" />
    <div className="receipt-fs-row"><span>FS No. {template.fsNo || '________'}</span><span>{dateLabel(receipt.printedAt, { time: true })}</span></div>
    <div className="receipt-title">====== {template.invoiceTitle || 'CASH INVOICE'} ======</div>
    <div className="receipt-details"><div><span>Invoice</span><strong>{receipt.invoiceNo}</strong></div><div><span>Order</span><strong>{receipt.orderNo}</strong></div><div><span>Operator</span><strong>{receipt.operator || receipt.printedBy || '—'}</strong></div><div><span>Waiter</span><strong>{receipt.waiter || '—'}</strong></div><div><span>Table</span><strong>{receipt.tableLabel || '—'}</strong></div>{receipt.guestName && <div><span>Guest</span><strong>{receipt.guestName}</strong></div>}</div>
    <div className="receipt-dash" />
    <table className="receipt-items-table"><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>AMOUNT</th></tr></thead><tbody>{(receipt.lines || []).map((line) => <tr key={line.id}><td>{line.description}</td><td>{line.qty}</td><td>{formatMoney(line.price, line.currency || ETB)}</td><td>{formatMoney(line.amount, line.currency || ETB)}</td></tr>)}</tbody></table>
    <div className="receipt-dash" />
    {foreignSplit && <div className="receipt-total-group"><span>ROOM TOTAL · {totals.find((entry) => entry.currency !== ETB)?.currency || receipt.roomCurrency}</span><strong>{formatMoney(totals.find((entry) => entry.currency !== ETB)?.amount || 0, totals.find((entry) => entry.currency !== ETB)?.currency || receipt.roomCurrency)}</strong></div>}
    {foreignSplit && <div className="receipt-total-group"><span>FOOD & SERVICES · ETB</span><strong>{formatMoney(totals.find((entry) => entry.currency === ETB)?.amount || 0, ETB)}</strong></div>}
    <div className="receipt-grand-total"><span>TOTAL</span><strong>{foreignSplit ? totals.map((entry) => formatMoney(entry.amount, entry.currency)).join('  +  ') : formatMoney(totals[0]?.amount || 0, totals[0]?.currency || ETB)}</strong></div>
    <div className="receipt-payment"><span>Payment</span><strong>{receipt.paymentMethod || 'Cash'} · {totals.map((entry) => formatMoney(entry.amount, entry.currency)).join(' + ')}</strong></div>
    <div className="receipt-item-count">ITEM# {receipt.itemCount ?? (receipt.lines || []).length}</div>
    <div className="receipt-dash" />
    <div className="receipt-footer">{String(template.footerLines || '').split('\n').filter(Boolean).map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
  </div>;
}

function ReceiptArchive({ receipts, onOpen, onPrint }) {
  const [query, setQuery] = useState('');
  const filtered = [...receipts].sort((a, b) => new Date(b.printedAt) - new Date(a.printedAt)).filter((receipt) => `${receipt.invoiceNo} ${receipt.tableLabel} ${receipt.guestName} ${receipt.operator}`.toLowerCase().includes(query.toLowerCase()));
  const totalGroups = aggregateCurrencyTotals(receipts);
  return <div className="page-stack">
    <div className="page-intro-row"><div><span className="eyebrow">ADMIN · SOFT COPIES</span><h2>Receipt archive</h2><p>Every checkout and table bill print is kept here with its original hotel template.</p></div><div className="archive-total-chip"><ReceiptText size={17} /><div><strong>{receipts.length} prints</strong><span>{totalGroups.length ? totalGroups.map((item) => formatMoney(item.amount, item.currency)).join(' · ') : 'No sales recorded yet'}</span></div></div></div>
    <section className="panel archive-panel"><div className="archive-toolbar"><div><h3>Printed receipts</h3><span>{filtered.length} record{filtered.length === 1 ? '' : 's'}</span></div><div className="archive-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search invoice, guest or room" /></div></div>
      {filtered.length ? <div className="printed-ticket-grid">{filtered.map((receipt) => {
        const lastPrint = receipt.lastPrintedAt || receipt.printedAt;
        const printTime = new Intl.DateTimeFormat('en-ET', { hour: '2-digit', minute: '2-digit' }).format(new Date(lastPrint));
        return <article className="printed-ticket-card" key={receipt.id} role="button" tabIndex={0} onClick={() => onOpen(receipt)} onKeyDown={(event) => event.key === 'Enter' && onOpen(receipt)}>
          <div className="printed-ticket-head"><strong>{receipt.tableLabel}</strong><div>{getCurrencyTotals(receipt).map((entry) => <b key={entry.currency}>{formatMoney(entry.amount, entry.currency)}</b>)}</div></div>
          <div className="printed-ticket-meta"><Printer size={13} />printed {printTime} · {receipt.lastPrintedBy || receipt.printedBy || 'hotel team'}</div>
          <div className="printed-ticket-line"><Clock3 size={13} /><span>{dateLabel(lastPrint, { time: true })}</span></div>
          <div className="printed-ticket-line guest-line"><UserRound size={13} /><span>{receipt.guestName || 'Walk-in guest'}</span><span className="ticket-print-count">{receipt.printCount || 1}×</span></div>
          <div className="printed-ticket-cleared"><Check size={13} />CLEARED {printTime}</div>
          <div className="printed-ticket-actions"><span>{receipt.invoiceNo}</span><div><button className="ticket-open-button" onClick={(event) => { event.stopPropagation(); onOpen(receipt); }}><Eye size={13} />Open</button><button className="ticket-reprint-button" onClick={(event) => { event.stopPropagation(); onPrint(receipt); }}><Printer size={13} />Print</button></div></div>
        </article>;
      })}</div> : <EmptyState icon={ReceiptText} title={query ? 'No receipts match that search' : 'No receipts archived yet'} text={query ? 'Try another invoice number, guest, room or table.' : 'Printed room checkouts and table bills will be saved here automatically.'} />}
    </section>
  </div>;
}

function ReceiptMiniRow({ receipt }) {
  const total = getCurrencyTotals(receipt);
  return <div className="receipt-mini-row"><div className="mini-receipt-icon"><ReceiptText size={16} /></div><div className="mini-receipt-copy"><strong>{receipt.tableLabel}</strong><span>{receipt.invoiceNo} · {dateLabel(receipt.printedAt, { time: true })}</span></div><div className="mini-receipt-total">{total.map((entry) => <strong key={entry.currency}>{formatMoney(entry.amount, entry.currency)}</strong>)}</div></div>;
}

function ReceiptPreviewModal({ receipt, onClose, onPrint }) {
  const events = (receipt.printEvents?.length ? receipt.printEvents : [{ at: receipt.printedAt, by: receipt.printedBy || receipt.operator }]).slice().reverse();
  return <Modal onClose={onClose} title={receipt.invoiceNo} subtitle={`${receipt.tableLabel} · printed ${dateLabel(receipt.printedAt, { time: true })}`} size="wide" className="receipt-preview-modal"><div className="receipt-modal-layout"><div className="receipt-preview-paper"><ReceiptPaper receipt={receipt} /></div><div className="receipt-preview-info"><span className="eyebrow">ARCHIVED SOFT COPY</span><h3>{receipt.tableLabel}</h3><p>{receipt.guestName || 'Walk-in guest'} · {receipt.operator || receipt.printedBy}</p><div className="preview-info-block"><span>Invoice</span><strong>{receipt.invoiceNo}</strong></div><div className="preview-info-block"><span>Payment method</span><strong>{receipt.paymentMethod || 'Cash'}</strong></div><div className="preview-info-block"><span>Print count</span><strong>{receipt.printCount || 1} print{Number(receipt.printCount || 1) === 1 ? '' : 's'}</strong></div><div className="receipt-print-history"><strong>Print history</strong>{events.slice(0, 5).map((event, index) => <div key={`${event.at}-${index}`}><span>{dateLabel(event.at, { time: true })}</span><small>{event.by || 'Hotel team'}</small></div>)}</div><div className="receipt-preview-info-total">{getCurrencyTotals(receipt).map((item) => <strong key={item.currency}>{formatMoney(item.amount, item.currency)}</strong>)}</div><button className="button button-primary button-full" onClick={onPrint}><Printer size={16} />Reprint on 80 mm</button></div></div></Modal>;
}

function ReportsPage({ receipts }) {
  const [range, setRange] = useState('all');
  const from = new Date();
  if (range === 'month') { from.setDate(1); from.setHours(0, 0, 0, 0); }
  if (range === 'week') { from.setDate(from.getDate() - 6); from.setHours(0, 0, 0, 0); }
  const filtered = receipts.filter((receipt) => range === 'all' || new Date(receipt.printedAt) >= from);
  const groups = aggregateCurrencyTotals(filtered);
  const todayCount = filtered.filter((receipt) => new Date(receipt.printedAt).toDateString() === new Date().toDateString()).length;
  const printCount = filtered.reduce((sum, receipt) => sum + (Number(receipt.printCount) || 1), 0);
  const byTarget = filtered.reduce((acc, receipt) => {
    const key = receipt.entityType === 'table' ? 'Table bills' : 'Room checkouts';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return <div className="page-stack">
    <div className="page-intro-row"><div><span className="eyebrow">ADMIN · PERFORMANCE</span><h2>Receipt reports</h2><p>Totals are grouped by currency. Foreign room charges are never converted or mixed with ETB services.</p></div><div className="range-select-wrap"><CalendarDays size={15} /><select value={range} onChange={(event) => setRange(event.target.value)}><option value="all">All time</option><option value="month">This month</option><option value="week">Last 7 days</option></select><ChevronDown size={14} /></div></div>
    <div className="report-stats"><div className="report-stat-card"><span>Printed transactions</span><strong>{filtered.length}</strong><small>{todayCount} printed today</small></div><div className="report-stat-card"><span>Print events</span><strong>{printCount}</strong><small>Includes archive reprints</small></div><div className="report-stat-card"><span>Room checkouts</span><strong>{byTarget['Room checkouts'] || 0}</strong><small>Room-night receipts</small></div><div className="report-stat-card"><span>Table bills</span><strong>{byTarget['Table bills'] || 0}</strong><small>QR and dining orders</small></div></div>
    <div className="reports-grid"><section className="panel report-total-panel"><div className="panel-heading"><div><span className="eyebrow">BY CURRENCY</span><h3>Printed receipt totals</h3><p>One total per currency purse, never combined.</p></div></div>{groups.length ? <div className="currency-total-list">{groups.map((entry) => <div className="currency-total-row" key={entry.currency}><div className="currency-total-mark">{entry.currency.slice(0, 1)}</div><div><strong>{entry.currency}</strong><span>{CURRENCIES.find((currency) => currency.code === entry.currency)?.name || entry.currency}</span></div><div className="currency-total-value"><strong>{formatMoney(entry.amount, entry.currency)}</strong><span>{filtered.filter((receipt) => getCurrencyTotals(receipt).some((total) => total.currency === entry.currency)).length} receipts</span></div></div>)}</div> : <EmptyState icon={ChartColumn} title="Nothing to report yet" text="Totals will appear after the first receipt is printed." />}</section><section className="panel report-breakdown-panel"><div className="panel-heading"><div><span className="eyebrow">TRANSACTION MIX</span><h3>Print activity</h3><p>Completed bills in this period.</p></div></div><div className="activity-breakdown">{[{ label: 'Room checkouts', count: byTarget['Room checkouts'] || 0, icon: BedDouble, tone: 'green' }, { label: 'Table bills', count: byTarget['Table bills'] || 0, icon: Utensils, tone: 'orange' }].map((item) => { const Icon = item.icon; const percent = filtered.length ? Math.round(item.count / filtered.length * 100) : 0; return <div className="activity-breakdown-row" key={item.label}><div className="activity-label"><span className={`activity-icon ${item.tone}`}><Icon size={16} /></span><strong>{item.label}</strong><span>{item.count}</span></div><div className="activity-track"><span className={item.tone} style={{ width: `${percent}%` }} /></div><small>{percent}% of printed transactions</small></div>; })}</div><div className="reports-note"><ShieldCheck size={16} /><span>Report totals are calculated from archived prints. Reprints are tracked as print events and do not duplicate transaction revenue.</span></div></section></div>
    <section className="panel report-recent-panel"><div className="panel-heading"><div><span className="eyebrow">DETAIL</span><h3>Latest transactions</h3></div></div>{filtered.length ? [...filtered].sort((a, b) => new Date(b.printedAt) - new Date(a.printedAt)).slice(0, 8).map((receipt) => <ReceiptMiniRow key={receipt.id} receipt={receipt} />) : <EmptyState icon={ReceiptText} title="No receipts in this period" text="Choose a wider range or print a receipt to start a report." />}</section>
  </div>;
}

function aggregateCurrencyTotals(receipts) {
  const sums = new Map();
  receipts.forEach((receipt) => getCurrencyTotals(receipt).forEach(({ currency, amount }) => {
    sums.set(currency || ETB, (sums.get(currency || ETB) || 0) + Number(amount || 0));
  }));
  return [...sums.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => a.currency === ETB ? -1 : b.currency === ETB ? 1 : a.currency.localeCompare(b.currency));
}

function StaffPage({ staff, updateData, notify }) {
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ name: '', username: '', role: 'Cashier' });
  const [editId, setEditId] = useState('');
  const submit = (event) => {
    event.preventDefault();
    if (!draft.name.trim() || !draft.username.trim()) return;
    if (!VALID_ROLES.includes(draft.role)) return notify('Staff can only be Admin or Cashier.');
    if (staff.some((person) => person.username.toLowerCase() === draft.username.trim().toLowerCase() && person.id !== editId)) return notify('That sign-in name is already in use.');
    updateData((current) => ({ ...current, staff: editId ? current.staff.map((person) => person.id === editId ? { ...person, ...draft, name: draft.name.trim(), username: draft.username.trim() } : person) : [...current.staff, { id: makeId('staff'), ...draft, name: draft.name.trim(), username: draft.username.trim(), active: true }] }));
    setShowForm(false); setEditId(''); setDraft({ name: '', username: '', role: 'Cashier' }); notify(editId ? 'Staff record updated.' : 'Staff member added.');
  };
  const edit = (person) => { setDraft({ name: person.name, username: person.username, role: person.role }); setEditId(person.id); setShowForm(true); };
  const remove = (person) => {
    if (!window.confirm(`Remove ${person.name} from staff?`)) return;
    updateData((current) => ({ ...current, staff: current.staff.filter((entry) => entry.id !== person.id) })); notify('Staff member removed.');
  };
  return <div className="page-stack">
    <div className="page-intro-row"><div><span className="eyebrow">ADMIN · TEAM</span><h2>Staff & access</h2><p>This system has just two roles: Admin and Cashier. No other role or sign-in is available.</p></div><button className="button button-primary" onClick={() => { setEditId(''); setDraft({ name: '', username: '', role: 'Cashier' }); setShowForm(true); }}><Plus size={16} />Add staff member</button></div>
    <section className="panel staff-panel"><div className="staff-role-info"><div className="staff-role-card"><span className="staff-role-icon admin-role"><Settings2 size={19} /></span><div><strong>Admin</strong><span>Rooms, pricing, menu, tables, receipt templates, QR codes, staff and reports.</span></div></div><div className="staff-role-card"><span className="staff-role-icon cashier-role"><WalletCards size={19} /></span><div><strong>Cashier</strong><span>Check-in, rooms, Outdoor orders, other services, table bills and payments.</span></div></div></div><div className="staff-table-head"><div><h3>Hotel team</h3><span>{staff.length} people</span></div><span className="only-roles-tag"><ShieldCheck size={14} />Admin · Cashier only</span></div><div className="staff-list">{staff.map((person) => <div className="staff-row" key={person.id}><div className="staff-identity"><span className="staff-avatar">{initials(person.name)}</span><div><strong>{person.name}</strong><span>{person.username}</span></div></div><span className={`role-badge ${person.role === 'Admin' ? 'role-admin' : 'role-cashier'}`}>{person.role}</span><span className="staff-active"><i />Active</span><div className="staff-actions"><button className="icon-button subtle" onClick={() => edit(person)} title="Edit staff"><Pencil size={15} /></button><button className="icon-button subtle danger-hover" onClick={() => remove(person)} title="Remove staff"><Trash2 size={15} /></button></div></div>)}</div></section>
    {showForm && <Modal onClose={() => setShowForm(false)} title={editId ? 'Edit staff member' : 'Add staff member'} subtitle="Choose one of the two supported hotel roles." size="small"><form className="stack-form" onSubmit={submit}><Field label="Full name"><input autoFocus required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Staff name" /></Field><Field label="Sign-in name"><input required value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} placeholder="e.g. frontdesk1" /></Field><Field label="Role"><select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}><option>Admin</option><option>Cashier</option></select></Field><p className="form-note">Role selection controls which hotel pages are available. This starter build uses a demo role switch and does not provide password authentication.</p><div className="modal-footer"><button type="button" className="button button-outline" onClick={() => setShowForm(false)}>Cancel</button><button className="button button-primary"><Check size={15} />Save staff</button></div></form></Modal>}
  </div>;
}

function OutdoorOrderModal({ data, onClose, onSave }) {
  const [category, setCategory] = useState('all');
  const [lines, setLines] = useState([]);
  const [editing, setEditing] = useState('');
  const menuItems = data.menuItems.filter((item) => category === 'all' || item.categoryId === category);
  const add = (item) => {
    const current = lines.find((line) => line.menuItemId === item.id);
    if (current) setLines((existing) => existing.map((line) => line.menuItemId === item.id ? { ...line, qty: line.qty + 1 } : line));
    else setLines((existing) => [...existing, { id: makeId('outdoor'), menuItemId: item.id, name: item.name, qty: 1, unitPrice: Number(item.price), kind: 'food' }]);
  };
  const updateLine = (id, key, value) => setLines((current) => current.map((line) => line.id === id ? { ...line, [key]: key === 'name' ? value : Number(value) } : line));
  const remove = (id) => { setLines((current) => current.filter((line) => line.id !== id)); if (editing === id) setEditing(''); };
  const total = calculateAddonTotal(lines);
  return <Modal onClose={onClose} title="Outdoor · hotel menu" subtitle="Choose menu items to add to this room. All food prices are in ETB." size="wide" className="outdoor-modal"><div className="outdoor-layout"><div className="outdoor-menu-side"><div className="qr-menu-label"><Utensils size={15} />Same menu as room & table QR codes</div><div className="outdoor-category-tabs"><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>All</button>{data.categories.map((item) => <button className={category === item.id ? 'active' : ''} key={item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}</div><div className="outdoor-menu-grid">{menuItems.map((item) => <button className="outdoor-menu-item" key={item.id} onClick={() => add(item)}><span className="outdoor-food-image">{item.image ? <img src={item.image} alt="" /> : item.emoji || '🍽️'}</span><span className="outdoor-food-copy"><strong>{item.name}</strong><small>{item.description || 'House menu favourite'}</small><b>{formatMoney(item.price, ETB)}</b></span><span className="add-food-circle"><Plus size={15} /></span></button>)}</div></div><div className="outdoor-cart-side"><div className="cart-side-heading"><div><span className="eyebrow">ROOM BILL</span><h3>Selected items</h3></div><span className="count-pill">{lines.length}</span></div><div className="cart-edit-list">{lines.map((line) => <EditableCartLine key={line.id} line={line} editing={editing === line.id} onEdit={() => setEditing(editing === line.id ? '' : line.id)} onUpdate={(key, value) => updateLine(line.id, key, value)} onCancel={() => remove(line.id)} currency={ETB} />)}{!lines.length && <div className="cart-empty"><ShoppingBag size={22} /><strong>Your selection is empty</strong><span>Add a menu item from the list.</span></div>}</div><div className="cart-total"><span>Food subtotal · ETB</span><strong>{formatMoney(total, ETB)}</strong></div><button className="button button-primary button-full" disabled={!lines.length} onClick={() => onSave(lines)}><Check size={16} />Save to room bill</button></div></div></Modal>;
}

function OtherServiceModal({ onClose, onSave }) {
  const [lines, setLines] = useState([]);
  const [activeForm, setActiveForm] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState('');
  const addLine = (kind) => {
    setActiveForm(kind); setName(''); setPrice(''); setError('');
  };
  const saveLine = (event) => {
    event.preventDefault();
    if (!name.trim() || !(Number(price) >= 0)) return setError('Enter a name and a valid ETB price.');
    setLines((current) => [...current, { id: makeId('service'), name: name.trim(), qty: 1, unitPrice: Number(price), kind: activeForm }]);
    setActiveForm(''); setName(''); setPrice(''); setError('');
  };
  const updateLine = (id, key, value) => setLines((current) => current.map((line) => line.id === id ? { ...line, [key]: key === 'name' ? value : Number(value) } : line));
  const removeLine = (id) => { setLines((current) => current.filter((line) => line.id !== id)); if (editing === id) setEditing(''); };
  const total = calculateAddonTotal(lines);
  return <Modal onClose={onClose} title="Other service" subtitle="Add a service or an item. Charges are recorded in ETB." size="medium"><div className="service-modal-content"><div className="service-add-actions"><button className={`service-add-option ${activeForm === 'service' ? 'active' : ''}`} onClick={() => addLine('service')}><span className="service-add-icon"><span>✦</span></span><span><strong>Add service</strong><small>e.g. laundry, airport pickup</small></span><Plus size={16} /></button><button className={`service-add-option ${activeForm === 'item' ? 'active' : ''}`} onClick={() => addLine('item')}><span className="service-add-icon item-add"><ShoppingBag size={17} /></span><span><strong>Add item</strong><small>e.g. bottled water, adapter</small></span><Plus size={16} /></button></div>
      {activeForm && <form className="inline-service-form" onSubmit={saveLine}><div className="service-form-label"><strong>{activeForm === 'service' ? 'New service' : 'New item'}</strong><button type="button" className="icon-button subtle" onClick={() => setActiveForm('')}><X size={15} /></button></div><div className="form-grid two-col"><Field label={activeForm === 'service' ? 'Service name' : 'Item name'}><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={activeForm === 'service' ? 'e.g. Laundry' : 'e.g. Water bottle'} /></Field><Field label="Price (ETB)"><input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="0.00" /></Field></div>{error && <div className="form-error">{error}</div>}<div className="inline-service-footer"><span>Added to guest bill in ETB</span><button className="button button-primary button-small"><Plus size={14} />Add line</button></div></form>}
      <div className="service-lines-heading"><strong>Added to this bill</strong><span>{lines.length} line{lines.length === 1 ? '' : 's'}</span></div><div className="service-draft-list">{lines.map((line) => <EditableCartLine key={line.id} line={line} editing={editing === line.id} onEdit={() => setEditing(editing === line.id ? '' : line.id)} onUpdate={(key, value) => updateLine(line.id, key, value)} onCancel={() => removeLine(line.id)} currency={ETB} />)}{!lines.length && !activeForm && <div className="service-empty">Add a service or item using the buttons above.</div>}</div><div className="service-total-row"><span>Total in ETB</span><strong>{formatMoney(total, ETB)}</strong></div><div className="modal-footer"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={!lines.length} onClick={() => onSave(lines)}><Check size={16} />Save to room bill</button></div></div></Modal>;
}

function EditableCartLine({ line, editing, onEdit, onUpdate, onCancel, currency = ETB }) {
  return <div className={`editable-cart-line ${editing ? 'is-editing' : ''}`}><div className="editable-line-main"><span className="editable-line-kind">{line.kind === 'food' ? <Coffee size={14} /> : line.kind === 'service' ? <span>✦</span> : <ShoppingBag size={14} />}</span>{editing ? <div className="cart-line-edit-fields"><input aria-label="Line name" value={line.name} onChange={(event) => onUpdate('name', event.target.value)} /><div><input aria-label="Quantity" type="number" min="1" value={line.qty} onChange={(event) => onUpdate('qty', event.target.value)} /><span>×</span><input aria-label="Price per item" type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => onUpdate('unitPrice', event.target.value)} /></div></div> : <div className="editable-line-copy"><strong>{line.name}</strong><small>{line.qty} × {formatMoney(line.unitPrice, currency)}</small></div>}</div><div className="editable-line-actions"><strong>{formatMoney((Number(line.qty) || 0) * (Number(line.unitPrice) || 0), currency)}</strong><button className="icon-button micro" title={editing ? 'Finish editing' : 'Edit line'} onClick={onEdit}>{editing ? <Check size={14} /> : <Pencil size={13} />}</button><button className="icon-button micro danger-hover" title="Cancel line" onClick={onCancel}><X size={14} /></button></div></div>;
}

function GuestOrderingPage({ data, targetKey, onSubmit }) {
  const target = data.rooms.find((room) => room.id === targetKey) || data.tables.find((table) => table.id === targetKey);
  const targetType = data.rooms.some((room) => room.id === targetKey) ? 'room' : 'table';
  const targetLabel = targetType === 'room' ? `Room ${target?.number || ''}` : target?.label || 'Table';
  const [category, setCategory] = useState('all');
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const categories = data.categories || [];
  const visible = data.menuItems.filter((item) => (category === 'all' || item.categoryId === category) && (!search || `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase())));
  const add = (item) => {
    setCart((current) => {
      const exists = current.find((line) => line.menuItemId === item.id);
      return exists ? current.map((line) => line.menuItemId === item.id ? { ...line, qty: line.qty + 1 } : line) : [...current, { id: makeId('guest-line'), menuItemId: item.id, name: item.name, qty: 1, unitPrice: Number(item.price) }];
    });
    setSent(false);
  };
  const adjust = (id, delta) => setCart((current) => current.map((line) => line.id === id ? { ...line, qty: line.qty + delta } : line).filter((line) => line.qty > 0));
  const total = calculateAddonTotal(cart);
  const send = async () => {
    if (!cart.length || sending) return;
    setSending(true); setError('');
    const ok = await onSubmit({ targetId: target.id, targetType, targetLabel, items: cart.map(({ menuItemId, name, qty, unitPrice }) => ({ menuItemId, name, qty, unitPrice })) });
    setSending(false);
    if (ok) { setSent(true); setCart([]); }
    else setError('Your order could not be sent. Please ask a hotel team member.');
  };
  if (!target) return <div className="guest-menu-page"><div className="guest-error-card"><div className="brand-mark"><BedDouble size={20} /></div><h1>QR code not found</h1><p>This room or table link may have been removed. Please ask a team member for help.</p></div></div>;
  return <div className="guest-menu-page"><header className="guest-menu-header"><div className="brand-lockup"><div className="brand-mark"><BedDouble size={19} /></div><div><div className="brand-name">{data.receiptTemplate?.hotelName || 'Haven House Hotel'}</div><div className="brand-caption">GUEST MENU</div></div></div><div className="guest-target"><Utensils size={15} />Ordering for <strong>{targetLabel}</strong></div></header><main className="guest-menu-content"><div className="guest-menu-hero"><span className="eyebrow">MADE WITH CARE</span><h1>Good food, just a scan away.</h1><p>Browse the menu and send your order straight to our team.</p></div>{sent && <div className="order-success"><CheckCircle2 size={20} /><div><strong>Your order is on its way.</strong><span>The team has received it. Need anything else? You can add another order below.</span></div><button className="icon-button" onClick={() => setSent(false)}><X size={16} /></button></div>}
    <div className="guest-menu-toolbar"><div className="guest-category-list"><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>All</button>{categories.map((item) => <button className={category === item.id ? 'active' : ''} key={item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}</div><div className="guest-menu-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a dish" /></div></div>
    <div className="guest-order-layout"><section className="guest-menu-grid">{visible.map((item) => <article className="guest-food-card" key={item.id}><div className="guest-food-image">{item.image ? <img src={item.image} alt={item.name} /> : <span>{item.emoji || '🍽️'}</span>}<span className="guest-food-category">{categories.find((entry) => entry.id === item.categoryId)?.name || 'Menu'}</span></div><div className="guest-food-card-copy"><div><h3>{item.name}</h3><p>{item.description || 'A fresh favourite from our kitchen.'}</p></div><div className="guest-food-card-bottom"><strong>{formatMoney(item.price, ETB)}</strong><button aria-label={`Add ${item.name}`} onClick={() => add(item)}><Plus size={17} /></button></div></div></article>)}{!visible.length && <div className="guest-menu-empty">No menu items found.</div>}</section><aside className="guest-cart"><div className="guest-cart-head"><span className="guest-cart-icon"><ShoppingBag size={17} /></span><div><strong>Your order</strong><small>{cart.reduce((sum, line) => sum + line.qty, 0)} item{cart.reduce((sum, line) => sum + line.qty, 0) === 1 ? '' : 's'}</small></div></div>{cart.length ? <div className="guest-cart-lines">{cart.map((line) => <div className="guest-cart-line" key={line.id}><div><strong>{line.name}</strong><span>{formatMoney(line.unitPrice, ETB)}</span></div><div className="quantity-stepper"><button onClick={() => adjust(line.id, -1)} aria-label={`Remove one ${line.name}`}><Minus size={13} /></button><strong>{line.qty}</strong><button onClick={() => adjust(line.id, 1)} aria-label={`Add one ${line.name}`}><Plus size={13} /></button></div></div>)}</div> : <div className="guest-cart-empty"><ShoppingBag size={22} /><span>Your cart is empty.<br />Add something delicious.</span></div>}<div className="guest-cart-total"><span>Order total · ETB</span><strong>{formatMoney(total, ETB)}</strong></div>{error && <div className="form-error">{error}</div>}<button className="button button-primary button-full" disabled={!cart.length || sending} onClick={send}>{sending ? 'Sending…' : 'Send order'}<ChevronRight size={16} /></button><div className="guest-cart-note"><ShieldCheck size={14} />Your order goes directly to the hotel team.</div></aside></div><div className="guest-menu-footer">Haven House Hotel <span>·</span> Addis Ababa</div></main></div>;
}

function Modal({ title, subtitle, onClose, children, size = 'medium', className = '' }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal-card modal-${size} ${className}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div><div className="modal-body">{children}</div></section></div>;
}

function Field({ label, children }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>;
}

function EmptyState({ icon: Icon, title, text }) {
  return <div className="empty-state"><span className="empty-state-icon"><Icon size={21} /></span><strong>{title}</strong><span>{text}</span></div>;
}

export default App;
