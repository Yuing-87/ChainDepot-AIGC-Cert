/* ===================================================================
 * ui.js — DOM 界面基础：线性图标、Toast、模态、确认框
 * 全部使用内联 SVG（Feather 风格 24×24，1.6 圆头描边），零 Emoji。
 * =================================================================== */
import { esc } from './util.js';

/* ---------- 线性图标集 ---------- */
const P = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

const ICON_PATHS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  shield: '<path d="M12 3l7 2.6v5.1c0 4.6-3 8.4-7 10.3-4-1.9-7-5.7-7-10.3V5.6L12 3z"/>',
  'shield-check': '<path d="M12 3l7 2.6v5.1c0 4.6-3 8.4-7 10.3-4-1.9-7-5.7-7-10.3V5.6L12 3z"/><path d="M9 11.8l2.1 2.2L15.2 9.6"/>',
  'shield-alert': '<path d="M12 3l7 2.6v5.1c0 4.6-3 8.4-7 10.3-4-1.9-7-5.7-7-10.3V5.6L12 3z"/><path d="M12 9v4"/><path d="M12 16.2v.1"/>',
  'file-plus': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5"/><path d="M12 12v5"/><path d="M9.5 14.5h5"/>',
  'file-text': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h6"/>',
  scan: '<path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3.2"/>',
  'alert-triangle': '<path d="M10.3 3.9L1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 16.8v.1"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.6 2.6 4.6-5.4"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  'chevron-down': '<path d="M6 9.5l6 6 6-6"/>',
  'chevron-right': '<path d="M9.5 6l6 6-6 6"/>',
  'chevron-left': '<path d="M14.5 6l-6 6 6 6"/>',
  'arrow-right': '<path d="M4 12h15"/><path d="M13.5 6.5L19.5 12l-6 5.5"/>',
  'arrow-up-right': '<path d="M7 17L17 7"/><path d="M8.5 7H17v8.5"/>',
  'arrow-down': '<path d="M12 4v15"/><path d="M6.5 13.5L12 19l5.5-5.5"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  link: '<path d="M9.5 14.5L14.5 9.5"/><path d="M11 6.5l2-2a4.2 4.2 0 0 1 6 6l-2 2"/><path d="M13 17.5l-2 2a4.2 4.2 0 0 1-6-6l2-2"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5"/>',
  activity: '<path d="M3 12h4l2.5-7 5 14 2.5-7h4"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20.5c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  users: '<circle cx="9" cy="8.5" r="3"/><path d="M3 20c.7-3 3.2-4.7 6-4.7s5.3 1.7 6 4.7"/><path d="M16.5 5.8a3 3 0 0 1 0 5.4"/><path d="M18.7 15.6c1.5.7 2.5 1.9 2.8 3.9"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2"/><path d="M3 7v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14" r="1.1" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  hash: '<path d="M5 9h14"/><path d="M5 15h14"/><path d="M10 3L8 21"/><path d="M16 3l-2 18"/>',
  key: '<circle cx="8" cy="14.5" r="4.5"/><path d="M11.2 11.3L20 3"/><path d="M16 7l3 3"/>',
  download: '<path d="M12 4v10"/><path d="M7 10.5l5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 15V4.5"/><path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M4 19.5h16"/>',
  'external-link': '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 13v6a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19V6.6A1.6 1.6 0 0 1 5.6 5h6"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/><path d="M12 14.6v2"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5.5-5.5 3 3L16 12l4.5 4.5"/>',
  'align-left': '<path d="M4 6h16"/><path d="M4 12h11"/><path d="M4 18h14"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  'log-out': '<path d="M14 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H14"/><path d="M10 12h11"/><path d="M17.5 8.5L21.5 12l-4 3.5"/>',
  'refresh': '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 3v5h-5"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 1 2.2 5.3"/><path d="M4.5 21v-3.5H8"/><path d="M12 8v4l2.6 1.6"/>',
  trash: '<path d="M4.5 6.5h15"/><path d="M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5"/><path d="M6.5 6.5l1 13a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8l1-13"/><path d="M10 10.5v6"/><path d="M14 10.5v6"/>',
  eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  bookmark: '<path d="M6.5 4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V21l-5.7-3.4L6.5 21V4.5z"/>',
  filter: '<path d="M4 5h16"/><path d="M6.5 12h11"/><path d="M9.5 19h5"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.4-2h6.2l1.4 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9z"/><circle cx="12" cy="13" r="3.4"/>',
  zap: '<path d="M13 3L5 13.5h6L11 21l8-10.5h-6L13 3z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.7 2.6 4 5.7 4 9s-1.3 6.4-4 9c-2.7-2.6-4-5.7-4-9s1.3-6.4 4-9z"/>',
  'award': '<circle cx="12" cy="9" r="5.5"/><path d="M8.8 13.6L7.5 21l4.5-2.6L16.5 21l-1.3-7.4"/>',
  'server': '<rect x="3.5" y="4.5" width="17" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="17" height="7" rx="1.8"/><path d="M7 8h.1M7 17h.1"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6"/><path d="M4.5 11.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6"/>',
  copy: '<rect x="9" y="9" width="11.5" height="11.5" rx="2"/><path d="M5.5 14.5H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5a2 2 0 0 1 2 2v.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20.5 20.5L16 16"/>',
  'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V13"/><path d="M12 16.4v.1"/>',
  'file-archive': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5"/><path d="M9 12h.1M9 15h.1M9 18h.1M12 12v6"/>',
  'box': '<path d="M21 8.2v7.6a1.5 1.5 0 0 1-.8 1.3l-7.2 4.1a1.5 1.5 0 0 1-1.5 0l-7.2-4.1a1.5 1.5 0 0 1-.8-1.3V8.2a1.5 1.5 0 0 1 .8-1.3l7.2-4.1a1.5 1.5 0 0 1 1.5 0l7.2 4.1a1.5 1.5 0 0 1 .8 1.3z"/><path d="M3.5 8.6l8.5 4.9 8.5-4.9"/><path d="M12 21.5v-8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.1"/>',
  'cpu': '<rect x="6" y="6" width="12" height="12" rx="1.8"/><rect x="10" y="10" width="4" height="4"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  'hexagon': '<path d="M12 2.5l8.2 5v9.5l-8.2 5-8.2-5V7.5l8.2-5z"/>',
  plus_circle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  send: '<path d="M21 3.5L10.5 14"/><path d="M21 3.5l-6.8 18-3.7-7.5L3 10.3l18-6.8z"/>',
  'book-open': '<path d="M12 6.5C10.5 5 8.4 4.4 4 4.4v14c4.4 0 6.5.6 8 2.1 1.5-1.5 3.6-2.1 8-2.1v-14c-4.4 0-6.5.6-8 2.1z"/><path d="M12 6.5v14"/>',
  'sliders': '<path d="M4 7h9"/><circle cx="16.5" cy="7" r="1.8"/><path d="M20 7h.1"/><path d="M4 17h2.5"/><circle cx="10" cy="17" r="1.8"/><path d="M12.5 17H20"/><path d="M4 12h12"/><circle cx="19.3" cy="12" r="1.8"/>',
  'feather-pen': '<path d="M20 4.5a2.1 2.1 0 0 0-3-0.3L5.5 15.5 4.5 19.5l4-1L20 7a2.1 2.1 0 0 0 0-2.5z"/>',
  scale: '<path d="M12 3v18"/><path d="M5 21h14"/><path d="M7 6h10"/><path d="M5 6l-2 6a3.5 3.5 0 0 0 4 0L5 6z"/><path d="M19 6l-2 6a3.5 3.5 0 0 0 4 0l-2-6z"/>',
  'circle-dot': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 20v-8"/><path d="M12 8v13"/><path d="M12 8s-1-4-3.5-4A2.2 2.2 0 0 0 8 8h4z"/><path d="M12 8s1-4 3.5-4A2.2 2.2 0 0 1 16 8h-4z"/>',
};

