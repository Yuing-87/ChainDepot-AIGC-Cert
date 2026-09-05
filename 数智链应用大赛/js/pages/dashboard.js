/* ===================================================================
 * dashboard.js — 数据看板（按 RBAC 角色差异化渲染）
 * 顶部 hero 色带 + 指标；主体 2fr/1fr：趋势统计 | 列表与角色附加卡。
 * =================================================================== */
import * as chain from '../core/chain.js';
import { icon, empty } from '../core/ui.js';
import { esc, fmtInt, timeAgo, shortAddr } from '../core/util.js';
import { svgBarChart, svgRing } from '../core/charts.js';
import { bindRoot, openWorkModal, openEvidenceModal } from './_shared.js';

export default async function page(el) {
  const a = chain.active();
  const role = a.role;
  const me = a.addr;

  const g = chain.statsGlobal();
  const dets = chain.detections();
  const hitCount = dets.filter((d) => d.hit).length;
  const fmtHit = g.hitRate + '%';

  const myWorks = chain.worksOf(me);
  const myIds = new Set(myWorks.map((w) => w.id));
  const myAuthz = chain.authzs().filter((x) => x.grantor === me);
  const myAuthzActive = myAuthz.filter((x) => x.active).length;
  const myEv = chain.evidence().filter((e) => e.reporter === me || myIds.has(e.workId));
  const myDet = dets.filter((d) => d.by === me);

  const latestTxs = chain.txs().slice(0, 6);
  const latestWorks = chain.works().slice(0, 5);

  /* ---------------- 角色差异化配置 ---------------- */
  let hero = {};
  let stats = [];
  let extra = '';
  let chip = '';

  if (role === 'admin') {
    hero = {
      kicker: 'CHAINVAULT · 运营总览',
      title: '全网确权运营视图',
      sub: '从链上全貌把握全网存证、侵权证据、授权记录与检测命中情况，并实时掌握区块与合约运行状态。',
      cta: '区块链管理', go: 'chain', goIc: 'hexagon',
      metrics: [
        { v: fmtInt(g.works), l: '全网存证' },
        { v: fmtInt(g.evidence), l: '侵权证据' },
        { v: fmtInt(g.authzs), l: '授权记录' },
        { v: fmtHit, l: '检测命中率' },
      ],
    };
    stats = [
      { n: fmtInt(g.works), l: '全网存证', ic: 'layers', sub: '含全部迭代版本' },
      { n: fmtInt(g.evidence), l: '侵权证据', ic: 'shield-alert', clay: true, sub: '已固定并上链' },
      { n: fmtInt(g.authzs), l: '授权记录', ic: 'key', sub: '当前有效授权' },
      { n: fmtHit, l: '检测命中率', ic: 'activity', sub: '命中 ' + fmtInt(hitCount) + ' / ' + fmtInt(g.detections) + ' 次' },
    ];
    extra = adminExtra();
  } else if (role === 'creator') {
    hero = {
      kicker: 'CHAINVAULT · 创作者空间',
      title: '我的创作版权健康度',
      sub: '聚焦我的存证资产、授权关系与涉我侵权线索，第一时间发现并处理版权风险。',
      cta: '登记内容存证', go: 'register', goIc: 'file-plus',
      metrics: [
        { v: fmtInt(myWorks.length), l: '我的存证' },
        { v: fmtInt(myAuthz.length), l: '我的授权' },
        { v: fmtInt(myEv.length), l: '涉我侵权证据' },
        { v: fmtInt(myDet.length), l: '我的检测' },
      ],
    };
    stats = [
      { n: fmtInt(myWorks.length), l: '我的存证', ic: 'layers', sub: '当前身份上链作品' },
      { n: fmtInt(myAuthz.length), l: '我的授权', ic: 'key', sub: '我授予的记录' },
      { n: fmtInt(myEv.length), l: '涉我侵权证据', ic: 'shield-alert', clay: true, sub: '涉我作品的已固定证据' },
      { n: fmtInt(myDet.length), l: '我的检测', ic: 'scan', sub: '我发起的检测次数' },
    ];
    extra = creatorExtra();
  } else if (role === 'monitor') {
    hero = {
      kicker: 'CHAINVAULT · 全网监测',
      title: '全网侵权监测视图',
      sub: '面向全网公开存证开展侵权监测，掌握监测对象、证据固定与命中概况。',
      cta: '发起侵权监测', go: 'detect', goIc: 'scan',
      metrics: [
        { v: fmtInt(g.works), l: '监测对象' },
        { v: fmtInt(g.evidence), l: '证据总量' },
        { v: fmtInt(g.detections), l: '检测次数' },
        { v: fmtHit, l: '命中率' },
      ],
    };
    stats = [
      { n: fmtInt(g.works), l: '监测对象', ic: 'globe', sub: '全网公开存证' },
      { n: fmtInt(g.evidence), l: '证据总量', ic: 'shield-alert', clay: true, sub: '由监测机构固定' },
      { n: fmtInt(g.detections), l: '检测次数', ic: 'scan', sub: '累计巡检与专项' },
      { n: fmtHit, l: '检测命中率', ic: 'activity', sub: '命中 ' + fmtInt(hitCount) + ' 次疑似侵权' },
    ];
    extra = monitorExtra();
  } else {
    chip = `<span class="hb-chip">${icon('eye', 13)} 只读公开数据</span>`;
    hero = {
      kicker: 'CHAINVAULT · 公开数据',
      title: '全网存证公开总览',
      sub: '以只读身份浏览链上公开的存证指标与最新动态，可随时上传文件核验存证真伪。',
      cta: '验证存证真伪', go: 'verify', goIc: 'shield-check',
      metrics: [
        { v: fmtInt(g.works), l: '全网存证' },
        { v: fmtInt(g.evidence), l: '公开证据' },
        { v: fmtInt(g.authzs), l: '授权记录' },
        { v: fmtHit, l: '命中率' },
      ],
    };
    stats = [
      { n: fmtInt(g.works), l: '全网存证', ic: 'layers', sub: '公开链上数据' },
      { n: fmtInt(g.evidence), l: '公开证据', ic: 'shield-alert', clay: true, sub: '对外公开可查' },
      { n: fmtInt(g.authzs), l: '授权记录', ic: 'key', sub: '当前有效授权' },
      { n: fmtHit, l: '命中率', ic: 'activity', sub: '全网统计口径' },
    ];
  }

  /* ---------------- 内部渲染小件 ---------------- */
  function creatorExtra() {
    return `
    <div class="card">
      <div class="card-title"><h3>${icon('shield', 15)} 我的版权守护</h3>
        <button class="link-btn" data-go="evidence">${icon('arrow-up-right', 13)} 证据中心</button></div>
      <div class="grid grid-2" style="gap:12px">
        <div>
          <div style="font-family:var(--serif);font-size:24px;font-weight:600;color:var(--clay)">${myEv.length}</div>
          <div class="stat-label">涉我侵权证据</div>
        </div>
        <div>
          <div style="font-family:var(--serif);font-size:24px;font-weight:600;color:var(--sage)">${myAuthzActive}</div>
          <div class="stat-label">当前有效授权</div>
        </div>
      </div>
      <div class="small sub" style="margin-top:12px;line-height:1.7">涉我侵权证据与有效授权共同反映版权健康度；发现线索可前往证据中心查看取证快照并导出维权证据包。</div>
    </div>`;
  }

  function adminExtra() {
    const cs = chain.chainStatus();
    const cts = chain.contracts();
    const isReal = cs.mode === 'real';
    const vaultAddr = isReal ? (cts.vault.real || '') : (cts.vault.mock || '');
    const anchorAddr = isReal ? (cts.anchor.real || '') : (cts.anchor.mock || '');
    const addrCell = (addr) => addr
      ? `<div style="display:flex;align-items:center;gap:6px;min-width:0">
          <code style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono);font-size:10.5px;background:var(--panel);border:1px solid var(--line-soft);border-radius:6px;padding:2px 7px;color:var(--sub)">${esc(addr)}</code>
          <button class="icon-btn" data-copy="${esc(addr)}" title="复制地址" style="width:26px;height:26px;flex:0 0 26px">${icon('copy', 13)}</button>
        </div>`
      : '<span class="muted small">未配置（模拟链可留空）</span>';
    return `
    <div class="card">
      <div class="card-title"><h3>${icon('hexagon', 15)} 链状态快照</h3>
        <button class="link-btn" data-go="chain">${icon('arrow-up-right', 13)} 链管理</button></div>
      <div class="grid grid-3" style="gap:14px">
        <div class="stat"><div class="stat-num">${fmtInt(cs.block)}</div><div class="stat-label">区块高度</div></div>
        <div class="stat"><div class="stat-num">${fmtInt(cs.txs)}</div><div class="stat-label">交易总数</div></div>
        <div class="stat"><div class="stat-num">${fmtInt(cs.accounts)}</div><div class="stat-label">账户数量</div></div>
      </div>
      <div class="divider" style="margin:14px 0 12px"></div>
      <div class="kv" style="grid-template-columns:88px 1fr">
        <dt>链上模式</dt><dd>${isReal ? '真实链 · MetaMask' : '模拟链（本地演示）'}</dd>
        <dt>存证合约</dt><dd>${addrCell(vaultAddr)}</dd>
        <dt>证据合约</dt><dd>${addrCell(anchorAddr)}</dd>
      </div>
    </div>`;
  }

  function monitorExtra() {
    const hits = chain.evidence().filter((e) => e.sim >= 70).slice(0, 3);
    return `
    <div class="card">
      <div class="card-title"><h3>${icon('activity', 15)} 命中率与最近证据</h3><span class="chip">共 ${fmtInt(g.detections)} 次</span></div>
      <div class="row" style="gap:18px;align-items:center">
        ${svgRing(g.hitRate, { color: '#A85640' })}
        <div class="grow small sub" style="line-height:1.7">累计执行 ${fmtInt(g.detections)} 次全网监测，其中 ${fmtInt(hitCount)} 次命中疑似侵权。</div>
      </div>
      <div class="divider" style="margin:12px 0 4px"></div>
      <div class="sec-kicker" style="margin:0 0 4px">最近命中的侵权证据</div>
      ${hits.length === 0
        ? empty('shield-alert', '暂无侵权证据', '命中疑似侵权后可在此固定证据')
        : hits.map((e) => `
        <div class="list-row" data-ev="${e.id}" style="cursor:pointer">
          <span class="grow" style="min-width:0">
            <b class="small" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.query.title || '侵权证据')}</b>
            <span class="muted tiny">CV-${String(e.workId).padStart(6, '0')} · ${timeAgo(e.anchored.ts)}</span>
          </span>
          <span style="font-family:var(--mono);font-weight:600;font-size:13px;color:var(--clay)">${e.sim.toFixed(1)}%</span>
        </div>`).join('')}
    </div>`;
  }

  function workRow(w) {
    return `
    <div class="list-row" data-work="${w.id}" style="cursor:pointer">
      <span style="flex:0 0 44px;width:44px;height:44px;border-radius:7px;overflow:hidden;border:1px solid var(--line-soft);background:var(--panel)">
        ${w.kind === 'image'
          ? `<img src="${w.thumb}" alt="" style="width:44px;height:44px;object-fit:cover">`
          : `<span style="width:44px;height:44px;display:grid;place-items:center;color:var(--sage)">${icon('align-left', 16)}</span>`}
      </span>
      <span class="grow" style="min-width:0">
        <b class="small" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(w.title)}</b>
        <span class="muted tiny" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(w.authorsName || shortAddr(w.author))} · ${timeAgo(w.anchored.ts)}</span>
      </span>
      <span class="badge badge-neutral">${w.versionNo > 1 ? 'v' + w.versionNo : '首版'}</span>
    </div>`;
  }

  function txRow(t) {
    const ic = ({ register: 'shield-check', version: 'layers', authz: 'key', revoke: 'x', evidence: 'shield-alert', account: 'user' })[t.type] || 'circle-dot';
    return `
    <div class="mini-tx-item">
      <span class="mtx-ic ${t.type === 'evidence' ? 'clay' : ''}">${icon(ic, 15)}</span>
      <span class="mtx-main">
        <span class="mtx-t">${esc(t.label)}</span>
        <span class="mtx-s"><span>区块 #${t.block}</span><span>${timeAgo(t.ts)}</span><span class="hash-inline">${shortAddr(t.hash, 8, 4)}</span></span>
      </span>
    </div>`;
  }

  /* ---------------- 布局拼装 ---------------- */
  const statsHtml = stats.map((s) => `
    <div class="stat ${s.clay ? 'clay' : ''}">
      <div class="stat-icon">${icon(s.ic, 17)}</div>
      <div class="stat-num">${s.n}</div>
      <div class="stat-label">${esc(s.l)}</div>
      ${s.sub ? `<div class="stat-sub">${esc(s.sub)}</div>` : ''}
    </div>`).join('');

  const worksLink = role === 'user'
    ? '<span class="badge badge-neutral">公开</span>'
    : `<button class="link-btn" data-go="works">${icon('arrow-up-right', 13)} 存证库</button>`;

  const latestWorksHtml = latestWorks.length
    ? latestWorks.map(workRow).join('')
    : empty('layers', '暂无存证', '完成内容存证后将在此展示最新上链作品');

  const latestTxsHtml = latestTxs.length
    ? latestTxs.map(txRow).join('')
    : empty('history', '暂无交易', '链上广播交易后将在此展示');

  el.innerHTML = `
  <div class="page">
    <div class="hero-band">
      <div style="min-width:0">
        <div class="hb-k">${esc(hero.kicker)}</div>
        <h2>${esc(hero.title)}</h2>
        <div class="hb-sub">${esc(hero.sub)}</div>
        <div style="margin-top:16px">
          <button class="btn" style="background:#fff;color:#2E4A3C;box-shadow:0 2px 12px rgba(0,0,0,.16)" data-go="${hero.go}">${icon(hero.goIc, 15)} ${esc(hero.cta)}</button>
        </div>
      </div>
      <div style="min-width:0">
        ${chip ? `<div style="display:flex;justify-content:flex-end;margin-bottom:14px">${chip}</div>` : ''}
        <div class="hb-metrics" style="grid-template-columns:repeat(auto-fit,minmax(104px,1fr))">
          ${hero.metrics.map((m) => `<div class="hb-m" style="min-width:0"><b>${m.v}</b><span>${esc(m.l)}</span></div>`).join('')}
        </div>
      </div>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">
      <div style="flex:2 1 620px;min-width:420px;display:flex;flex-direction:column;gap:16px">
        <div class="grid grid-4">
          ${statsHtml}
        </div>
        <div class="card">
          <div class="card-title">
            <h3>${icon('activity', 15)} 近 14 日 · 存证 / 侵权证据趋势</h3>
          </div>
          ${svgBarChart(chain.daily14())}
          <div class="legend" style="margin-top:12px">
            <span><i class="lg-sage"></i>存证登记</span>
            <span><i class="lg-clay"></i>侵权证据固定</span>
          </div>
        </div>
      </div>

      <div style="flex:1 1 320px;min-width:280px;display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <div class="card-title">
            <h3>${icon('layers', 15)} 最新存证</h3>
            ${worksLink}
          </div>
          ${latestWorksHtml}
        </div>
        <div class="card">
          <div class="card-title">
            <h3>${icon('send', 15)} 最新上链交易</h3>
            <span class="chip">共 ${fmtInt(g.txs)} 笔</span>
          </div>
          <div class="mini-tx">
            ${latestTxsHtml}
          </div>
        </div>
        ${extra}
      </div>
    </div>
  </div>`;

  bindRoot(el);

  el.querySelectorAll('[data-work]').forEach((n) => {
    n.addEventListener('click', () => openWorkModal(Number(n.getAttribute('data-work')), { allowVersion: role !== 'user' }));
  });
  el.querySelectorAll('[data-ev]').forEach((n) => {
    n.addEventListener('click', () => openEvidenceModal(Number(n.getAttribute('data-ev'))));
  });

  return () => {};
}
