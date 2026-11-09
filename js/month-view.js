// 「統計 → 每月」：當月記帳 + 固定支出 = 這個月總共花多少
// 固定支出在「設定」頁管理，這裡只顯示當月有效的項目

import * as C from './calc.js';
import { shortMonth } from './fixed-view.js';

const monthLabel = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return `${y} 年 ${mo} 月`;
};

export function createMonthView({ state, $, esc, onDbError, money, goToFixed }) {
  let month = C.monthOf(state.today);
  let cache = { key: '', entries: [] }; // 預算開始日以前的帳目（不會即時更新，切月份時重讀）
  let loadingKey = '';

  const fixedCosts = () => (Array.isArray(state.settings.fixedCosts) ? state.settings.fixedCosts : []);

  /** 可以看的月份：預算開始日或最早的固定支出 ～ 這個月 */
  function bounds() {
    const max = C.monthOf(state.today);
    const starts = [C.monthOf(state.settings.startDate), ...fixedCosts().map((f) => f.startMonth)].filter(Boolean).sort();
    const min = starts.length && starts[0] < max ? starts[0] : max;
    return { min, max };
  }

  function render() {
    if (state.view !== 'stats' || state.statsMode !== 'month' || !state.user) return;
    const b = bounds();
    if (month > b.max) month = b.max;
    if (month < b.min) month = b.min;
    $('mTitle').textContent = monthLabel(month);
    $('mPrev').disabled = month <= b.min;
    $('mNext').disabled = month >= b.max;

    // 預算開始日以後的帳目已經在畫面上（即時同步）；更早的要另外讀
    const { start, end } = C.monthRange(month);
    const cutoff = state.settings.startDate;
    if (start >= cutoff) return draw(state.entries);
    const to = end < cutoff ? end : C.addDays(cutoff, -1);
    const key = `${start}|${to}`;
    if (cache.key === key) return draw([...cache.entries, ...state.entries]);
    $('mTotal').innerHTML = '<p class="mt-label">讀取中…</p>';
    if (loadingKey === key) return;
    loadingKey = key;
    state.store
      .fetchEntriesRange(start, to)
      .then((list) => {
        cache = { key, entries: list };
        loadingKey = '';
        render();
      })
      .catch((err) => {
        loadingKey = '';
        onDbError(err);
      });
  }

  function draw(entries) {
    const ms = C.monthSummary(entries, fixedCosts(), month, state.settings.categories);
    const isCur = month === C.monthOf(state.today);

    $('mTotal').innerHTML = `
      <p class="mt-label">${isCur ? '這個月到目前總共花' : '這個月總共花'}</p>
      <p class="mt-amount">${money(ms.total)}</p>
      <div class="mt-bar" aria-hidden="true">${
        ms.total > 0
          ? `<span class="mt-daily" style="flex-grow:${ms.daily.total}"></span><span class="mt-fixed" style="flex-grow:${ms.fixed.total}"></span>`
          : ''
      }</div>
      <dl class="mt-rows">
        <div><dt><i class="sw-box mt-daily"></i>生活費（記帳 ${ms.daily.count} 筆）</dt><dd>${money(ms.daily.total)}</dd></div>
        <div><dt><i class="sw-box mt-fixed"></i>固定支出（${ms.fixed.items.length} 項）</dt><dd>${money(ms.fixed.total)}</dd></div>
      </dl>
      ${isCur ? '<p class="hint">生活費算到今天為止，固定支出算整個月。</p>' : ''}`;

    // 固定支出（只看）
    $('mFixed').innerHTML = ms.fixed.items.length
      ? ms.fixed.items
          .map(
            (f) => `<li class="fx-row">
              <span class="entry-main">
                <span class="entry-item">${esc(f.name)}</span>
                <span class="entry-meta"><span>${shortMonth(f.startMonth)} 起${f.endMonth ? `，到 ${shortMonth(f.endMonth)}` : ''}</span></span>
              </span>
              <span class="entry-amt">${money(f.amount)}</span>
            </li>`,
          )
          .join('') + `<li class="fx-sum"><span>合計</span><span class="entry-amt">${money(ms.fixed.total)}</span></li>`
      : `<li class="empty">${fixedCosts().length ? '這個月沒有固定支出。' : '還沒有設定固定支出。按「到設定修改」新增房租、手機費、訂閱等。'}</li>`;

    // 生活費分類
    const cats = ms.daily.byCategory;
    const max = cats.length ? cats[0].total : 1;
    $('mCats').innerHTML = cats.length
      ? cats
          .map(
            (c) => `<li>
              <span class="cat-name">${esc(c.category)}</span>
              <span class="cat-track" aria-hidden="true"><span style="width:${(c.total / max) * 100}%"></span></span>
              <span class="cat-val">${money(c.total)}</span>
              <span class="cat-pct">${Math.round(c.share * 100)}%</span>
            </li>`,
          )
          .join('') +
        `<li class="cat-sum"><span class="cat-name">合計</span><span></span><span class="cat-val">${money(ms.daily.total)}</span><span class="cat-pct"></span></li>`
      : '<li class="empty">這個月沒有記帳。</li>';
  }

  $('mPrev').addEventListener('click', () => {
    month = C.addMonths(month, -1);
    render();
  });
  $('mNext').addEventListener('click', () => {
    month = C.addMonths(month, 1);
    render();
  });
  $('mFixedEdit').addEventListener('click', goToFixed);

  return {
    render,
    /** 換帳號或換預算開始日時，清掉讀過的舊帳目 */
    reset() {
      cache = { key: '', entries: [] };
      loadingKey = '';
    },
  };
}