export function icon(name, size = 18, cls = '') {
  const d = ICON_PATHS[name] || ICON_PATHS.info;
  const attr = Object.entries(P).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" ${attr} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${d}</svg>`;
}

/* ---------- Toast ---------- */
export function toast(message, type = 'ok', title) {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  const ico = type === 'ok' ? 'check-circle' : type === 'err' ? 'alert-triangle' : type === 'warn' ? 'alert-circle' : 'info';
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = icon(ico, 17) + '<span>' + (title ? `<span class="toast-t">${esc(title)} · </span>` : '') + esc(message) + '</span>';
  wrap.appendChild(el);
  const kill = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); };
  el.addEventListener('click', kill);
  setTimeout(kill, type === 'ok' ? 3600 : 5200);
  // 仅保留最近 4 条
  while (wrap.children.length > 4) wrap.firstChild.remove();
}

export const toastOk = (m, t) => toast(m, 'ok', t);
export const toastErr = (m, t) => toast(m, 'err', t);
export const toastInfo = (m, t) => toast(m, 'info', t);

/* ---------- 模态 ---------- */
export function modal({ title, body, foot, size = '', onMount, closable = true }) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const box = document.createElement('div');
  box.className = 'modal ' + size;
  box.innerHTML = `
    <div class="modal-head">
      <h3>${esc(title)}</h3>
      <button class="icon-btn modal-close" aria-label="关闭">${icon('x', 16)}</button>
    </div>
    <div class="modal-body"></div>
    ${foot !== undefined ? '<div class="modal-foot"></div>' : ''}`;
  const bodyBox = box.querySelector('.modal-body');
  const footBox = foot !== undefined ? box.querySelector('.modal-foot') : null;
  if (typeof body === 'string') bodyBox.innerHTML = body;
  else bodyBox.appendChild(body);

  const close = () => { mask.remove(); document.removeEventListener('keydown', onKey); };
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  mask.addEventListener('mousedown', (e) => { if (e.target === mask && closable) close(); });
  box.querySelector('.modal-close').addEventListener('click', close);
  if (footBox && typeof foot === 'string') footBox.innerHTML = foot;
  mask.appendChild(box);
  document.body.appendChild(mask);
  if (onMount) onMount(box, close);
  return { close, box, bodyBox, footBox };
}

/** 简单确认框 */
export function confirmDialog({ title = '确认操作', text, okText = '确认', danger = false }) {
  return new Promise((resolve) => {
    const m = modal({
      title, size: 'sm',
      body: `<div style="font-size:13.5px;color:var(--sub);padding:4px 0">${esc(text)}</div>`,
      foot: `<button class="btn btn-neutral btn-sm cancel">取消</button>
             <button class="btn btn-sm ok ${danger ? 'btn-danger-solid' : 'btn-primary'}">${esc(okText)}</button>`,
    });
    m.footBox.querySelector('.ok').onclick = () => { m.close(); resolve(true); };
    m.footBox.querySelector('.cancel').onclick = () => { m.close(); resolve(false); };
  });
}

/** 空状态 */
export function empty(iconName, title, sub, actionHtml = '') {
  return `<div class="empty">${icon(iconName, 34)}<b>${esc(title)}</b><span>${esc(sub)}</span>${actionHtml}</div>`;
}

/** 通用单行进度条 */
export function progress(value, cls = '') {
  const v = Math.max(0, Math.min(100, value));
  return `<div class="sim-bar ${cls}"><i style="width:${v}%"></i></div>`;
}
