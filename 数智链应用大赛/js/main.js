/* ===================================================================
 * main.js — 应用引导 / 壳 / 路由与 RBAC 守卫
 * =================================================================== */
import * as chain from './core/chain.js';
import { PAGES, navGroupsFor, canAccess, pagesFor } from './core/rbac.js';
import { icon, modal, toast, toastOk, toastErr, toastInfo } from './core/ui.js';
import { esc, shortAddr, ls } from './core/util.js';
import { bindRoot } from './pages/_shared.js';

/* ---------- 页面注册表 ---------- */
const views = {
  dashboard: () => import('./pages/dashboard.js').then((m) => m.default),
  register: () => import('./pages/register.js').then((m) => m.default),
  works: () => import('./pages/works.js').then((m) => m.default),
  detect: () => import('./pages/detect.js').then((m) => m.default),
  evidence: () => import('./pages/evidence.js').then((m) => m.default),
  authz: () => import('./pages/authz.js').then((m) => m.default),
  chain: () => import('./pages/chain.js').then((m) => m.default),
  verify: () => import('./pages/verify.js').then((m) => m.default),
  wallet: () => import('./pages/wallet.js').then((m) => m.default),
  account: () => import('./pages/account.js').then((m) => m.default),
};

let currentClean = null;
let currentRoute = '';
let busyTimer = null;
const appRoot = document.getElementById('app-root');

/* ---------- 忙碌指示（链上确认状态） ---------- */
function setBusy(text) {
  const el = document.getElementById('busyPill');
  if (!el) return;
  if (text) {
    el.innerHTML = '<span class="dot" style="background:#fff;opacity:.9"></span>' + esc(text);
    el.style.display = 'inline-flex';
  } else {
    el.style.display = 'none';
  }
}
chain.on('busy', (b) => setBusy((b.label || '上链') + ' · ' + (b.phase || '处理中') + '…'));
chain.on('tx', () => { clearTimeout(busyTimer); busyTimer = setTimeout(() => setBusy(''), 1200); });

/* ---------- 壳 ---------- */
function shellHTML() {
  return `
  <aside class="rail" id="rail">
    <div class="rail-brand">
      <span class="brand-mark">${icon('shield-check', 19)}</span>
      <div class="brand-name"><b>链证 ChainVault</b><span>AIGC IP Registry</span></div>
    </div>
    <nav class="rail-nav" id="nav"></nav>
    <div class="rail-foot" id="railFoot"></div>
  </aside>
  <div class="rail-backdrop" id="backdrop"></div>
  <div class="main">
    <header class="topbar" id="topbar"></header>
    <main class="view" id="view"></main>
  </div>`;
}

function roleToneClass(role) {
  return ({ admin: 'slate', creator: 'sage', monitor: 'clay', user: 'sand' })[role] || 'sage';
}

function topbarHTML() {
  const a = chain.active();
  const p = PAGES[currentRoute];
  const grp = p ? p.group : '总览';
  const mode = chain.modeNow();
  return `
  <button class="menu-btn" id="menuBtn" aria-label="菜单">${icon('menu', 20)}</button>
  <div class="topbar-title">
    <span class="crumb">${esc(grp)}</span>
    <h1>${p ? esc(p.name) : ''}</h1>
  </div>
  <div class="top-actions">
    <div class="mode-toggle" id="modeToggle" title="模拟链 / 真实链 一键切换">
      <button data-mode="mock" class="${mode === 'mock' ? 'on' : ''}">${icon('server', 12)} 模拟链</button>
      <button data-mode="real" class="${mode === 'real' ? 'on' : ''}">${icon('link', 12)} 真实链</button>
    </div>
    <span class="badge badge-neutral" id="busyPill" style="display:none"></span>
    <button class="chip" id="tokChip" style="cursor:pointer;color:var(--sage-deep);background:var(--sage-soft);border-color:transparent;font-weight:600" title="我的钱包 · 点击进入">
      ${icon('wallet', 13)}<span class="tk-w"> 钱包 </span><b class="mono" id="tokAmt">${chain.tokenBalance(chain.active().addr)}</b><span class="tk-cvt"> CVT</span>
    </button>
    <div class="identity" id="identity">
      <button class="identity-btn" id="identityBtn">
        <span class="avatar ${roleToneClass(a.role)}">${esc((a.name || '匿')[0])}</span>
        <span class="identity-meta"><b>${esc(a.name)}</b><span>${roleLabel(a.role)}</span></span>
        ${icon('chevron-down', 14, 'chev')}
      </button>
      <div class="identity-menu" id="identityMenu" style="display:none">${identityMenuHTML()}</div>
    </div>
  </div>`;
}

function roleLabel(r) { return ({ admin: '管理员', creator: '创作者', monitor: '监测机构', user: '普通用户' })[r] || r; }

