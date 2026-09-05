/* ===================================================================
 * evidence.js — 证据中心
 * 汇总「固定侵权证据」记录（二次上链）：
 *   - 角色差异化视图：admin / monitor = 全部；creator = 仅「我报告 + 涉及我作品」
 *   - 每条标注二次上链：证据固定交易哈希与区块号
 *   - 内置带时间戳水印的取证快照预览（buildEvidenceShotHTML）
 *   - 行操作：详情 / 导出维权证据包 / 查看原作存证（对可看用户全部开放）
 * =================================================================== */
import * as chain from '../core/chain.js';
import { icon, toastOk, toastErr, empty } from '../core/ui.js';
import { esc, fmtTs, timeAgo, shortAddr, shortHash } from '../core/util.js';
import { bindRoot, openWorkModal, openEvidenceModal } from './_shared.js';
import { buildEvidenceShotHTML, exportEvidencePackage } from '../core/cert.js';

export default async function page(el) {
  const me = chain.active();
  const myRole = me.role;
  const isCreator = myRole === 'creator';

  let fType = 'all';     // all | high | exact
  let sortBy = 'ts';     // ts | sim
  let keyword = '';

  /** 角色差异化数据源 */
  function scopeList() {
    let list = chain.evidence();
    if (isCreator) {
      const myWorkIds = new Set(chain.worksOf(me.addr).map((w) => w.id));
      list = list.filter((e) => e.reporter === me.addr || myWorkIds.has(e.workId));
    }
    return list;
  }

  const allScoped = scopeList();

  /* ---------------- 骨架 ---------------- */
  el.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div>
        <h2>证据中心</h2>
        <div class="page-sub">侵权证据经<b>固定上链（二次上链）</b>后在此归档：每条记录可预览带时间戳水印的取证快照，并一键导出结构化维权证据包。</div>
      </div>
      <span class="badge badge-neutral">${isCreator ? '本视角（我相关）' : myRole === 'monitor' ? '监测机构 · 全网' : '管理员 · 全网'}</span>
    </div>

    ${isCreator ? `
    <div class="topnote">${icon('shield', 16)}<div><b>创作者视角：</b>此处仅显示由我发起固定、或涉及我名下存证作品的证据；切换至「监测机构 / 管理员」身份可查看全网证据。</div></div>` : ''}

    <div class="grid grid-4" id="kpiGrid"></div>

    <div class="card" style="margin-top:24px">
      <div class="row wrap" style="gap:12px">
        <input class="input" id="evSearch" placeholder="搜索作品 / 标题 / 取证方 / 编号…" style="flex:1 1 240px;max-width:360px;min-width:180px" value="">
        <div class="seg" id="typeSeg">
          <button data-f="all" class="on">全部</button>
          <button data-f="high">高度相似</button>
          <button data-f="exact">完全相同</button>
        </div>
        <select class="select" id="evSort" style="width:auto;min-width:150px">
          <option value="ts">时间 · 新→旧</option>
          <option value="sim">相似度 · 高→低</option>
        </select>
      </div>
    </div>

    <div id="evList" style="margin-top:24px"></div>
  </div>`;

  bindRoot(el);
  const kpiGrid = el.querySelector('#kpiGrid');
  const listBox = el.querySelector('#evList');
  const searchInput = el.querySelector('#evSearch');
  const sortSel = el.querySelector('#evSort');

  /* ---------------- KPI ---------------- */
  function renderStats() {
    const n = allScoped.length;
    const sev = allScoped.filter((e) => e.verdict === 'high' || e.verdict === 'exact').length;
    const avg = n ? allScoped.reduce((s, e) => s + (Number(e.sim) || 0), 0) / n : 0;
    const worksN = new Set(allScoped.map((e) => e.workId)).size;
    kpiGrid.innerHTML = `
      <div class="stat"><div class="stat-icon">${icon('shield-alert', 17)}</div><div class="stat-num">${n}</div><div class="stat-label">本视角证据</div><div class="stat-sub">${isCreator ? '我报告 · 涉我作品' : '全网固定证据'}</div></div>
      <div class="stat clay"><div class="stat-icon">${icon('alert-triangle', 17)}</div><div class="stat-num">${sev}</div><div class="stat-label">高相似 / 完全相同</div><div class="stat-sub">verdict high + exact</div></div>
      <div class="stat"><div class="stat-icon">${icon('activity', 17)}</div><div class="stat-num">${n ? avg.toFixed(1) + '%' : '—'}</div><div class="stat-label">平均相似度</div><div class="stat-sub">两级综合评分</div></div>
      <div class="stat"><div class="stat-icon">${icon('layers', 17)}</div><div class="stat-num">${worksN}</div><div class="stat-label">关联作品数</div><div class="stat-sub">被侵权的存证作品</div></div>`;
  }

  /* ---------------- 筛选 / 排序 ---------------- */
  function filterAndSort() {
    const kw = keyword.trim().toLowerCase();
    let list = allScoped.filter((e) => {
      if (fType === 'high' && e.verdict !== 'high') return false;
      if (fType === 'exact' && e.verdict !== 'exact') return false;
      if (!kw) return true;
      const w = chain.workById(e.workId);
      const hay = ['EV-' + String(e.id).padStart(5, '0'), String(e.id), (e.query && e.query.title) || '', (w && w.title) || '', e.reporterName || ''].join(' ').toLowerCase();
      return hay.includes(kw);
    });
    list = list.slice();
    list.sort((a, b) => (sortBy === 'sim' ? b.sim - a.sim : b.anchored.ts - a.anchored.ts));
    return list;
  }

  el.querySelectorAll('#typeSeg button').forEach((b) => {
    b.onclick = () => {
      el.querySelectorAll('#typeSeg button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      fType = b.getAttribute('data-f');
      renderList();
    };
  });
  searchInput.addEventListener('input', () => { keyword = searchInput.value; renderList(); });
  sortSel.addEventListener('change', () => { sortBy = sortSel.value; renderList(); });

  /* ---------------- 列表渲染 ---------------- */
  function verdictMeta(verdict) {
    if (verdict === 'exact') return { t: '完全相同', cls: 'badge-clay' };
    if (verdict === 'high') return { t: '高度相似', cls: 'badge-clay' };
    if (verdict === 'medium') return { t: '中度相似', cls: 'badge-neutral' };
    return { t: '低相似', cls: 'badge-neutral' };
  }

  function renderList() {
    const rows = filterAndSort();
    if (allScoped.length === 0) {
      listBox.innerHTML = `<div class="card">${empty('shield-alert', '暂无固定证据', '在「侵权检测」页比对命中后点「固定证据」，或切换至监测机构身份发起，即可在此归档。')}</div>`;
      return;
    }
    if (rows.length === 0) {
      listBox.innerHTML = `<div class="card">${empty('search', '没有符合条件的证据', '请调整搜索关键词、类型筛选或排序方式后重试。')}</div>`;
      return;
    }
    listBox.innerHTML = `<div class="stack" style="gap:16px">${rows.map(evCardHTML).join('')}</div>`;

    listBox.querySelectorAll('.ev-detail').forEach((b) => {
      b.onclick = () => openEvidenceModal(Number(b.getAttribute('data-id')));
    });
    listBox.querySelectorAll('.ev-pkg').forEach((b) => {
      b.onclick = () => exportFrom(Number(b.getAttribute('data-id')), b);
    });
    listBox.querySelectorAll('.ev-work').forEach((b) => {
      b.onclick = () => openWorkModal(Number(b.getAttribute('data-work')), { allowVersion: myRole !== 'user' });
    });
  }

  function evCardHTML(e) {
    const w = chain.workById(e.workId);
    const vm = verdictMeta(e.verdict);
    const qTitle = (e.query && e.query.title) || '侵权证据';
    const sim = Number(e.sim) || 0;
    const thumb = w && w.kind === 'image'
      ? `<img src="${w.thumb}" alt="" style="width:96px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--line-soft)">`
      : `<span style="width:96px;height:72px;flex:0 0 96px;border-radius:8px;display:grid;place-items:center;background:linear-gradient(160deg,#F1F0EA,#E3E9E2);border:1px solid var(--line-soft);color:var(--sage)">${icon('align-left', 18)}</span>`;

    return `
    <div class="card" style="padding:16px 18px">
      <div class="row wrap" style="align-items:flex-start;gap:14px">
        ${w ? `<div style="flex:0 0 96px">${thumb}</div>` : ''}
        <div class="grow" style="min-width:0">
          <div class="row wrap" style="gap:7px">
            <span class="badge badge-ink">EV-${String(e.id).padStart(5, '0')}</span>
            <span class="badge ${vm.cls}">${vm.t}</span>
            <span class="badge badge-neutral">取证方 ${esc(e.reporterName || shortAddr(e.reporter))}</span>
            ${w && w.kind === 'image' ? '<span class="badge badge-neutral">图片</span>' : w ? '<span class="badge badge-neutral">文本</span>' : ''}
          </div>
          <div class="serif" style="font-size:16.5px;font-weight:600;margin-top:7px">${esc(qTitle)}</div>
          <div class="muted small" style="margin-top:2px">
            ${w ? `目标作品：<b class="accent-sage">${esc(w.title)}</b> · CV-${String(w.id).padStart(6, '0')} · 作者 ${esc(w.authorsName || shortAddr(w.author))}` : '目标作品已不在存证库中'}
          </div>
          <div class="row wrap" style="gap:8px;margin-top:9px;font-size:11.5px;color:var(--sub)">
            <span>${icon('clock', 12)} ${fmtTs(e.anchored.ts)} · ${timeAgo(e.anchored.ts)}</span>
            <span>${icon('link', 12)} 二次上链 区块 <b>#${e.anchored.block}</b></span>
            <span class="hash-inline" data-copy="${esc(e.anchored.hash || '')}" title="点击复制交易哈希">tx ${shortHash(e.anchored.hash)}</span>
          </div>
        </div>
        <div style="text-align:right;flex:0 0 auto">
          <div class="sim-num" style="color:var(--clay)">${sim.toFixed(1)}%</div>
          <div class="sim-bar clay" style="width:120px;margin-top:6px"><i style="width:${Math.max(2, Math.min(100, sim))}%"></i></div>
          <div class="tiny muted" style="margin-top:4px">相似度</div>
        </div>
      </div>
      <div class="row wrap" style="gap:8px;margin-top:13px">
        <button class="btn btn-neutral btn-sm ev-detail" data-id="${e.id}">${icon('eye', 13)} 详情</button>
        <button class="btn btn-ghost btn-sm ev-pkg" data-id="${e.id}">${icon('file-archive', 13)} 导出维权证据包</button>
        ${w ? `<button class="btn btn-soft btn-sm ev-work" data-work="${e.workId}">${icon('layers', 13)} 查看原作存证</button>` : ''}
      </div>
      <details class="fold" style="margin-top:14px">
        <summary>${icon('camera', 14)} 取证快照预览（带时间戳水印）<span class="chev">${icon('chevron-down', 16)}</span></summary>
        <div class="fold-body">
          <div style="overflow:auto;max-height:330px;border:1px solid var(--line);border-radius:8px">${w ? buildEvidenceShotHTML(e, w) : '<div class="empty muted">原作缺失，无法生成快照</div>'}</div>
          <div class="row wrap" style="gap:8px;margin-top:10px;font-size:11.5px;color:var(--muted)">
            <span class="hash-inline">报告哈希 ${shortHash(e.reportHash)}</span>
            <span class="hash-inline">IPFS ${shortHash(e.reportCid)}</span>
            <span class="hash-inline" data-copy="${esc(e.anchored.hash || '')}">交易 ${shortHash(e.anchored.hash, 10)}</span>
          </div>
        </div>
      </details>
    </div>`;
  }

  /* ---------------- 导出 ---------------- */
  async function exportFrom(evId, btn) {
    const ev = chain.evidence().find((e) => e.id === evId);
    if (!ev || btn.disabled) return;
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.innerHTML = icon('refresh', 14) + ' 打包中…';
    try {
      const ok = await exportEvidencePackage(ev);
      toastOk(ok ? '维权证据包 ZIP 已生成' : '已逐个下载证据文件（未检测到 JSZip）');
    } catch (err) {
      console.warn(err);
      toastErr('导出失败：' + (err && err.message ? err.message : '未知错误'));
    }
    btn.disabled = false;
    btn.innerHTML = old;
  }

  renderStats();
  renderList();
  return () => {};
}
