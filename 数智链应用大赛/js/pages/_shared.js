/* ===================================================================
 * _shared.js — 页面共享小件与详情弹窗
 * 约定：页面通过 bindRoot(root) 启用 data-copy / data-go 委托行为。
 * =================================================================== */
import { esc, fmtTs, timeAgo, shortAddr, shortHash, copyText, fmtInt, txGas } from '../core/util.js';
import { icon, modal, toast, toastOk, confirmDialog } from '../core/ui.js';
import * as chain from '../core/chain.js';
import { buildCertificateHTML, buildEvidenceShotHTML, downloadCertificate, exportEvidencePackage, snapNode, hasJspdf, hasJszip } from '../core/cert.js';

/* ---------- 轻量跨页跳转（携带参数） ---------- */
const paramsStore = {};
export const go = (route, params = {}) => {
  paramsStore[route] = { ...params };
  location.hash = '#/' + route;
};
export const takeParams = (route) => {
  const p = paramsStore[route];
  delete paramsStore[route];
  return p || null;
};

/* ---------- 委托交互 ---------- */
export function bindRoot(root) {
  if (!root || root.__bound) return;
  root.__bound = true;
  root.addEventListener('click', (e) => {
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const v = cp.getAttribute('data-copy');
      e.preventDefault();
      copyText(v).then((ok) => (ok ? toast('已复制到剪贴板', 'ok') : toast('复制失败', 'err')));
      return;
    }
    const g = e.target.closest('[data-go]');
    if (g) {
      e.preventDefault();
      let p = {};
      try { p = JSON.parse(g.getAttribute('data-params') || '{}'); } catch {}
      go(g.getAttribute('data-go'), p);
    }
  });
}

/* ---------- 常用渲染 ---------- */
export function roleChip(role) {
  const labels = { admin: '管理员', creator: '创作者', monitor: '监测机构', user: '普通用户' };
  return `<span class="role-chip role-${role}">${labels[role] || role}</span>`;
}
export const roleShort = (r) => ({ admin: '管理员', creator: '创作者', monitor: '监测机构', user: '普通用户' })[r] || r;

export function avatarHTML(name, addr, size = 30) {
  const tone = chain.accounts().find((a) => a.addr === addr)?.tone || 'sage';
  const initial = (name || '匿')[0];
  return `<span class="avatar ${tone}" style="width:${size}px;height:${size}px;flex:0 0 ${size}px;font-size:${Math.round(size * 0.4)}px">${esc(initial)}</span>`;
}

export function kindBadge(kind) {
  return kind === 'image'
    ? '<span class="badge badge-neutral">' + icon('image', 11) + ' 图片</span>'
    : '<span class="badge badge-neutral">' + icon('align-left', 11) + ' 文本</span>';
}

export function mediaBlock(work, { ratio = '4/3', maxText = 110 } = {}) {
  if (work.kind === 'image') {
    return `<img src="${work.thumb}" alt="${esc(work.title)}" style="width:100%;aspect-ratio:${ratio};object-fit:cover;border-radius:8px;border:1px solid var(--line-soft)">`;
  }
  return `<div style="width:100%;aspect-ratio:${ratio};background:linear-gradient(160deg,#F1F0EA,#E3E9E2);border:1px solid var(--line-soft);border-radius:8px;padding:12px 14px;overflow:hidden;font-size:12px;line-height:1.9;color:#4C4A45;position:relative">
    <div style="font-family:var(--serif);font-size:9px;letter-spacing:.3em;color:#9A938A;text-transform:uppercase;margin-bottom:4px">TEXT · AIGC</div>
    ${esc((work.text || '').slice(0, maxText))}${(work.text || '').length > maxText ? '…' : ''}
    <span class="role-chip role-creator" style="position:absolute;right:10px;bottom:8px">文 · ${esc(work.title.slice(0, 10))}</span>
  </div>`;
}

export function hashRow(label, value, copyable = true) {
  const copy = copyable ? `<button class="icon-btn" data-copy="${esc(value)}" title="复制">${icon('copy', 14)}</button>` : '';
  return `
  <div class="field">
    <span class="field-label">${esc(label)}</span>
    <div class="hashrow"><code>${esc(value)}</code>${copy}</div>
  </div>`;
}

export function versionTag(v) { return `<span class="badge badge-sage" style="font-family:var(--mono)">v${v.versionNo}</span>`; }