function navHTML() {
  const role = chain.active().role;
  const groups = navGroupsFor(role);
  return groups.map((g) => `
    <div class="nav-group-label">${esc(g.label)}</div>
    ${g.items.map((it) => `<button class="nav-item ${currentRoute === it.key ? 'active' : ''}" data-route="${it.key}">
      ${icon(it.icon, 18)}<span>${esc(it.name)}</span>${it.key === 'detect' && role !== 'user' ? '<span class="nav-tag">NEW</span>' : ''}
    </button>`).join('')}`).join('');
}

function identityMenuHTML() {
  const a = chain.active();
  const isMock = chain.modeNow() === 'mock';
  return `
  <div class="im-title">演示身份 · 一键切换查看 RBAC 差异</div>
  ${chain.accounts().map((acc) => `
    <div class="im-item ${acc.addr === a.addr ? 'on' : ''}" data-acc="${esc(acc.addr)}">
      <span class="avatar ${acc.tone}">${esc((acc.name || '匿')[0])}</span>
      <span style="min-width:0;flex:1">
        <b class="small" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(acc.name)}</b>
        <span class="addr">${shortAddr(acc.addr)}</span>
      </span>
      <span class="badge badge-neutral">${roleLabel(acc.role)}</span>
    </div>`).join('')}
  ${isMock ? `
  <div class="im-sep"></div>
  <button class="im-act" id="actNewAccount">${icon('plus', 15)} 新建账户（模拟链）</button>` : `
  <div class="im-sep"></div>
  <div class="im-title">真实链模式 · 链上账户为 MetaMask 当前地址</div>`}
  <button class="im-act" id="actAccountCenter" style="margin-top:4px">${icon('user', 15)} 个人中心 · 角色资料</button>`;
}

/* ---------- 事件委托（壳层） ---------- */
function bindShell() {
  const nav = document.getElementById('nav');
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-route]');
    if (b) { location.hash = '#/' + b.getAttribute('data-route'); closeDrawer(); }
  });

  document.getElementById('modeToggle').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    const target = b.getAttribute('data-mode');
    if (target === chain.modeNow()) return;
    setBusy('连接 ' + (target === 'real' ? '真实链（MetaMask）' : '模拟链') + '…');
    const res = await chain.setMode(target);
    setBusy('');
    if (res.ok) {
      (target === 'real' ? toastOk : toastInfo)(res.msg || '已切换');
      rerenderShell();
    } else {
      toastErr(res.msg || '切换失败');
    }
  });

  const identityBtn = document.getElementById('identityBtn');
  const menu = document.getElementById('identityMenu');
  const toggle = () => { const open = menu.style.display !== 'none'; menu.style.display = open ? 'none' : 'block'; };
  identityBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.identity')) menu.style.display = 'none';
  });
  menu.addEventListener('click', (e) => {
    const it = e.target.closest('[data-acc]');
    if (it) {
      const ok = chain.switchAccount(it.getAttribute('data-acc'));
      if (ok) { menu.style.display = 'none'; toastInfo('已切换身份：' + chain.active().name); rerenderShell(); }
      return;
    }
    if (e.target.closest('#actAccountCenter')) {
      menu.style.display = 'none';
      location.hash = '#/account';
      return;
    }
    if (e.target.closest('#actNewAccount')) {
      menu.style.display = 'none';
      openNewAccount();
    }
  });

  const menuBtn = document.getElementById('menuBtn');
  menuBtn.addEventListener('click', openDrawer);
  document.getElementById('backdrop').addEventListener('click', closeDrawer);

  const tokChip = document.getElementById('tokChip');
  if (tokChip) tokChip.addEventListener('click', () => { location.hash = '#/wallet'; });

  // 委托：data-go / data-copy
  bindRoot(document.getElementById('view'));
}

/** 顶栏钱包余额即时刷新（奖励到账事件触发） */
function refreshTokenChip() {
  const el = document.getElementById('tokAmt');
  if (el) el.textContent = chain.tokenBalance(chain.active().addr);
}

function openDrawer() { document.getElementById('rail').classList.add('open'); document.getElementById('backdrop').classList.add('show'); }
function closeDrawer() { document.getElementById('rail').classList.remove('open'); document.getElementById('backdrop').classList.remove('show'); }

