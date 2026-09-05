/* ===================================================================
 * wallet.js — 我的钱包（链证积分 CVT 奖励机制）
 * 存证确权 / 版本迭代 / 固定证据 / 命中监测 自动获得激励积分；
 * 账本含每笔交易的来源、关联链上哈希与时间。所有角色可访问。
 * =================================================================== */
import * as chain from '../core/chain.js';
import { icon, toastOk, toastErr } from '../core/ui.js';
import { esc, fmtTs, timeAgo, shortAddr, shortHash, fmtInt } from '../core/util.js';
import { bindRoot, avatarHTML } from './_shared.js';

const kindGroup = (kind) => (kind === 'register' || kind === 'version' ? 'create' : kind === 'evidence' || kind === 'detectHit' ? 'monitor' : 'airdrop');
const kindIcon = (kind) => ({ register: 'shield-check', version: 'layers', evidence: 'shield-alert', detectHit: 'scan', airdrop: 'gift' })[kind] || 'circle-dot';
const kindTone = (kind) => (kind === 'airdrop' ? 'badge-neutral' : kind === 'evidence' || kind === 'detectHit' ? 'badge-clay' : 'badge-sage');

export default async function page(el) {
  const a = chain.active();
  const addr = a.addr;
  let filter = 'all'; // all | create | monitor | airdrop

  const st = chain.tokenStats(addr);
  const list = chain.tokenLedger(addr);

  function badgeHTML(l) {
    return `<span class="badge ${kindTone(l.kind)}">${icon(kindIcon(l.kind), 11)} ${esc(l.label || l.kind)}</span>`;
  }

  function rulesRows() {
    return chain.REWARD_RULES.map((r) => `
      <div class="list-row" style="gap:12px">
        <span class="mtx-ic" style="width:30px;height:30px;flex:0 0 30px;border-radius:8px;display:grid;place-items:center;background:var(--sage-soft);color:var(--sage-deep)">${icon(kindIcon(r.kind), 15)}</span>
        <span class="grow" style="min-width:0">
          <b class="small" style="display:block">${esc(r.label)}</b>
          <span class="muted tiny">${esc(r.desc)}</span>
        </span>
        <span style="font-family:var(--mono);font-weight:700;color:var(--sage-deep)">+${r.amount} CVT</span>
      </div>`).join('');
  }

  function ledgerRows() {
    const ls = list.filter((l) => filter === 'all' || kindGroup(l.kind) === filter);
    if (!ls.length) {
      return `<div class="empty" style="padding:36px 12px">${icon('wallet', 30)}<b>暂无交易记录</b><span>完成存证 / 固定证据等上链行为即可获得激励积分</span></div>`;
    }
    return ls.map((l) => {
      const ref = l.refId ? (l.kind === 'register' || l.kind === 'version' ? `存证 #${String(l.refId).padStart(6, '0')}` : l.kind === 'evidence' ? `证据 #${String(l.refId).padStart(5, '0')}` : l.kind === 'detectHit' ? `检测 #${l.refId}` : '') : '';
      return `
      <div class="list-row" style="gap:12px">
        <span class="mtx-ic ${l.kind === 'evidence' || l.kind === 'detectHit' ? 'clay' : ''}" style="width:32px;height:32px;flex:0 0 32px">${icon(kindIcon(l.kind), 16)}</span>
        <span class="grow" style="min-width:0">
          ${badgeHTML(l)}
          <span class="muted tiny" style="display:block;margin-top:2px">${fmtTs(l.ts)} · ${timeAgo(l.ts)}${ref ? ' · ' + esc(ref) : ''}</span>
        </span>
        <span style="text-align:right;flex:0 0 auto">
          <b style="font-family:var(--mono);font-weight:700;color:var(--sage-deep)">+${fmtInt(l.amount)}</b>
          <span class="tiny muted" style="display:block;font-family:var(--mono)">CVT</span>
        </span>
      </div>`;
    }).join('');
  }

  el.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div>
        <h2>我的钱包</h2>
        <div class="page-sub">链证积分（${chain.TOKEN.name} · CVT）激励版权生态良性循环：每一次确权、监测与固证都获得回馈。</div>
      </div>
      <span class="badge badge-neutral">${chain.modeNow() === 'mock' ? '模拟链账本' : '真实链 · 本地激励台账'}</span>
    </div>

    <div class="grid grid-3 wallet-split">
      <div class="stack">
        <div class="card" style="padding:0;overflow:hidden">
          <div style="padding:22px 22px 14px;background:linear-gradient(150deg,#33493E,#3F6053 70%)">
            <div class="row" style="gap:10px;color:#fff">
              ${avatarHTML(a.name, addr, 38)}
              <div style="min-width:0">
                <b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff">${esc(a.name)}</b>
                <span style="font-family:var(--mono);font-size:10.5px;opacity:.85">${shortAddr(addr, 8, 6)}</span>
              </div>
            </div>
            <div style="margin-top:20px;color:#fff">
              <div style="font-size:10px;letter-spacing:.22em;text-transform:uppercase;opacity:.75">可用余额 · Balance</div>
              <div style="font-family:var(--serif);font-size:34px;font-weight:600;line-height:1.2;margin-top:2px">${fmtInt(st.balance)} <span style="font-size:15px;opacity:.8;letter-spacing:.06em">CVT</span></div>
              <div class="row" style="gap:18px;margin-top:14px;opacity:.92">
                <div><b style="font-family:var(--mono)">${fmtInt(st.earned)}</b><div style="font-size:10.5px;opacity:.75">累计获得</div></div>
                <div><b style="font-family:var(--mono)">${st.count}</b><div style="font-size:10.5px;opacity:.75">奖励笔数</div></div>
              </div>
            </div>
          </div>
          <div style="padding:14px 22px 18px">
            <button class="btn btn-soft btn-block btn-sm" id="airdrop" ${chain.airdropClaimed(addr) ? 'disabled' : ''}>
              ${icon(chain.airdropClaimed(addr) ? 'check-circle' : 'plus', 14)}
              ${chain.airdropClaimed(addr) ? '已领取过演示空投' : '领取演示空投 +500 CVT'}
            </button>
          </div>
        </div>
        <div class="card">
          <div class="card-title"><h3>${icon('info', 15)} 积分说明</h3></div>
          <div class="small sub" style="line-height:1.8">
            CVT 为平台生态激励积分，绑定钱包地址记账，积分流水与本体系内关键链上交易一一对应（可核验交易哈希）。当前版本仅作激励机制演示，不具备任何货币属性。
          </div>
        </div>
      </div>

      <div class="stack-24">
        <div class="card">
          <div class="card-title"><h3>${icon('award', 15)} 如何获得奖励</h3></div>
          ${rulesRows()}
        </div>

        <div class="card">
          <div class="row-between wrap" style="gap:10px;margin-bottom:6px">
            <div class="row" style="gap:8px">
              <h3 style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:var(--sub);display:flex;align-items:center;gap:8px">${icon('history', 15)} 交易记录</h3>
              <span class="chip">${list.length} 笔</span>
            </div>
            <div class="seg" id="segFilter">
              <button data-f="all" class="on">全部</button>
              <button data-f="create">创作奖励</button>
              <button data-f="monitor">监测奖励</button>
              <button data-f="airdrop">空投</button>
            </div>
          </div>
          <div id="ledgerList">${ledgerRows()}</div>
        </div>
      </div>
    </div>
  </div>`;

  bindRoot(el);
  // avatarHTML 的 class 在深色卡上由 `.avatar` 自带背景，无需替换
  el.querySelectorAll('#segFilter button').forEach((b) => {
    b.onclick = () => {
      el.querySelectorAll('#segFilter button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      filter = b.getAttribute('data-f');
      el.querySelector('#ledgerList').innerHTML = ledgerRows();
    };
  });

  const ab = el.querySelector('#airdrop');
  if (ab) ab.onclick = () => {
    const ok = chain.claimAirdrop(addr);
    if (ok) {
      toastOk('演示空投已到账：+500 CVT');
      page(el);
    } else {
      toastErr('每个账户仅可领取一次空投');
    }
  };

  return () => {};
}
