/* ===================================================================
 * account.js — 个人中心（角色身份 / 昵称 / 我的数据 / 最近动态）
 * =================================================================== */
import * as chain from '../core/chain.js';
import { icon, toastOk, toastErr, modal } from '../core/ui.js';
import { esc, fmtTs, timeAgo, shortAddr, copyText, K, ls } from '../core/util.js';
import { bindRoot, roleChip, roleShort, avatarHTML, kindBadge, go, mediaBlock } from './_shared.js';

export default async function page(el) {
  const a = chain.active();
  const myAddr = a.addr;
  const role = a.role;

  const myWorks = chain.worksOf(myAddr);
  const myAuthz = chain.authzs().filter((x) => x.grantor === myAddr);
  const myEv = chain.evidence().filter((e) => e.reporter === myAddr || myWorks.some((w) => w.id === e.workId));
  const myDet = chain.detections().filter((d) => d.by === myAddr);
  const myTxs = chain.txs().filter((t) => t.from.toLowerCase() === myAddr.toLowerCase());
  const g = chain.statsGlobal();

  const roleBlock = {
    admin: { t: '以运营者身份查看全网确权、监测与链上运行状态。', p: '你在系统中拥有全部功能与链管理权限。' },
    creator: { t: '上传 AI 生成作品 → 本地指纹 → 上链确权，一站式守护原创。', p: '当前角色具备存证登记、侵权检测与授权管理能力。' },
    monitor: { t: '对全网公开存证开展侵权监测，一键固定证据并出具维权证据包。', p: '当前角色聚焦监测与证据固定职能。' },
    user: { t: '只读身份：浏览公开确权指标，随时上传文件核验存证真伪。', p: '如需存证或监测，请在右上角切换演示身份。' },
  }[role];

  const statsCards = [
    { n: myWorks.length, l: '我的存证', ic: 'layers' },
    { n: myAuthz.length, l: '我授予的授权', ic: 'key' },
    { n: myDet.length, l: '我的检测', ic: 'scan' },
    { n: myEv.length, l: '涉我证据', ic: 'shield-alert' },
  ];

  el.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h2>个人中心</h2><div class="page-sub">钱包地址即账户；身份与角色共同决定你能看到与操作的内容。</div></div>
      <button class="btn btn-neutral btn-sm" id="editName">${icon('feather-pen', 14)} 编辑昵称</button>
    </div>

    <div class="grid grid-3" style="grid-template-columns: 340px 1fr;align-items:start">
      <div class="stack">
        <div class="card" style="padding:22px">
          <div class="row" style="gap:14px">
            ${avatarHTML(a.name, myAddr, 54)}
            <div class="grow" style="min-width:0">
              <div style="font-family:var(--serif);font-size:19px;font-weight:600">${esc(a.name)}</div>
              <div style="margin-top:3px">${roleChip(role)}</div>
            </div>
          </div>
          <div class="divider"></div>
          <div class="field"><span class="field-label">钱包地址</span>
            <div class="hashrow"><code>${myAddr}</code>
              <button class="icon-btn" data-copy="${myAddr}">${icon('copy', 14)}</button>
              <a class="icon-btn" title="外部链浏览器" data-go="chain" style="display:none">${icon('external-link', 14)}</a>
            </div>
          </div>
          <div class="field" style="margin-top:12px"><span class="field-label">角色身份</span>
            <div class="small sub">${roleBlock.t}</div></div>
          <div class="note paper" style="margin-top:12px">${icon('info', 15)}<div>${roleBlock.p}</div></div>
          <div class="row" style="margin-top:14px;gap:8px">
            <button class="btn btn-soft btn-sm" id="switchDemo" style="flex:1">${icon('users', 14)} 切换演示身份</button>
            <button class="btn btn-neutral btn-sm" data-go="works">我的存证</button>
          </div>
        </div>

        <div class="card">
          <div class="card-title"><h3>${icon('grid', 15)} 角色差异速览</h3></div>
          ${[['creator', '创作者', '存证登记 + 授权管理'], ['monitor', '监测机构', '侵权检测 + 证据固定'], ['user', '普通用户', '公开指标 + 存证验证'], ['admin', '管理员', '全部功能 + 链管理']].map(([r, l, d]) => `
            <div class="row-between ${r === role ? '' : ''}" style="padding:7px 0;border-bottom:1px solid var(--line-soft)">
              <span class="row" style="gap:8px">${roleChip(r)}<span class="muted small">${d}</span></span>
              ${r === role ? '<span class="badge badge-sage">当前身份</span>' : ''}
            </div>`).join('')}
        </div>
      </div>

      <div class="stack-24">
        <div class="grid grid-4" style="grid-template-columns:repeat(4,1fr)">
          ${statsCards.map((s) => `<div class="stat"><div class="stat-icon">${icon(s.ic, 17)}</div><div class="stat-num">${s.n}</div><div class="stat-label">${s.l}</div></div>`).join('')}
        </div>

        <div class="card">
          <div class="card-title"><h3>${icon('activity', 15)} 我的最近链上动态</h3><span class="chip">共 ${myTxs.length} 笔</span></div>
          ${myTxs.length === 0 ? `<div class="empty">${icon('history', 30)}<b>暂无链上动态</b><span>完成存证 / 授权 / 固定证据后将在此展示</span></div>` : `
          <div class="mini-tx">
            ${myTxs.slice(0, 8).map((t) => `
              <div class="mini-tx-item">
                <span class="mtx-ic ${t.type === 'evidence' ? 'clay' : ''}">${icon(txIcon(t.type), 15)}</span>
                <span class="mtx-main">
                  <span class="mtx-t">${esc(t.label)}</span>
                  <span class="mtx-s"><span>区块 #${t.block}</span><span>${timeAgo(t.ts)}</span><span class="hash-inline">${shortAddr(t.hash, 8, 4)}</span></span>
                </span>
                <span class="badge badge-neutral">${esc(t.type)}</span>
              </div>`).join('')}
          </div>`}
        </div>

        <div class="grid grid-2">
          <div class="card">
            <div class="card-title"><h3>${icon('shield', 15)} 我公开的存证</h3>
              ${role === 'user' ? '<span class="badge badge-neutral">只读</span>' : `<button class="link-btn" data-go="register">${icon('plus', 13)} 新存证</button>`}</div>
            ${myWorks.length === 0 ? `<div class="empty">${icon('layers', 30)}<b>暂无存证</b><span>当前身份尚无上链作品</span></div>` : `
            <div class="stack" style="gap:2px">${myWorks.slice(0, 4).map((w) => `
              <div class="list-row" style="cursor:pointer" data-work="${w.id}">
                <div style="flex:0 0 44px">${w.kind === 'image' ? `<img src="${w.thumb}" style="width:44px;height:44px;object-fit:cover;border-radius:6px">` : `<span class="txt-ico" style="width:44px;height:44px;border-radius:6px;display:grid;place-items:center;background:var(--sage-soft);color:var(--sage-deep)">${icon('align-left', 16)}</span>`}</div>
                <span class="grow" style="min-width:0"><b class="small" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(w.title)}</b>
                <span class="muted tiny">CV-${String(w.id).padStart(6, '0')} · ${timeAgo(w.anchored.ts)}</span></span>
                <span class="badge badge-neutral">${w.versionNo > 1 ? 'v' + w.versionNo : '首版'}</span>
              </div>`).join('')}</div>`}
          </div>
          <div class="card">
            <div class="card-title"><h3>${icon('award', 15)} 身份与公开信息</h3></div>
            <div class="kv" style="grid-template-columns:104px 1fr">
              <dt>账户名称</dt><dd>${esc(a.name)}</dd>
              <dt>角色身份</dt><dd>${roleShort(role)}</dd>
              <dt>钱包地址</dt><dd class="mono" style="font-size:11px">${myAddr}</dd>
              <dt>链上模式</dt><dd>${chain.modeNow() === 'mock' ? '模拟链（本地演示）' : '真实链（MetaMask）'}</dd>
              <dt>公开存证数</dt><dd>${myWorks.length} 件作品已上链</dd>
              <dt>全网存证总量</dt><dd>${g.works} 件（全网公开）</dd>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  bindRoot(el);
  const { openWorkModal, confirmDialog } = await import('./_shared.js').then((m) => m);
  el.querySelectorAll('[data-work]').forEach((n) => {
    n.addEventListener('click', () => openWorkModal(Number(n.getAttribute('data-work')), { allowVersion: role !== 'user' }));
  });

  el.querySelector('#editName').addEventListener('click', () => {
    const m = modal({ title: '编辑昵称', size: 'sm',
      body: `<div class="field"><span class="field-label">账户昵称</span><input class="input" id="nm" maxlength="16" value="${esc(a.name)}"></div>`,
      foot: '<button class="btn btn-neutral btn-sm" data-c="c">取消</button><button class="btn btn-primary btn-sm" data-c="ok">保存</button>' });
    m.footBox.querySelector('[data-c=c]').onclick = m.close;
    m.footBox.querySelector('[data-c=ok]').onclick = () => {
      const v = m.box.querySelector('#nm').value.trim();
      if (!v) { toastErr('昵称不能为空'); return; }
      chain.renameAccount(myAddr, v);
      m.close(); toastOk('昵称已更新');
      page(el);
    };
  });

  el.querySelector('#switchDemo').addEventListener('click', () => {
    // 打开右上角身份切换器
    const btn = document.querySelector('.identity-btn');
    if (btn) btn.click();
  });

  return () => {};
}

function txIcon(type) {
  return ({ register: 'shield-check', version: 'layers', authz: 'key', revoke: 'x', evidence: 'shield-alert', account: 'user' })[type] || 'circle-dot';
}