function openNewAccount() {
  const isMock = chain.modeNow() === 'mock';
  if (!isMock) { toastErr('真实链模式下请使用 MetaMask 创建账户'); return; }
  const body = `<div class="stack">
    <div class="field"><span class="field-label">账户名称（昵称）</span><input class="input" id="naName" maxlength="16" placeholder="例如：李创作"></div>
    <div class="field"><span class="field-label">角色身份</span>
      <select class="select" id="naRole">
        <option value="creator">创作者</option>
        <option value="monitor">监测机构</option>
        <option value="admin">管理员</option>
        <option value="user">普通用户</option>
      </select></div>
    <div class="note paper">${icon('info', 15)}<div>钱包地址即账户：系统将自动生成新的模拟地址，并广播一笔「账户注册」交易。</div></div>
  </div>`;
  const m = modal({ title: '创建模拟链账户', size: 'sm', body,
    foot: `<button class="btn btn-neutral btn-sm" data-c="c">取消</button><button class="btn btn-primary btn-sm" data-c="ok">创建账户</button>` });
  m.footBox.querySelector('[data-c=c]').onclick = m.close;
  m.footBox.querySelector('[data-c=ok]').onclick = () => {
    const name = (m.box.querySelector('#naName').value || '').trim();
    const role = m.box.querySelector('#naRole').value;
    if (!name) { toast('请填写账户名称', 'err'); return; }
    const acc = chain.addAccount({ name, role });
    m.close();
    toastOk(`账户 ${acc.name} 已创建并切换为当前身份`);
    rerenderShell();
  };
}

function rerenderShell() {
  const topbar = document.getElementById('topbar');
  topbar.innerHTML = topbarHTML();
  document.getElementById('nav').innerHTML = navHTML();
  bindShell();
  document.getElementById('railFoot').innerHTML = railFootHTML();
}

function railFootHTML() {
  const m = chain.modeNow();
  const live = chain.chainStatus();
  return `${icon(m === 'mock' ? 'server' : 'link', 13)}
    <span>${m === 'mock' ? '模拟链在线' : '真实链 · MetaMask'}</span>
    <span style="margin-left:auto" title="区块高度 / 交易数">#${live.block} · ${live.txs} tx</span>`;
}

/* ---------- 路由 ---------- */
async function route() {
  const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const name = raw.split('?')[0].split('/')[0] || 'dashboard';
  const role = chain.active().role;

  // 页面级守卫：越权访问 -> 回到看板
  if (!PAGES[name] || !canAccess(name, role)) {
    if (name !== 'dashboard' && PAGES[name]) {
      toastErr('当前身份无权访问「' + PAGES[name].name + '」页面，已返回数据看板（页面级 RBAC 守卫）');
    }
    location.replace('#/dashboard');
    return;
  }

  if (currentClean) { try { currentClean(); } catch {} }
  const viewEl = document.getElementById('view');
  viewEl.innerHTML = '<div class="page" style="display:grid;place-items:center;min-height:60vh;color:var(--muted)">' + icon('circle-dot', 22) + '</div>';

  try {
    const mod = await views[name]();
    currentRoute = name;
    document.getElementById('nav').innerHTML = navHTML();
    document.getElementById('topbar').innerHTML = topbarHTML();
    bindShell();
    bindRoot(viewEl);
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.getAttribute('data-route') === name));
    // 清除加载指示器，避免 appendChild 类页面残留圆点
    viewEl.innerHTML = '';
    const ret = await mod(viewEl);
    if (ret && typeof ret === 'function') currentClean = ret;
    else currentClean = null;
    window.scrollTo({ top: 0 });
  } catch (e) {
    console.error(e);
    viewEl.innerHTML = `<div class="page"><div class="note clay">${icon('alert-triangle', 16)}<div>页面加载异常：${esc(e.message)}</div></div></div>`;
  }
}

/* ---------- 引导 ---------- */
function splashHTML() {
  return `<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--bg)">
    <span class="brand-mark" style="width:48px;height:48px;border-radius:13px">${icon('shield-check', 26)}</span>
    <div class="serif" style="font-size:19px;letter-spacing:.1em">链证 ChainVault</div>
    <div class="muted tiny" style="letter-spacing:.3em">正在初始化本地链与演示数据…</div>
  </div>`;
}

async function boot() {
  appRoot.innerHTML = splashHTML();
  try {
    await chain.init();
  } catch (e) {
    console.error(e);
  }
  appRoot.innerHTML = shellHTML();
  document.getElementById('nav').innerHTML = navHTML();
  document.getElementById('topbar').innerHTML = topbarHTML();
  document.getElementById('railFoot').innerHTML = railFootHTML();
  bindShell();

  window.addEventListener('hashchange', route);

  // 全局事件：身份/模式切换后刷新壳
  chain.on('session', () => { closeDrawer(); rerenderShell(); route(); });
  chain.on('mode', () => { closeDrawer(); document.getElementById('railFoot').innerHTML = railFootHTML(); route(); });
  chain.on('token', refreshTokenChip);
  chain.on('data', () => {
    const t = document.getElementById('railFoot');
    if (t) t.innerHTML = railFootHTML();
  });

  if (!location.hash) location.hash = '#/dashboard';
  route();
  window.addEventListener('focus', () => { if (chain.readyP()) route(); });
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', boot)
  : boot();
