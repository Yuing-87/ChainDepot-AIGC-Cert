/* ===================================================================
 * works.js — 存证库（RBAC 差异化只读 / 管理）
 * creator 只见「我的存证」；admin / monitor 见「全网存证库」（monitor 只读）。
 * =================================================================== */
import * as chain from '../core/chain.js';
import { icon, empty } from '../core/ui.js';
import { esc, timeAgo, shortAddr } from '../core/util.js';
import { bindRoot, roleChip, kindBadge, versionTag, mediaBlock, openWorkModal, takeParams } from './_shared.js';

export default async function page(el) {
  const a = chain.active();
  const role = a.role;
  const me = a.addr;
  const isCreator = role === 'creator';
  const canReg = role === 'creator' || role === 'admin';
  const canManage = canReg; // creator / admin 可操作版本；monitor 只读

  /* 本次进入页面的查看范围 */
  const base = isCreator ? chain.worksOf(me) : chain.works();
  const total = base.length;

  /* 预计算：涉它侵权证据计数 + 版本链计数（基于全网数据） */
  const evCount = {};
  chain.evidence().forEach((e) => { evCount[e.workId] = (evCount[e.workId] || 0) + 1; });
  const rootCount = {};
  chain.works().forEach((w) => { rootCount[w.rootId] = (rootCount[w.rootId] || 0) + 1; });

  const title = isCreator ? '我的存证库' : '全网存证库';
  const scopeNote = isCreator
    ? `仅列出当前创作者身份上链的作品（共 ${total} 件），含全部迭代版本。`
    : role === 'monitor'
      ? '以只读身份查看全网公开存证（共 ' + total + ' 件）。'
      : '以管理视角查看全网存证（共 ' + total + ' 件）。';

  /* 焦点：从其他页面 go('works', {focus:id}) 进入时自动打开对应作品 */
  const focus = takeParams('works');

  el.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div>
        <h2>${title}</h2>
        <div class="page-sub" style="margin-top:6px"><span class="row" style="gap:8px;flex-wrap:wrap;align-items:center">${roleChip(role)}<span>${esc(scopeNote)}</span></span></div>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        ${canReg ? `<button class="btn btn-primary btn-sm" data-go="register">${icon('file-plus', 14)} 登记存证</button>` : ''}
        ${role === 'monitor' ? '<span class="badge badge-neutral">只读</span>' : ''}
      </div>
    </div>

    <div class="row wrap" style="gap:10px;margin-bottom:8px">
      <div class="pill-input" style="flex:1 1 280px">
        ${icon('search', 15)}
        <input id="wQ" type="text" placeholder="搜索标题 / 模型 / 作者名…" style="width:100%;min-width:120px" autocomplete="off">
        <button class="icon-btn" id="wClear" title="清空" aria-label="清空">${icon('x', 14)}</button>
      </div>
      <div class="seg" id="wKind">
        <button data-k="all" class="on">全部</button>
        <button data-k="image">${icon('image', 14)} 图片</button>
        <button data-k="text">${icon('align-left', 14)} 文本</button>
      </div>
    </div>
    <div class="row-between" style="margin:0 0 16px">
      <span class="muted small" id="wCount"></span>
      <span class="muted tiny">按最新登记时间排序</span>
    </div>

    <div class="grid" id="wGrid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:22px 18px;align-items:start"></div>
  </div>`;

  bindRoot(el);

  const grid = el.querySelector('#wGrid');
  const countEl = el.querySelector('#wCount');
  const qInput = el.querySelector('#wQ');

  let q = '';
  let kind = 'all';

  function matches(w) {
    if (kind !== 'all' && w.kind !== kind) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return ((w.title || '') + ' ' + (w.model || '') + ' ' + (w.authorsName || '')).toLowerCase().includes(s);
  }

  function cardHTML(w) {
    const ev = evCount[w.id] || 0;
    const hasChain = w.id === w.rootId && (rootCount[w.rootId] || 1) > 1;
    return `
    <div class="work-thumb-card" data-work="${w.id}" style="cursor:pointer;transition:border-color var(--t-fast),box-shadow var(--t-fast)">
      ${w.kind === 'image'
        ? `<img src="${w.thumb}" alt="${esc(w.title)}" loading="lazy">`
        : mediaBlock(w, { ratio: '4/3', maxText: 60 })}
      <div class="wtc-body">
        <div class="wtc-t ellip">${esc(w.title)}</div>
        <div class="wtc-s ellip">${esc(w.authorsName || shortAddr(w.author))} · ${timeAgo(w.anchored.ts)}</div>
        <div class="wtc-foot">
          <span class="row" style="gap:6px;flex-wrap:wrap">
            ${kindBadge(w.kind)}${versionTag(w)}
            ${hasChain ? `<span class="badge badge-neutral" style="font-family:var(--mono)" title="该存证共有 ${rootCount[w.rootId]} 个版本">共 ${rootCount[w.rootId]} 版</span>` : ''}
          </span>
          ${ev ? `<span class="badge badge-clay" title="该作品存在相关侵权证据">${icon('shield-alert', 11)} ${ev} 涉侵</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  function renderGrid(arr) {
    countEl.textContent = '匹配 ' + arr.length + ' / ' + total + ' 件';
    if (arr.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1"><div class="card">${empty(
        'search', '没有匹配的存证',
        total === 0 ? '当前范围暂无存证作品。' : '试试更换关键词或调整类型筛选。',
        total === 0 && canReg ? `<button class="btn btn-primary btn-sm" data-go="register" style="margin-top:8px">${icon('file-plus', 14)} 登记存证</button>` : ''
      )}</div></div>`;
      return;
    }
    grid.innerHTML = arr.map(cardHTML).join('');
  }

  function applyFilter() {
    renderGrid(base.filter(matches));
  }

  applyFilter();

  /* 事件绑定（工具栏元素常驻，仅重绘网格） */
  qInput.addEventListener('input', () => { q = qInput.value; applyFilter(); });
  el.querySelector('#wClear').addEventListener('click', () => { qInput.value = ''; q = ''; applyFilter(); qInput.focus(); });

  el.querySelectorAll('#wKind button').forEach((b) => {
    b.addEventListener('click', () => {
      el.querySelectorAll('#wKind button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      kind = b.getAttribute('data-k');
      applyFilter();
    });
  });

  grid.addEventListener('click', (e) => {
    const c = e.target.closest('[data-work]');
    if (!c) return;
    openWorkModal(Number(c.getAttribute('data-work')), { allowVersion: canManage });
  });

  /* focus 处理：可能为 rootId 或 workId */
  if (focus && focus.id != null) {
    const fid = Number(focus.id);
    let w = chain.workById(fid);
    if (!w) w = base.find((x) => x.rootId === fid) || null;
    if (w) {
      const card = grid.querySelector('[data-work="' + w.id + '"]');
      if (card) {
        card.style.borderColor = 'var(--sage)';
        card.style.boxShadow = '0 0 0 3px rgba(63,96,83,.16)';
        try { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { card.scrollIntoView(); }
      }
      openWorkModal(w.id, { allowVersion: canManage });
    }
  }

  return () => {};
}
