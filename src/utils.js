import seed from '../shared/seed.json';

export const ETB = 'ETB';
export const COMMON_CURRENCIES = ['ETB', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'CAD', 'AUD', 'CHF', 'JPY'];

export function makeId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function cloneSeed() {
  return JSON.parse(JSON.stringify(seed));
}

const displayNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' });
  } catch {
    return null;
  }
})();

function getCurrencyCodes() {
  let codes = [];
  try {
    codes = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : [];
  } catch {
    codes = [];
  }
  const fallback = [
    'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'UYU', 'UZS', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD', 'XOF', 'XPF', 'YER', 'ZAR', 'ZMW', 'ZWL'
  ];
  return [...new Set([...codes, ...fallback, ...COMMON_CURRENCIES])];
}

const allCodes = getCurrencyCodes();
const commonRank = new Map(COMMON_CURRENCIES.map((code, index) => [code, index]));
export const CURRENCIES = allCodes
  .sort((a, b) => {
    const aCommon = commonRank.has(a);
    const bCommon = commonRank.has(b);
    if (aCommon && bCommon) return commonRank.get(a) - commonRank.get(b);
    if (aCommon) return -1;
    if (bCommon) return 1;
    return a.localeCompare(b);
  })
  .map((code) => {
    let name = code;
    try {
      name = displayNames?.of(code) || code;
    } catch {
      // A code may be a historic or fund currency and have no display name.
    }
    return { code, name, label: `${name} (${code})` };
  });

export function formatMoney(amount, currency = ETB, options = {}) {
  const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || ETB,
      currencyDisplay: options.display || 'code',
      minimumFractionDigits: options.minimumFractionDigits ?? 0,
      maximumFractionDigits: options.maximumFractionDigits ?? 2,
    }).format(safeAmount);
  } catch {
    return `${currency || ETB} ${safeAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
}

export function getStayDays(checkInAt, now = new Date()) {
  if (!checkInAt) return 1;
  const startDate = new Date(checkInAt);
  if (Number.isNaN(startDate.getTime())) return 1;
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
}

export function dateLabel(value, options = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-ET', {
    dateStyle: options.dateStyle || 'medium',
    ...(options.time ? { timeStyle: 'short' } : {}),
  }).format(date);
}

export function timeAgo(value) {
  if (!value) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? '' : 's'} ago`;
}

export function getOrderTotal(order) {
  return (order?.items || []).reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0), 0);
}
