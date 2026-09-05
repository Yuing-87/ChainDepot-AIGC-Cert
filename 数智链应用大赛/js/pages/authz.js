/* ===================================================================
 * authz.js — 授权管理（creator / admin）
 * creator：我名下作品所授出的授权（登记 / 撤销，操作方为当前账户）
 * admin  ：全网授权总览 + 授权中作品；仅可撤销 grantor 为自己名下的授权
 * =================================================================== */
import * as chain from '../core/chain.js';
import { icon, toastOk, toastErr, modal, empty } from '../core/ui.js';
import { esc, fmtTs, fmtDate, shortAddr, fmtInt } from '../core/util.js';
import { bindRoot, openWorkModal } from './_shared.js';

/* ---------- 授权类型 ---------- */
const SCOPES = [
  ['commercial', '商用授权', '商业使用、销售与广告投放'],
  ['repost', '转载授权', '署名转载与公开传播'],
  ['remix', '改编授权', '二次创作与演绎'],
  ['all', '全权授权', '不限方式与范围'],
];

const cv = (id) => 'CV-' + String(id).padStart(6, '0');

export default async function page(el) {
  const root = document.createElement('div');
  root.className = 'page';
  el.appendChild(root);

  let cur = 'all'; // admin: all | works

  function render() {
    const me = chain.active();
    const isA = me.role === 'admin';
    const allAuths = chain.authzs();
    const activeAuths = allAuths.filter((a) => a.active);
    const tabs = isA
      ? `<div class="tabs">
          <button class="tab ${cur === 'all' ? 'active' : ''}" data-tab="all">${icon('key', 14)} 全网授权</button>
          <button class="tab ${cur === 'works' ? 'active' : ''}" data-tab="works">${icon('layers', 14)} 全网授权中作品</button>
        </div>`
      : '';
    const heroStat = isA
      ? `<div class="hero-band" style="margin-bottom:0">
          <div>
            <div class="hb-k">授权管理</div>
            <h2>${fmtInt(activeAuths.length)} 项有效授权</h2>
            <div class="hb-sub">全网授权总览：管理员可查看所有创作者授予的授权，仅能撤销由当前管理员账户名下发起的授权。</div>
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
              <span class="hb-chip">${icon('key', 12)} 共 ${fmtInt(allAuths.length)} 项授权</span>
              <span class="hb-chip" style="border-color:rgba(255,255,255,.35)">${icon('layers', 12)} ${fmtInt(new Set(allAuths.map((a) => a.workId)).size)} 件作品</span>
            </div>
          </div>
          <div class="hb-metrics">
            <div class="hb-m"><b>${fmtInt(activeAuths.length)}</b><span>有效授权</span></div>
            <div class="hb-m"><b>${fmtInt(allAuths.length - activeAuths.length)}</b><span>已撤销</span></div>
            <div class="hb-m"><b>${fmtInt(new Set(allAuths.map((a) => a.workId)).size)}</b><span>涉及作品</span></div>
          </div>
        </div>`
      : '';
    root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>授权管理</h2>
        <div class="page-sub">${isA
          ? '管理员可查看全网授权总览。'
          : '为你名下作品授予商用 / 转载 / 改编 / 全权授权，并随时查看有效期与撤销状态。'}</div>
      </div>
      <button class="btn btn-primary btn-sm" data-act="grant">${icon('plus', 14)} 登记授权</button>
    </div>
    <div class="stack-24" style="margin-top:0">
      ${heroStat}
      ${tabs}
      <div class="authz-body"></div>
    </div>`;
    renderBody();
  }

  function goTab(k) { cur = k; render(); }

  /* ============================ 数据与表格 ============================ */
  function myAuthzs() {
    const me = chain.active();
    const mine = new Set(chain.worksOf(me.addr).map((w) => w.id));
    return chain.authzs().filter((a) => mine.has(a.workId));
  }

  function thumbCell(w, a) {
    const noWork = `<div class="row" style="gap:10px">
      <span style="width:40px;height:40px;flex:0 0 40px;border-radius:7px;background:var(--panel);display:grid;place-items:center;color:var(--muted)">${icon('file-text', 16)}</span>
      <div style="min-width:0"><div class="td-main">作品记录不可见</div><div class="td-sub">CV-${String(a.workId).padStart(6, '0')}</div></div>
    </div>`;
    if (!w) return noWork;
    const media = w.kind === 'image'
      ? `<img src="${w.thumb}" style="width:40px;height:40px;flex:0 0 40px;object-fit:cover;border-radius:7px;border:1px solid var(--line-soft)">`
      : `<span style="width:40px;height:40px;flex:0 0 40px;border-radius:7px;display:grid;place-items:center;background:var(--sage-soft);color:var(--sage-deep)">${icon('align-left', 16)}</span>`;
    return `<div class="row" style="gap:10px">
      ${media}
      <div style="min-width:0">
        <div class="td-main ellip" style="max-width:220px">${esc(w.title)}</div>
        <div class="td-sub">${cv(w.id)}${w.versionNo > 1 ? ' · 第 ' + w.versionNo + ' 版' : ''}</div>
      </div>
    </div>`;
  }

  function expiryCell(a) {
    if (!a.expiresAt) return '<span class="badge badge-neutral">永久</span>';
    const expired = a.expiresAt < Date.now();
    const txt = '至 ' + fmtDate(a.expiresAt);
    return (a.active && expired)
      ? `<span class="small accent-clay b">${txt}</span> <span class="badge badge-amber">已过期</span>`
      : `<span class="small">${txt}</span>`;
  }

  function authzRow(a, withGrantor) {
    const me = chain.active();
    const w = chain.workById(a.workId);
    const canRevoke = a.active && a.grantor === me.addr;
    const grantorCol = withGrantor
      ? `<td><div class="td-main">${esc(a.grantorName || shortAddr(a.grantor))}</div>
          <div class="td-sub mono-sm">${esc(shortAddr(a.grantor, 8, 6))}</div></td>`
      : '';
    return `
    <tr>
      <td>${thumbCell(w, a)}</td>
      <td>
        <div class="td-main">${esc(a.granteeName || shortAddr(a.granteeAddr))}</div>
        ${a.granteeAddr
          ? `<div class="td-sub mono-sm">${esc(shortAddr(a.granteeAddr, 8, 6))}</div>`
          : '<div class="td-sub">线下主体 · 无链上地址</div>'}
      </td>
      ${grantorCol}
      <td><span class="badge badge-sage">${esc(chain.scopeLabel(a.scope))}</span></td>
      <td><span class="muted small">${fmtTs(a.grantedAt)}</span></td>
      <td>${expiryCell(a)}</td>
      <td>${a.active ? '<span class="badge badge-sage">有效</span>' : '<span class="badge badge-neutral">已撤销</span>'}</td>
      <td>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          ${canRevoke ? `<button class="btn btn-danger btn-sm" data-act="revoke" data-id="${a.id}">${icon('x', 13)} 撤销</button>` : ''}
          ${w ? `<button class="btn btn-neutral btn-sm" data-work="${w.id}">${icon('eye', 13)} 查看作品</button>` : '<span class="muted tiny">作品不可见</span>'}
        </div>
      </td>
    </tr>`;
  }

  function authzTable(list, withGrantor, emptyHTML) {
    if (!list.length) return emptyHTML;
    const headExtra = withGrantor ? '<th>授权人</th>' : '';
    return `
    <div class="card">
      <div class="table-wrap">
        <table class="tbl" style="min-width:${withGrantor ? 980 : 900}px">
          <thead><tr><th>作品</th><th>授权对象</th>${headExtra}<th>类型</th><th>授权时间</th><th>有效期</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>${list.map((a) => authzRow(a, withGrantor)).join('')}</tbody>
        </table>
      </div>
    </div>`;
  }

  /* ============================ creator 视图 ============================ */
  function mineView() {
    const me = chain.active();
    const list = myAuthzs();
    return `
    ${list.length
      ? authzTable(list, false, '')
      : `<div class="card">${empty('key', '暂无授权记录',
          '为名下作品登记授权后，可在此管理授权对象、类型、有效期并随时撤销。',
          me.role === 'creator' ? '<button class="btn btn-neutral btn-sm" data-go="register">去登记存证</button>' : '')}</div>`}`;
  }

  /* ============================ admin 视图 ============================ */
  function allView() {
    const list = chain.authzs();
    return `
    ${list.length
      ? authzTable(list, true, '')
      : `<div class="card">${empty('key', '全网暂无授权记录', '创作者在授权管理页登记授权后将在此汇总展示。')}</div>`}`;
  }

  function worksView() {
    const activeOn = new Set(chain.authzs().filter((a) => a.active).map((a) => a.workId));
    const ws = chain.works().filter((w) => activeOn.has(w.id));
    if (!ws.length) {
      return `<div class="card">${empty('layers', '暂无授权中作品', '全网当前没有处于有效授权状态的作品。')}</div>`;
    }
    return `
    <div class="card">
      <div class="card-title"><h3>${icon('layers', 15)} 全网授权中作品</h3><span class="chip">共 ${ws.length} 件</span></div>
      <div class="stack" style="gap:0">
        ${ws.map((w) => {
          const grants = chain.authzs().filter((a) => a.workId === w.id && a.active);
          const media = w.kind === 'image'
            ? `<img src="${w.thumb}" style="width:52px;height:52px;flex:0 0 52px;object-fit:cover;border-radius:8px;border:1px solid var(--line-soft)">`
            : `<span style="width:52px;height:52px;flex:0 0 52px;border-radius:8px;display:grid;place-items:center;background:var(--sage-soft);color:var(--sage-deep)">${icon('align-left', 18)}</span>`;
          return `
          <div class="list-row" style="cursor:pointer" data-work="${w.id}">
            ${media}
            <div class="grow" style="min-width:0">
              <div class="small b ellip">${esc(w.title)} <span class="mono-sm muted">${cv(w.id)}</span>${w.versionNo > 1 ? ' <span class="badge badge-neutral">第 ' + w.versionNo + ' 版</span>' : ''}</div>
              <div class="muted tiny" style="margin-top:1px">作者 ${esc(w.authorsName || shortAddr(w.author))}</div>
              <div class="row wrap" style="gap:6px;margin-top:6px">
                <span class="badge badge-sage">${grants.length} 项有效授权</span>
                ${grants.slice(0, 3).map((g) => `<span class="chip">${esc(g.granteeName || shortAddr(g.granteeAddr))} · ${esc(chain.scopeLabel(g.scope))}</span>`).join('')}
                ${grants.length > 3 ? `<span class="muted tiny">等 ${grants.length} 项</span>` : ''}
              </div>
            </div>
            <button class="btn btn-neutral btn-sm" data-work="${w.id}">${icon('eye', 13)} 查看作品</button>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  function renderBody() {
    const body = root.querySelector('.authz-body');
    const isA = chain.active().role === 'admin';
    if (isA) body.innerHTML = cur === 'works' ? worksView() : allView();
    else body.innerHTML = mineView();
  }

  /* ============================ 登记授权 Modal ============================ */
  function openGrant() {
    const me = chain.active();
    const myW = chain.worksOf(me.addr);
    if (!myW.length) {
      toastErr('当前账户名下暂无已存证作品，请先登记存证后再授予授权');
      return;
    }
    const others = chain.accounts().filter((a) => a.addr !== me.addr);
    const hasOthers = others.length > 0;

    const m = modal({
      title: '登记授权',
      body: `<div class="stack">
        <div class="field"><span class="field-label">授权作品 <span class="req">*</span></span>
          <select class="select" id="gzWork">${myW.map((w) => `<option value="${w.id}">${cv(w.id)} · ${esc(w.title)}${w.versionNo > 1 ? '（第 ' + w.versionNo + ' 版）' : ''}</option>`).join('')}</select>
        </div>
        <div class="field"><span class="field-label">授权对象 <span class="req">*</span></span>
          <div class="row wrap" style="gap:4px 14px;margin-bottom:8px">
            <label class="check-item" ${hasOthers ? '' : 'style="opacity:.55"'}>
              <input type="radio" name="gzMode" value="acc" ${hasOthers ? 'checked' : 'disabled'}> 从现有账户选择</label>
            <label class="check-item">
              <input type="radio" name="gzMode" value="man" ${hasOthers ? '' : 'checked'}> 手动填写名称 / 地址</label>
          </div>
          <div id="gzAccBox" ${hasOthers ? '' : 'style="display:none"'}>
            ${hasOthers
              ? `<select class="select" id="gzAcc">${others.map((a) => `<option value="${esc(a.addr)}">${esc(a.name)}（${shortAddr(a.addr)}）</option>`).join('')}</select>`
              : `<input class="input" value="" disabled placeholder="暂无其他链上账户，请使用手动填写">`}
            <div class="field-hint">选择链上既有账户作为被授权对象。</div>
          </div>
          <div id="gzManBox" class="stack" ${hasOthers ? 'style="display:none"' : ''}>
            <input class="input" id="gzName" maxlength="30" placeholder="授权对象名称（必填或填地址）">
            <input class="input mono" id="gzAddr" placeholder="链上地址 0x…（可选；支持线下实名主体）" spellcheck="false">
          </div>
        </div>
        <div class="field"><span class="field-label">授权类型 <span class="req">*</span></span>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${SCOPES.map(([v, l, d], i) => `
              <label class="check-item" style="align-items:flex-start;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--card)">
                <input type="radio" name="gzScope" value="${v}" ${i === 0 ? 'checked' : ''}>
                <span style="line-height:1.45"><b class="small">${l}</b><br><i class="tiny muted" style="font-style:normal">${d}</i></span>
              </label>`).join('')}
          </div>
        </div>
        <div class="field"><span class="field-label">有效期</span>
          <div class="row wrap" style="gap:8px">
            <select class="select" id="gzYears" style="width:auto;min-width:130px">
              <option value="0">永久</option>
              <option value="1">1 年</option>
              <option value="2">2 年</option>
              <option value="custom">自定义年数</option>
            </select>
            <input class="input" id="gzCustom" type="number" min="1" max="99" step="1" value="3" style="width:104px;display:none" title="自定义年数">
          </div>
          <div class="field-hint">授权到期后自动失效；永久授权需手动撤销。</div>
        </div>
      </div>`,
      foot: '<button class="btn btn-neutral btn-sm" data-c="c">取消</button><button class="btn btn-primary btn-sm" data-c="ok">提交授权</button>',
      onMount: (box) => {
        const accBox = box.querySelector('#gzAccBox');
        const manBox = box.querySelector('#gzManBox');
        const syncMode = () => {
          const v = box.querySelector('input[name="gzMode"]:checked').value;
          accBox.style.display = v === 'acc' ? '' : 'none';
          manBox.style.display = v === 'man' ? '' : 'none';
        };
        box.querySelectorAll('input[name="gzMode"]').forEach((r) => r.addEventListener('change', syncMode));
        const ys = box.querySelector('#gzYears');
        const cus = box.querySelector('#gzCustom');
        ys.addEventListener('change', () => { cus.style.display = ys.value === 'custom' ? '' : 'none'; });
      },
    });

    m.footBox.querySelector('[data-c=c]').onclick = m.close;
    m.footBox.querySelector('[data-c=ok]').onclick = async () => {
      const box = m.box;
      const okBtn = m.footBox.querySelector('[data-c=ok]');
      const workId = Number(box.querySelector('#gzWork').value);
      const scope = (box.querySelector('input[name="gzScope"]:checked') || {}).value || 'commercial';

      const mode = box.querySelector('input[name="gzMode"]:checked').value;
      let granteeName = '';
      let granteeAddr = '';
      if (mode === 'acc') {
        const sel = box.querySelector('#gzAcc');
        if (!sel || !sel.selectedOptions[0]) { toastErr('请选择授权对象账户'); return; }
        const opt = sel.selectedOptions[0];
        granteeName = opt.textContent.split('（')[0].trim();
        granteeAddr = opt.value;
      } else {
        granteeName = (box.querySelector('#gzName').value || '').trim();
        granteeAddr = (box.querySelector('#gzAddr').value || '').trim();
        if (!granteeName && !granteeAddr) { toastErr('请填写授权对象名称或链上地址'); return; }
        if (!granteeName) granteeName = shortAddr(granteeAddr);
        if (granteeAddr && !/^0x[0-9a-fA-F]{40}$/.test(granteeAddr)) { toastErr('链上地址格式不正确（应为 0x + 40 位十六进制）'); return; }
      }

      const yv = box.querySelector('#gzYears').value;
      let years = 0;
      if (yv === 'custom') {
        years = Math.floor(Number(box.querySelector('#gzCustom').value));
        if (!(years >= 1)) { toastErr('请填写有效的自定义年数（1-99）'); return; }
      } else {
        years = Number(yv) || 0;
      }

      okBtn.disabled = true;
      const old = okBtn.innerHTML;
      okBtn.innerHTML = icon('circle-dot', 14) + ' 登记中…';
      try {
        await chain.grantAuthz({ workId, granteeName, granteeAddr, scope, years });
        toastOk('授权已登记并上链');
        m.close();
        renderBody();
      } catch (e) {
        toastErr((e && e.message) ? e.message : '授权登记失败，请重试');
        okBtn.disabled = false;
        okBtn.innerHTML = old;
      }
    };
  }

  /* ============================ 撤销授权 ============================ */
  async function actRevoke(btn) {
    const id = Number(btn.getAttribute('data-id'));
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.innerHTML = icon('circle-dot', 13) + ' 撤销中…';
    try {
      await chain.revokeAuthz(id);
      toastOk('授权已撤销，撤销操作已上链');
      renderBody();
    } catch (e) {
      toastErr((e && e.message) ? e.message : '撤销失败，请重试');
      btn.disabled = false;
      btn.innerHTML = old;
    }
  }

  /* ============================ 事件委托 ============================ */
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-copy]') || e.target.closest('[data-go]')) return;
    const tb = e.target.closest('[data-tab]');
    if (tb) { e.preventDefault(); goTab(tb.getAttribute('data-tab')); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.getAttribute('data-act');
      if (a === 'grant') { openGrant(); return; }
      if (a === 'revoke') { actRevoke(act); return; }
    }
    const wb = e.target.closest('[data-work]');
    if (wb) openWorkModal(Number(wb.getAttribute('data-work')));
  });

  render();
  bindRoot(el);

  return () => {};
}