/* ---------- 作品详情弹窗 ---------- */
export function openWorkModal(workId, opts = {}) {
  const w = chain.workById(workId);
  if (!w) return;
  const me = chain.active();
  const isMine = w.author === me.addr;
  const versions = chain.versionsOfRoot(w.rootId);
  const authzOf = chain.authzs().filter((a) => a.workId === w.id && a.active);
  const evRelated = chain.evidence().filter((e) => e.workId === w.id);
  const canVersion = isMine && opts.allowVersion && !w.parentId;
  const workGasUsed = (w.anchored && w.anchored.gas) ? w.anchored.gas.gasUsed
    : txGas({ type: w.parentId ? 'version' : 'register', hash: w.anchored.hash }).gasUsed;

  const body = document.createElement('div');
  body.innerHTML = `
  <div class="stack">
    <div class="row" style="gap:14px;align-items:flex-start">
      <div style="flex:0 0 128px">${mediaBlock(w, { ratio: '1/1' })}</div>
      <div class="grow">
        <div class="row wrap" style="gap:8px">${kindBadge(w.kind)} ${versionTag(w)} ${w.parentId ? '<span class="badge badge-neutral">第 ' + w.versionNo + ' 版</span>' : '<span class="badge badge-sage">首版</span>'}</div>
        <div class="serif" style="font-size:18px;font-weight:600;margin-top:6px">${esc(w.title)}</div>
        <div class="muted tiny" style="margin-top:3px">存证编号 CV-${String(w.id).padStart(6, '0')} · 作者 ${esc(w.authorsName || shortAddr(w.author))}</div>
        <div class="row wrap" style="margin-top:8px;gap:6px">
          <span class="chip">${icon('zap', 12)} ${esc(w.model)}</span>
          <span class="chip" title="该笔存证交易的 Gas 消耗与矿工费">${icon('activity', 12)} Gas ${fmtInt(workGasUsed)}</span>
          ${evRelated.length ? `<span class="chip" style="color:var(--clay)">${icon('alert-triangle', 12)} 相关侵权证据 ${evRelated.length}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="divider" style="margin:2px 0"></div>
    <div class="kv-grid">
      <div class="kv-item"><dt>AIGC 生成时间</dt><dd>${fmtTs(w.genTime)}</dd></div>
      <div class="kv-item"><dt>上链确认时间</dt><dd>${fmtTs(w.anchored.ts)} · <span class="muted">${timeAgo(w.anchored.ts)}</span></dd></div>
      <div class="kv-item"><dt>区块高度 / 网络</dt><dd>#${w.anchored.block} <span class="muted">(${w.anchored.mode === 'real' ? '真实链' : '模拟链'})</span></dd></div>
    </div>
    <div class="field"><span class="field-label">创作提示词 Prompt</span><div class="sub small">${esc(w.prompt || '未填写')}</div></div>
    ${w.prompt ? '' : ''}
    <div class="stack" style="gap:10px">
      ${hashRow('SHA-256 精确指纹', w.sha256)}
      ${hashRow(w.kind === 'image' ? '感知指纹 · pHash' : '感知指纹 · SimHash', w.kind === 'image' ? w.fp.phash : w.fp.simhash)}
      ${hashRow('上链交易哈希 Transaction Hash', w.anchored.hash || '—')}
      ${hashRow('原文 IPFS CID', w.cid)}
    </div>
    ${versions.length > 1 ? `
      <div>
        <div class="sec-kicker">版本链 Version Chain</div>
        <div class="vline">
          ${versions.map((v) => `
            <div class="vline-item ${v.versionNo === 1 ? 'root' : ''}">
              <div class="vl-t">${versionTag(v)} ${esc(v.title)} ${v.id === w.id ? '<span class="badge badge-neutral">当前查看</span>' : ''}</div>
              <div class="vl-s">${fmtTs(v.anchored.ts)} · tx ${shortHash(v.anchored.hash)} ${v.parentId ? '<span data-go="works" data-params=\'{"focus":' + v.id + '}\' class="link-btn">查看<i style="width:12px;height:12px">' + icon('arrow-up-right', 12) + '</i></span>' : ''}</div>
            </div>`).join('')}
        </div>
      </div>` : ''}
    ${authzOf.length ? `
      <div>
        <div class="sec-kicker">已授予的授权</div>
        ${authzOf.map((a) => `<div class="row-between" style="padding:6px 0;border-bottom:1px solid var(--line-soft)">
          <span class="small">${esc(a.granteeName)}</span>
          <span class="row" style="gap:8px"><span class="badge badge-sage">${chain.scopeLabel(a.scope)}</span><span class="muted tiny">${a.expiresAt ? '至 ' + fmtTs(a.expiresAt) : '永久'}</span></span></div>`).join('')}
      </div>` : ''}
  </div>`;

  const actions = [];
  actions.push({ html: `<button class="btn btn-primary btn-sm act-cert">${icon('download', 14)} 下载存证证书 PDF</button>` });
  if (canVersion && !w.parentId) {
    actions.push({ html: `<button class="btn btn-ghost btn-sm act-version">${icon('plus', 14)} 登记新版本</button>` });
  }
  actions.push({ html: `<button class="btn btn-neutral btn-sm act-close">关闭</button>` });
  const foot = actions.map((a) => a.html).join('');

  const m = modal({
    title: `作品详情 · CV-${String(w.id).padStart(6, '0')}`, size: 'lg', body,
    foot, onMount: (box, close) => {
      box.querySelector('.act-close').onclick = close;
      const certBtn = box.querySelector('.act-cert');
      if (certBtn) certBtn.onclick = async () => {
        certBtn.disabled = true;
        try {
          const res = await downloadCertificate(w, { to: hasJspdf() ? 'pdf' : 'png' });
          toastOk(res.pdf ? '证书 PDF 已生成' : '证书 PNG 已生成（未检测到 jsPDF）');
        } catch (e) { toast('证书生成失败', 'err'); } finally { certBtn.disabled = false; }
      };
      const vBtn = box.querySelector('.act-version');
      if (vBtn) vBtn.onclick = () => { close(); go('register', { versionOf: w.id }); };
    },
  });
  bindRoot(body);
  return m;
}

/* ---------- 证据详情弹窗 ---------- */
export function openEvidenceModal(evId, opts = {}) {
  const ev = chain.evidence().find((e) => e.id === evId);
  if (!ev) return;
  const w = chain.workById(ev.workId);
  const me = chain.active();
  const isReporterOrAdmin = me.role === 'admin' || me.role === 'monitor' || ev.reporter === me.addr;
  const evGasUsed = (ev.anchored && ev.anchored.gas) ? ev.anchored.gas.gasUsed
    : txGas({ type: 'evidence', hash: ev.anchored.hash }).gasUsed;

  const body = document.createElement('div');
  body.innerHTML = `
  <div class="stack">
    <div class="row-between">
      <div>
        <div class="kicker">证据固定 #EV-${String(ev.id).padStart(5, '0')}</div>
        <div class="serif" style="font-size:18px;font-weight:600;margin-top:3px">${esc(ev.query.title || '侵权证据')}</div>
      </div>
      <div style="text-align:right">
        <div class="sim-num" style="color:var(--clay)">${ev.sim.toFixed(1)}%</div>
        <div class="tiny muted">判定相似度</div>
      </div>
    </div>
    <div class="row wrap" style="gap:8px">
      <span class="chip">被侵权作品 <b class="accent-sage">${w ? esc(w.title) : '—'}</b> · CV-${String(ev.workId).padStart(6, '0')}</span>
      <span class="chip">取证方 ${esc(ev.reporterName || shortAddr(ev.reporter))}</span>
      <span class="chip" title="该笔证据固定交易的 Gas 消耗与矿工费">${icon('activity', 12)} Gas ${fmtInt(evGasUsed)}</span>
      <span class="chip">${fmtTs(ev.anchored.ts)}</span>
    </div>
    <div class="row-between" style="padding:10px 14px;background:var(--clay-soft);border-radius:9px">
      <span class="small" style="color:#7d4431"><b>核验：</b>在链上核对下方哈希即可验证证据未经篡改。</span>
      <span class="hash-inline">区块 #${ev.anchored.block}</span>
    </div>
    <div class="stack" style="gap:10px">
      ${hashRow('证据固定交易哈希', ev.anchored.hash || '—')}
      ${hashRow('检测报告 SHA-256', ev.reportHash)}
      ${hashRow('报告 IPFS CID', ev.reportCid || '—')}
    </div>
    <div>
      <div class="sec-kicker">取证快照预览（带时间戳水印）</div>
      <div style="max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:8px">${buildEvidenceShotHTML(ev, w)}</div>
    </div>
  </div>`;

  const acts = [];
  if (isReporterOrAdmin) {
    acts.push({ html: `<button class="btn btn-primary btn-sm act-pkg">${icon('file-archive', 14)} 导出维权证据包</button>` });
  }
  if (w) acts.push({ html: `<button class="btn btn-ghost btn-sm act-work">查看原作存证</button>` });
  acts.push({ html: `<button class="btn btn-neutral btn-sm act-close">关闭</button>` });
  const foot = acts.map((a) => a.html).join('');

  const m = modal({
    title: `侵权证据详情 · EV-${String(ev.id).padStart(5, '0')}`, size: 'lg', body, foot,
    onMount: (box, close) => {
      box.querySelector('.act-close').onclick = close;
      const wb = box.querySelector('.act-work');
      if (wb) wb.onclick = () => { close(); openWorkModal(ev.workId, { allowVersion: true }); };
      const pkg = box.querySelector('.act-pkg');
      if (pkg) pkg.onclick = async () => {
        pkg.disabled = true; pkg.innerHTML = icon('refresh', 14) + ' 打包中…';
        try {
          const ok = await exportEvidencePackage(ev);
          toastOk(ok ? '维权证据包 ZIP 已生成' : '已逐个下载证据文件（JSZip 不可用）');
        } catch (e) { console.warn(e); toast('打包失败：' + e.message, 'err'); }
        pkg.disabled = false; pkg.innerHTML = icon('file-archive', 14) + ' 导出维权证据包';
      };
    },
  });
  bindRoot(body);
  return m;
}

/* ---------- 身份 / 权限辅助 ---------- */
export function canAct(roles) { return roles.includes(chain.active().role); }
export function guardAct(roles, tip) {
  if (canAct(roles)) return true;
  toast(tip || '当前身份无权执行该操作（RBAC 操作级守卫），请切换身份后重试。', 'err', '权限拒绝');
  return false;
}

export { icon, toast, toastOk, confirmDialog, shortAddr, shortHash, fmtTs, timeAgo };
