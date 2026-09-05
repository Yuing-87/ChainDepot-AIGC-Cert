/* ===================================================================
 * util.js — 纯工具函数（无 DOM 依赖）
 * =================================================================== */

/** HTML 转义 */
export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function uid(prefix = 'id') {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function shortAddr(addr, n = 6, m = 4) {
  if (!addr) return '';
  if (addr.length <= n + m + 1) return addr;
  return addr.slice(0, n) + '…' + addr.slice(-m);
}

/** 展示用的短哈希 */
export const shortHash = (h, n = 6) => (h ? (h.length > 14 ? h.slice(0, n) + '…' + h.slice(-4) : h) : '');

export function fmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return '刚刚';
  if (s < 60) return s + ' 秒前';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 30) return d + ' 天前';
  return fmtDate(ts);
}

/** localStorage 安全封装 */
export const ls = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
  },
  del(key) { try { localStorage.removeItem(key); } catch {} },
};

export const K = {
  mock: 'chainvault.mock.v1',
  data: 'chainvault.data.v1',
  realCfg: 'chainvault.realcfg.v1',
  session: 'chainvault.session.v1',
  seedTag: 'chainvault.seeded.v1',
  pins: 'chainvault.pins.v1',
};

/** 大数可读化 */
export function fmtNum(n) {
  if (n === null || n === undefined) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

/** 字节数可读化 */
export function fmtBytes(n) {
  if (n === undefined || n === null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

export function fmtPct(v, digits = 0) {
  return v.toFixed(digits) + '%';
}

/** 数字千分位 */
export function fmtInt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/** 从 dataURL 转 Blob */
export function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = (head.match(/data:(.*?);/) || [])[1] || 'application/octet-stream';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** dataURL -> Uint8Array（字节级指纹用） */
export function dataUrlToBytes(dataUrl) {
  const body = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

export function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }
}

/** 判定 hex 字符串 */
export const isHex = (s) => typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s);

/** 统一相似度描述 */
export function simLabel(sim) {
  if (sim >= 99.5) return '完全相同';
  if (sim >= 85) return '高度相似';
  if (sim >= 70) return '明显相似';
  if (sim >= 55) return '可能相似';
  return '低相似';
}

/** 轻量版 Deep-freeze-free 深拷贝 */
export const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

export function debounce(fn, wait = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

/* ===================================================================
 * Gas 引擎（EVM 风格）
 * 由交易类型与哈希确定性派生，历史数据无需迁移即可复算展示。
 * =================================================================== */
const GAS_BASE = { register: 421220, version: 286400, authz: 142600, revoke: 74200, evidence: 317850, account: 21000 };

function gasSeed(hexStr) {
  let n = 0;
  for (let i = 0; i < 8 && i < (hexStr || '').length; i++) {
    n = ((n * 16) + parseInt(hexStr[i], 16)) >>> 0;
  }
  return n;
}

/**
 * 计算一笔链上交易（模拟）的 Gas 信息
 * @param {object} tx { type:'register'|'version'|'authz'|'revoke'|'evidence'|'account', hash }
 * @returns {{gasUsed:number, gasPriceGwei:number, feeEth:number}}
 */
export function txGas(tx) {
  const type = (tx && tx.type) || 'register';
  const h = (tx && tx.hash) || '0x0';
  const base = GAS_BASE[type] || 21000;
  const gasUsed = base + (gasSeed(h.slice(0, 18)) % 2997);           // 类型基础消耗 + 确定性波动
  const gasPriceGwei = 16 + (gasSeed((h.slice(2, 10) || 'a0b0c0d0')) % 7); // 16 ~ 22 gwei（含 baseFee+小费）
  const feeEth = Number(((gasUsed * gasPriceGwei) / 1e9).toFixed(6)); // 换算为 ETH
  return { gasUsed, gasPriceGwei, feeEth };
}

/** 交易 Gas 消耗展示，如 "421,332" */
export function fmtGasUsed(tx) { return fmtInt(txGas(tx).gasUsed); }
/** 交易手续费展示，如 "0.0093 ETH · 21 gwei" */
export function fmtGasFee(tx) {
  const g = txGas(tx);
  return (g.feeEth >= 0.001 ? g.feeEth.toFixed(4) : g.feeEth.toFixed(6)) + ' ETH · ' + g.gasPriceGwei + ' gwei';
}
