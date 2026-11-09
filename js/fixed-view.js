// 「設定 → 每月固定支出」：新增、修改、刪除
// 固定支出存在設定（meta/settings）的 fixedCosts 裡：[{id, name, amount, startMonth, endMonth}]

import * as C from './calc.js';

export const shortMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return `${y}/${mo}`;
};

export function createFixedView({ state, $, esc, toast, money, saveSettingsPatch }) {
  let editId = null;
  const fixedCosts = () => (Array.isArray(state.settings.fixedCosts) ? state.settings.fixedCosts : []);
  const thisMonth = () => C.monthOf(state.today);

  /* ---------- 清單 ---------- */

  function render() {
    if (state.view !== 'settings' || !state.user) return;
    const list = fixedCosts();
    const cur = thisMonth();
    if (!list.length) {
      $('fxList').innerHTML = '<li class="empty">還沒有固定支出。</li>';
      return;
    }
    // 這個月有效的排前面（金額大到小），接著是還沒開始的，最後是已經結束的
    const active = list.filter((f) => C.fixedActive(f, cur)).sort((a, b) => b.amount - a.amount);
    const future = list.filter((f) => f.startMonth > cur).sort((a, b) => a.startMonth.localeCompare(b.startMonth));
    const ended = list.filter((f) => f.endMonth && f.endMonth < cur).sort((a, b) => b.endMonth.localeCompare(a.endMonth));
    const total = active.reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const period = (f) => `${shortMonth(f.startMonth)} 起${f.endMonth ? `，到 ${shortMonth(f.endMonth)}` : ''}`;
    const item = (f, note) => `<li><button type="button" class="entry ${note ? 'is-off' : ''}" data-fx="${esc(f.id)}">
        <span class="entry-main">
          <span class="entry-item">${esc(f.name)}</span>
          <span class="entry-meta"><span>${period(f)}</span>${note ? `<span>${note}</span>` : ''}</span>
        </span>
        <span class="entry-amt">${money(f.amount)}</span>
      </button></li>`;
    $('fxList').innerHTML =
      active.map((f) => item(f, '')).join('') +
      (active.length ? `<li class="fx-sum"><span>這個月合計</span><span class="entry-amt">${money(total)}</span></li>` : '') +
      future.map((f) => item(f, '還沒開始')).join('') +
      ended.map((f) => item(f, '已經結束')).join('');
  }

  /* ---------- 新增 / 修改 / 刪除 ---------- */

  function openForm(f) {
    editId = f ? f.id : null;
    $('fxFormTitle').textContent = f ? '修改固定支出' : '新增固定支出';
    $('fxSave').textContent = f ? '儲存' : '新增';
    $('fxName').value = f ? f.name : '';
    $('fxAmount').value = f ? f.amount : '';
    $('fxStart').value = f ? f.startMonth : thisMonth();
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
    const item = {
      id: editId || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.slice(0, 30),
      amount,
      startMonth,
      endMonth,
    };
    saveSettingsPatch({ fixedCosts: [...fixedCosts().filter((f) => f.id !== item.id), item] });
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
    const f = fixedCosts().find((x) => x.id === editId);
    saveSettingsPatch({ fixedCosts: fixedCosts().filter((x) => x.id !== editId) });
    closeForm();
    if (f) {
      toast(`已刪除 ${f.name}`, '復原', () => {
        saveSettingsPatch({ fixedCosts: [...fixedCosts().filter((x) => x.id !== f.id), f] });
        toast('已復原');
      });
    }
  }

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

  return { render, reset: closeForm };
}
