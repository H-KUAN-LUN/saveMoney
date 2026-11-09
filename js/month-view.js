// 「統計 → 每月」：當月記帳 + 固定支出 = 這個月總共花多少；固定支出的新增、修改、刪除
// 固定支出存在設定（meta/settings）的 fixedCosts 裡：[{id, name, amount, startMonth, endMonth}]

import * as C from './calc.js';

const monthLabel = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return `${y} 年 ${mo} 月`;
};
const shortMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return `${y}/${mo}`;
};

export function createMonthView({ state, $, esc, toast, onDbError, money, saveSettingsPatch }) {
  let month = C.monthOf(state.today);
  let cache = { key: '', entries: [] }; // 開始日以前的帳目（不會即時更新，切月份時重讀）
  let loadingKey = '';
  let editId = null;

  const fixedCosts = () => (Array.isArray(state.settings.fixedCosts) ? state.settings.fixedCosts : []);

  /** 可以看的月份：預算開始日或最早的固定支出 ～ 這個月 */
  function bounds() {
    const max = C.monthOf(state.today);
    const starts = [C.monthOf(state.settings.startDate), ...fixedCosts().map((f) => f.startMonth)].filter(Boolean).sort();
    const min = starts.length && starts[0] < max ? starts[0] : max;
    return { min, max };
  }

  /* ---------- 整頁 ---------- */

  function render() {
    if (state.view !== 'stats' || state.statsMode !== 'month' || !state.user) return;
    const b = bounds();
    if (month > b.max) month = b.max;
    if (month < b.min) month = b.min;
    $('mTitle').textContent = monthLabel(month);
    $('mPrev').disabled = month <= b.min;
    $('mNext').disabled = month >= b.max;
    renderFixedList();

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

  /* ---------- 固定支出清單 ---------- */

  function renderFixedList() {
    const list = [...fixedCosts()];
    if (!list.length) {
      $('fxList').innerHTML = '<li class="empty">還沒有固定支出。按下面的「新增固定支出」加上房租、手機費、訂閱等。</li>';
      return;
    }
    // 這個月有效的排前面（金額大到小），其他的排後面
    const active = list.filter((f) => C.fixedActive(f, month)).sort((a, b) => b.amount - a.amount);
    const other = list.filter((f) => !C.fixedActive(f, month)).sort((a, b) => a.startMonth.localeCompare(b.startMonth));
    const total = active.reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const period = (f) => `${shortMonth(f.startMonth)} 起${f.endMonth ? `，到 ${shortMonth(f.endMonth)}` : ''}`;
    const item = (f, on) => `<li><button type="button" class="entry ${on ? '' : 'is-off'}" data-fx="${esc(f.id)}">
        <span class="entry-main">
          <span class="entry-item">${esc(f.name)}</span>
          <span class="entry-meta"><span>${period(f)}</span>${
            on ? '' : `<span>${f.startMonth > month ? '這個月還沒開始' : '已經結束'}</span>`
          }</span>
        </span>
        <span class="entry-amt">${money(f.amount)}</span>
      </button></li>`;
    $('fxList').innerHTML =
      active.map((f) => item(f, true)).join('') +
      `<li class="fx-sum"><span>${monthLabel(month)}合計</span><span class="entry-amt">${money(total)}</span></li>` +
      other.map((f) => item(f, false)).join('');
  }

  /* ---------- 新增 / 修改 / 刪除 ---------- */

  function openForm(f) {
    editId = f ? f.id : null;
    $('fxFormTitle').textContent = f ? '修改固定支出' : '新增固定支出';
    $('fxSave').textContent = f ? '儲存' : '新增';
    $('fxName').value = f ? f.name : '';
    $('fxAmount').value = f ? f.amount : '';
    $('fxStart').value = f ? f.startMonth : month;
    $('fxEnd').value = f ? f.endMonth || '' : '';
    $('fxMsg').textContent = '';
    $('fxDelete').hidden = !f;
    disarm();
    $('fxForm').hidden = false;
    $('fxAdd').hidden = true;
    $('fxForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('fxName').focus({ preventScroll: true });
  }

  function closeForm() {
    editId = null;
    $('fxForm').hidden = true;
    $('fxAdd').hidden = false;
  }

  function onSubmit(ev) {
    ev.preventDefault();
    const msg = $('fxMsg');
    const name = $('fxName').value.trim();
    const amount = Number($('fxAmount').value);
    const startMonth = $('fxStart').value.trim();
    const endMonth = $('fxEnd').value.trim();
    if (!name) return void (msg.textContent = '請填名稱。');
    if (!$('fxAmount').value || !(amount > 0)) return void (msg.textContent = '請填每月金額。');
    if (!C.isMonthStr(startMonth)) return void (msg.textContent = '請選開始月份（格式像 2026-11）。');
    if (endMonth && !C.isMonthStr(endMonth)) return void (msg.textContent = '結束月份格式不對（像 2026-12），不用的話留空。');
    if (endMonth && endMonth < startMonth) return void (msg.textContent = '結束月份要在開始月份之後。');
    msg.textContent = '';
    const item = { id: editId || Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.slice(0, 30), amount, startMonth, endMonth };
    const list = fixedCosts().filter((f) => f.id !== item.id);
    list.push(item);
    saveSettingsPatch({ fixedCosts: list });
    toast(editId ? `已更新 ${item.name}` : `已新增 ${item.name} ${money(amount)}／月`);
    closeForm();
  }

  let armTimer = null;
  function disarm() {
    clearTimeout(armTimer);
    $('fxDelete').classList.remove('armed');
    $('fxDelete').textContent = '刪除';
  }

  function onDelete() {
    const b = $('fxDelete');
    if (!b.classList.contains('armed')) {
      b.classList.add('armed');
      b.textContent = '確定刪除？';
      armTimer = setTimeout(disarm, 4000);
      return;
    }
    const before = fixedCosts();
    const f = before.find((x) => x.id === editId);
    saveSettingsPatch({ fixedCosts: before.filter((x) => x.id !== editId) });
    closeForm();
    if (f) {
      toast(`已刪除 ${f.name}`, '復原', () => {
        saveSettingsPatch({ fixedCosts: [...fixedCosts().filter((x) => x.id !== f.id), f] });
        toast('已復原');
      });
    }
  }

  /* ---------- 綁定事件 ---------- */

  $('mPrev').addEventListener('click', () => {
    month = C.addMonths(month, -1);
    render();
  });
  $('mNext').addEventListener('click', () => {
    month = C.addMonths(month, 1);
    render();
  });
  $('fxAdd').addEventListener('click', () => openForm(null));
  $('fxCancel').addEventListener('click', closeForm);
  $('fxForm').addEventListener('submit', onSubmit);
  $('fxDelete').addEventListener('click', onDelete);
  $('fxList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fx]');
    if (!b) return;
    const f = fixedCosts().find((x) => x.id === b.dataset.fx);
    if (f) openForm(f);
  });

  return {
    render,
    /** 換帳號或換預算開始日時，清掉讀過的舊帳目 */
    reset() {
      cache = { key: '', entries: [] };
      loadingKey = '';
      closeForm();
    },
  };
}
