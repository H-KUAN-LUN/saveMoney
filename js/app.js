import { firebaseConfig, allowedEmail } from './firebase-config.js';
import { createStore } from './store.js';
import * as C from './calc.js';
import * as CSV from './csv.js';
import { createWeightView } from './weight-view.js';
import { createMonthView } from './month-view.js';

// 預設值 = 原本 Excel「設定」和「清單」頁的內容；登入後在「設定」改，會存到 Firestore
const DEFAULT_SETTINGS = {
  weeklyBudget: 2500,
  startDate: '2026-11-05',
  totalWeeks: 9,
  categories: ['正餐', '超商', '飲料點心', '菸', '交通加油', '網購', '全聯日用', '娛樂', '其他'],
  payments: ['街口', '簽帳卡', '現金', 'LINE Pay', '全支付', '信用卡'],
};

const $ = (id) => document.getElementById(id);

const state = {
  store: null,
  user: null,
  settings: { ...DEFAULT_SETTINGS },
  settingsSig: '',
  chipsSig: '',
  entries: [],
  journal: {},
  loaded: false,
  today: C.todayStr(),
  selDay: C.todayStr(),
  view: 'home',
  listWeek: 'all',
  catRange: 'cur',
  statsMode: 'week',
  summary: null,
  unwatch: null,
  unwatchSettings: null,
  editId: null,
  // 體重
  weights: [],
  weightGoal: null,
  weightLoaded: false,
  unwatchWeight: null,
};

/* ---------- 小工具 ---------- */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function money(n) {
  const v = Math.round(n);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
}
const pct = (r) => `${Math.round(r * 100)}%`;
const dayLabel = (d) => `${C.shortDate(d)}（${C.weekdayOf(d)}）`;
const byTime = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);

const pref = {
  get(k) {
    try {
      return localStorage.getItem('wb-' + k);
    } catch (_) {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('wb-' + k, v);
    } catch (_) {
      /* 不重要的偏好，存不了就算了 */
    }
  },
};

/* ---------- 提示訊息 ---------- */

function showBanner(text, tone = 'error') {
  const b = $('banner');
  b.className = `banner banner-${tone}`;
  b.innerHTML = `<span>${esc(text)}</span><button type="button" aria-label="關閉">關閉</button>`;
  b.hidden = false;
  b.querySelector('button').onclick = () => (b.hidden = true);
}

let toastTimer = null;
function toast(text, actionLabel, action) {
  const t = $('toast');
  $('toastText').textContent = text;
  const btn = $('toastAction');
  if (actionLabel) {
    btn.textContent = actionLabel;
    btn.hidden = false;
    btn.onclick = () => {
      t.hidden = true;
      action();
    };
  } else btn.hidden = true;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), actionLabel ? 6000 : 3000);
}

function dbErrorText(err) {
  const code = err && err.code;
  if (code === 'permission-denied')
    return 'Firestore 拒絕讀寫：確認 firestore.rules 已經發布，而且裡面的 email 就是你現在登入的帳號。';
  if (code === 'unavailable') return '連不上 Firestore，目前是離線狀態；記的帳會先存在這台裝置，連線後自動同步。';
  if (code === 'failed-precondition') return 'Firestore 還沒建立資料庫，或瀏覽器不支援離線快取。';
  return `資料庫發生錯誤：${(err && err.message) || err}`;
}
const onDbError = (err) => {
  console.error(err);
  showBanner(dbErrorText(err));
};

/* ---------- 啟動與登入 ---------- */

async function boot() {
  try {
    state.store = await createStore({ firebaseConfig, allowedEmail });
  } catch (err) {
    console.error(err);
    $('boot').textContent = '載不到 Firebase 程式庫（www.gstatic.com），可能是網路或防火牆擋住了。';
    return;
  }
  if (state.store.mode === 'local') {
    showBanner('示範模式：還沒填 Firebase 設定，資料只存在這個瀏覽器，不會同步。', 'info');
  }
  bindUI();
  state.store.onUser(onUser);
}

function onUser(user) {
  if (state.unwatch) state.unwatch();
  if (state.unwatchSettings) state.unwatchSettings();
  if (state.unwatchWeight) state.unwatchWeight();
  state.unwatch = state.unwatchSettings = state.unwatchWeight = null;
  state.user = user;
  state.loaded = false;
  state.weightLoaded = false;
  monthView.reset();
  $('boot').hidden = true;

  if (!user) {
    $('app').hidden = true;
    $('login').hidden = false;
    return;
  }
  const allowed = state.store.allowedEmail;
  if (allowed && user.email.toLowerCase() !== allowed) {
    $('loginMsg').textContent = `${user.email} 沒有權限。請改用 firebase-config.js 裡設定的帳號登入。`;
    state.store.signOut();
    return;
  }
  $('login').hidden = true;
  $('loginMsg').textContent = '';
  $('app').hidden = false;
  renderAccount();
  state.unwatchSettings = state.store.watchSettings(onSettings, onDbError);
  startWeightWatch();
}

function startWeightWatch() {
  let gotRecords = false;
  let gotGoal = false;
  const done = () => {
    state.weightLoaded = gotRecords && gotGoal;
    weightView.render();
  };
  state.unwatchWeight = state.store.watchWeight({
    onRecords(list) {
      state.weights = list.sort((a, b) => a.date.localeCompare(b.date));
      gotRecords = true;
      done();
    },
    onGoal(goal) {
      state.weightGoal = goal;
      gotGoal = true;
      done();
    },
    onError: onDbError,
  });
}

function onSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  s.weeklyBudget = Number(s.weeklyBudget) || 0;
  s.totalWeeks = Math.max(1, parseInt(s.totalWeeks, 10) || 1);
  if (!Array.isArray(s.categories) || !s.categories.length) s.categories = DEFAULT_SETTINGS.categories;
  if (!Array.isArray(s.payments)) s.payments = DEFAULT_SETTINGS.payments;
  if (!Array.isArray(s.fixedCosts)) s.fixedCosts = [];
  const startChanged = s.startDate !== state.settings.startDate;
  state.settings = s;
  if (startChanged) monthView.reset();
  if (!state.unwatch || startChanged) startWatch();
  fillSettingsForm();
  renderAll();
}

function startWatch() {
  if (state.unwatch) state.unwatch();
  state.loaded = false;
  state.unwatch = state.store.watch(state.settings.startDate, {
    onEntries(list) {
      state.entries = list;
      state.loaded = true;
      renderAll();
    },
    onJournal(map) {
      state.journal = map;
      renderJournal();
      if (state.view === 'list') renderList();
    },
    onError: onDbError,
  });
}

async function signIn() {
  $('loginMsg').textContent = '';
  try {
    await state.store.signIn();
  } catch (err) {
    const code = err && err.code;
    const host = location.hostname;
    const msg = {
      'auth/unauthorized-domain': `Firebase 還沒授權這個網域。到 Firebase Console → Authentication → 設定 → 已授權網域，加入「${host}」。`,
      'auth/popup-blocked': '瀏覽器擋住了登入視窗。請允許這個網站開啟彈出式視窗，再按一次登入。',
      'auth/network-request-failed': '連不到 Google 登入服務，可能是網路或公司防火牆擋住了。',
      'auth/operation-not-allowed': 'Firebase 還沒開啟 Google 登入：到 Authentication → 登入方式，啟用 Google。',
      'auth/configuration-not-found': 'Firebase 還沒開啟 Authentication：到 Authentication 按「開始使用」，再啟用 Google 登入。',
      'auth/popup-closed-by-user': '',
      'auth/cancelled-popup-request': '',
    }[code];
    $('loginMsg').textContent = msg ?? `登入失敗（${code || err}）`;
  }
}

/* ---------- 畫面切換 ---------- */

function setView(v) {
  flushJournal();
  state.view = v;
  for (const sec of document.querySelectorAll('.view')) sec.hidden = sec.id !== `view-${v}`;
  for (const b of document.querySelectorAll('.tabbar button')) {
    if (b.dataset.view === v) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  renderAll();
  window.scrollTo(0, 0);
}

function renderAll() {
  if (!state.user) return;
  state.summary = C.computeSummary(state.entries, state.settings, state.today);
  renderChips();
  renderSuggestions();
  if (state.view === 'home') {
    renderHero();
    renderDay();
  } else if (state.view === 'list') renderList();
  else if (state.view === 'stats') {
    if (state.statsMode === 'month') monthView.render();
    else renderStats();
  }
  else if (state.view === 'weight') weightView.render();
}

/* ---------- 首頁：本週狀況 ---------- */

function renderHero() {
  const hero = $('hero');
  if (!state.loaded) {
    hero.className = 'hero tone-ok';
    hero.innerHTML = '<p class="hero-label">讀取帳目中…</p>';
    return;
  }
  const s = state.summary;
  const cw = s.cw;
  const over = cw.remaining < 0;
  const tone = over ? 'over' : cw.status === '快用完' ? 'warn' : 'ok';
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.day : null;

  // 預算為什麼變了：之前超支分攤過來、這週前幾天超支、或省下的錢存起來
  const notes = [];
  if (cw.carry >= 0.5) notes.push(`之前超支的錢平均分攤下來，這週預算從 ${money(cw.base)} 調成 ${money(cw.budget)}。`);
  if (over) {
    notes.push(
      cw.spreadCount > 1
        ? `超支的 ${money(s.overNow)} 會平均分攤到後面 ${cw.spreadCount} 週，每週少約 ${money(s.overNow / cw.spreadCount)}。`
        : `超支的 ${money(s.overNow)} 會從下週預算扣掉。`,
    );
  } else if (s.cut >= 0.5) notes.push(`這週前幾天超支，每天預算從 ${money(s.weekDaily)} 調成 ${money(s.todayBudget)}。`);
  else if (s.savedThisWeek >= 0.5) notes.push(`前幾天省下的 ${money(s.savedThisWeek)} 會存起來，不加進每天預算。`);

  hero.className = `hero tone-${tone}`;
  hero.innerHTML = `
    <div class="hero-meta">
      <span>第 ${s.curWeek} 週</span>
      <span>${dayLabel(cw.start)} – ${dayLabel(cw.end)}</span>
    </div>
    <p class="hero-label">${over ? '本週已超支' : '本週還剩'}</p>
    <p class="hero-amount">${money(Math.abs(cw.remaining))}</p>
    <p class="hero-sub">${
      over
        ? `這週還有 ${s.daysLeft} 天（含今天）。`
        : `含今天還有 ${s.daysLeft} 天，每天預算 <b>${money(s.todayBudget)}</b>`
    }</p>
    <div class="hero-adjust">${notes.map((n) => `<p>${n}</p>`).join('')}</div>
    <div class="meter" role="meter" aria-label="本週已花" aria-valuemin="0" aria-valuemax="${Math.max(0, cw.budget)}" aria-valuenow="${cw.spent}">
      <span style="width:${cw.rate == null ? 100 : Math.min(100, cw.rate * 100)}%"></span>
    </div>
    <p class="meter-text">已花 ${money(cw.spent)}，預算 ${money(cw.budget)}${cw.rate == null ? '' : `（${pct(cw.rate)}）`}</p>
    <ol class="strip" aria-label="本週每天花費，虛線是當天預算">
      ${s.days.map(dayCell).join('')}
    </ol>
    ${
      s.curWeek > state.settings.totalWeeks
        ? `<p class="hero-note">已經超過計畫的 ${state.settings.totalWeeks} 週。要開始新的週期，到「設定」改第一週開始日。</p>`
        : ''
    }`;
  if (focused) {
    const btn = hero.querySelector(`[data-day="${focused}"]`);
    if (btn) btn.focus();
  }
}

function dayCell(d) {
  const sel = d.date === state.selDay;
  // 長條的刻度固定是平常每日預算的兩倍；虛線是當天預算，補超支的日子虛線會變低
  const scale = state.summary.dailyBase * 2;
  const h = scale > 0 ? Math.min(100, (d.spent / scale) * 100) : 0;
  const line = scale > 0 ? Math.min(100, (d.budget / scale) * 100) : 50;
  const over = !d.isFuture && d.spent > d.budget + 0.005;
  const cls = ['day', sel && 'is-sel', d.isToday && 'is-today', d.isFuture && 'is-future', over && 'is-over']
    .filter(Boolean)
    .join(' ');
  return `<li><button type="button" class="${cls}" data-day="${d.date}" aria-pressed="${sel}"
      aria-label="${dayLabel(d.date)}，當天預算 ${money(d.budget)}，花了 ${money(d.spent)}">
    <span class="day-wd">${d.isToday ? '今天' : d.weekday}</span>
    <span class="day-bar" aria-hidden="true" style="--line:${line}%"><span style="height:${h}%"></span></span>
    <span class="day-date">${C.shortDate(d.date)}</span>
    <span class="day-amt">${d.spent ? money(d.spent) : '–'}</span>
  </button></li>`;
}

function entryItem(e) {
  return `<li><button type="button" class="entry" data-id="${esc(e.id)}">
    <span class="entry-main">
      <span class="entry-item">${esc(e.item || e.category || '（沒有品項）')}</span>
      <span class="entry-meta">
        ${e.category ? `<span class="tag">${esc(e.category)}</span>` : ''}
        ${e.payment ? `<span>${esc(e.payment)}</span>` : ''}
        ${e.note ? `<span class="entry-note">${esc(e.note)}</span>` : ''}
      </span>
    </span>
    <span class="entry-amt">${money(e.amount)}</span>
  </button></li>`;
}

function renderDay() {
  const d = state.selDay;
  const list = state.entries.filter((e) => e.date === d).sort(byTime);
  const spent = list.reduce((a, e) => a + e.amount, 0);
  const b = state.summary.dayBudget.get(d); // 只有本週和過去的日子有當天預算
  const isFuture = d > state.today;
  let sum;
  if (d === state.today && b != null) {
    const left = b - spent;
    sum =
      `今天預算 ${money(b)}${list.length ? `，花了 ${money(spent)}` : ''}，` +
      (left > -0.5 ? `還可以花 <b class="pos">${money(left)}</b>` : `超出 <b class="neg">${money(-left)}</b>`);
  } else if (isFuture) sum = '這天還沒到。';
  else if (!list.length) sum = '這天還沒有記帳。';
  else if (b == null) sum = `花了 ${money(spent)}`;
  else if (spent > b + 0.005) sum = `花了 ${money(spent)}，比當天預算 ${money(b)} 多 <b class="neg">${money(spent - b)}</b>`;
  else if (spent < b - 0.005) sum = `花了 ${money(spent)}，比當天預算 ${money(b)} 少 <b class="pos">${money(b - spent)}</b>`;
  else sum = `花了 ${money(spent)}，剛好是當天預算`;
  const title = d === state.today ? `今天 ${dayLabel(d)}` : dayLabel(d);
  $('dayHead').innerHTML = `
    <h2>${title}</h2>
    <p class="day-sum">${sum}</p>`;
  $('dayList').innerHTML = state.loaded ? list.map(entryItem).join('') : '';
  renderJournal();
}

/* ---------- 心得（每天一則，自動儲存） ---------- */

let journalTimer = null;
let journalPending = null;

function renderJournal() {
  const ta = $('journal');
  $('journalLabel').textContent = state.selDay === state.today ? '今天的心得' : `${dayLabel(state.selDay)}的心得`;
  if (document.activeElement !== ta && !journalPending) ta.value = state.journal[state.selDay] || '';
}

function queueJournal() {
  journalPending = { date: state.selDay, text: $('journal').value };
  $('journalState').textContent = '儲存中…';
  clearTimeout(journalTimer);
  journalTimer = setTimeout(flushJournal, 700);
}

function flushJournal() {
  clearTimeout(journalTimer);
  if (!journalPending) return;
  const { date, text } = journalPending;
  journalPending = null;
  state.journal[date] = text;
  state.store
    .setJournal(date, text)
    .then(() => ($('journalState').textContent = '已儲存'))
    .catch(onDbError);
  if (state.store.mode === 'firebase' && !navigator.onLine) $('journalState').textContent = '已存在這台裝置，連線後同步';
}

function selectDay(date) {
  if (!date) return;
  flushJournal();
  state.selDay = date;
  $('fDate').value = date;
  $('journalState').textContent = '';
  renderHero();
  renderDay();
}

/* ---------- 記一筆 ---------- */

function chipGroup(name, values, selected) {
  return values
    .map(
      (v) => `<label class="chip"><input type="radio" name="${name}" value="${esc(v)}" ${v === selected ? 'checked' : ''}><span>${esc(v)}</span></label>`,
    )
    .join('');
}

function checkedValue(name) {
  const el = document.querySelector(`#addForm input[name="${name}"]:checked`);
  return el ? el.value : '';
}

function setChecked(name, value) {
  for (const el of document.querySelectorAll(`#addForm input[name="${name}"]`)) el.checked = el.value === value;
}

function renderChips() {
  const { categories, payments } = state.settings;
  const sig = JSON.stringify([categories, payments]);
  if (sig === state.chipsSig) return;
  state.chipsSig = sig;
  const cat = checkedValue('category');
  const pay = checkedValue('payment') || pref.get('payment') || payments[0] || '';
  $('catChips').innerHTML = chipGroup('category', categories, cat);
  $('payChips').innerHTML = chipGroup('payment', payments, pay);
}

function renderSuggestions() {
  const count = new Map();
  for (const e of state.entries) if (e.item) count.set(e.item, (count.get(e.item) || 0) + 1);
  const items = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  $('itemSuggest').innerHTML = items.map(([v]) => `<option value="${esc(v)}">`).join('');
}

/** 輸入以前記過的品項，自動帶入上次的分類和付款方式 */
function autofillFromItem() {
  const item = $('fItem').value.trim();
  if (!item) return;
  const last = state.entries.filter((e) => e.item === item).sort(byTime).pop();
  if (!last) return;
  if (!checkedValue('category') && last.category) setChecked('category', last.category);
  if (last.payment) setChecked('payment', last.payment);
}

function addEntry(ev) {
  ev.preventDefault();
  const msg = $('formMsg');
  const amount = Number($('fAmount').value);
  const category = checkedValue('category');
  const date = $('fDate').value || state.today;
  if (!$('fAmount').value || !(amount > 0)) {
    msg.textContent = '請輸入金額。';
    $('fAmount').focus();
    return;
  }
  if (!category) {
    msg.textContent = '請選一個分類。';
    return;
  }
  if (!C.isDateStr(date)) {
    msg.textContent = '日期格式不對。';
    return;
  }
  msg.textContent = '';
  const payment = checkedValue('payment');
  const data = { date, item: $('fItem').value, category, amount, payment, note: $('fNote').value };
  const { id, done } = state.store.addEntry(data);
  done.catch(onDbError);
  if (payment) pref.set('payment', payment);

  $('fAmount').value = '';
  $('fItem').value = '';
  $('fNote').value = '';
  setChecked('category', '');
  if (date !== state.selDay) selectDay(date);
  toast(`已記下 ${data.item.trim() || category} ${money(amount)}`, '復原', () => {
    state.store.deleteEntry(id).catch(onDbError);
    toast('已復原');
  });
  $('fAmount').focus();
}

/* ---------- 編輯 / 刪除 ---------- */

function options(values, current) {
  const list = current && !values.includes(current) ? [...values, current] : values;
  return ['', ...list].map((v) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${v ? esc(v) : '（無）'}</option>`).join('');
}

function openEdit(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  state.editId = id;
  $('eAmount').value = e.amount;
  $('eDate').value = e.date;
  $('eItem').value = e.item || '';
  $('eNote').value = e.note || '';
  $('eCat').innerHTML = options(state.settings.categories, e.category);
  $('ePay').innerHTML = options(state.settings.payments, e.payment);
  $('editMsg').textContent = '';
  disarmDelete();
  $('editDialog').showModal();
}

let deleteArmTimer = null;
function disarmDelete() {
  clearTimeout(deleteArmTimer);
  const b = $('deleteBtn');
  b.textContent = '刪除';
  b.classList.remove('armed');
}

function onDelete() {
  const b = $('deleteBtn');
  if (!b.classList.contains('armed')) {
    b.textContent = '確定刪除？';
    b.classList.add('armed');
    deleteArmTimer = setTimeout(disarmDelete, 4000);
    return;
  }
  const e = state.entries.find((x) => x.id === state.editId);
  $('editDialog').close();
  if (!e) return;
  state.store.deleteEntry(e.id).catch(onDbError);
  toast(`已刪除 ${e.item || e.category} ${money(e.amount)}`, '復原', () => {
    state.store.addEntry(e).done.catch(onDbError);
    toast('已復原');
  });
}

function saveEdit(ev) {
  ev.preventDefault();
  const amount = Number($('eAmount').value);
  const date = $('eDate').value;
  if (!$('eAmount').value || !(amount > 0)) {
    $('editMsg').textContent = '請輸入金額。';
    return;
  }
  if (!C.isDateStr(date)) {
    $('editMsg').textContent = '請選日期。';
    return;
  }
  state.store
    .updateEntry(state.editId, {
      date,
      amount,
      item: $('eItem').value,
      category: $('eCat').value,
      payment: $('ePay').value,
      note: $('eNote').value,
    })
    .catch(onDbError);
  $('editDialog').close();
  toast('已更新');
}

/* ---------- 明細 ---------- */

function renderList() {
  const s = state.summary;
  const start = state.settings.startDate;
  const weeksWithData = new Set(state.entries.map((e) => C.weekOf(e.date, start)));
  const chips = [['all', '全部']];
  for (let w = 1; w <= s.nWeeks; w++) if (w <= s.curWeek || weeksWithData.has(w)) chips.push([String(w), `第 ${w} 週`]);
  if (!chips.some(([k]) => k === state.listWeek)) state.listWeek = 'all';
  $('weekFilter').innerHTML = chips
    .map(([k, label]) => `<button type="button" class="chip-btn" data-week="${k}" aria-pressed="${k === state.listWeek}">${label}</button>`)
    .join('');

  const inRange = (d) => state.listWeek === 'all' || String(C.weekOf(d, start)) === state.listWeek;
  const groups = new Map();
  for (const e of state.entries) {
    if (!inRange(e.date)) continue;
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date).push(e);
  }
  for (const [d, t] of Object.entries(state.journal)) if (t && inRange(d) && !groups.has(d)) groups.set(d, []);

  const dates = [...groups.keys()].sort().reverse();
  if (!dates.length) {
    $('listBody').innerHTML = `<p class="empty">${state.loaded ? '這段期間還沒有帳目。到「記帳」記第一筆。' : '讀取中…'}</p>`;
    return;
  }
  const total = dates.reduce((a, d) => a + groups.get(d).reduce((x, e) => x + e.amount, 0), 0);
  $('listBody').innerHTML =
    `<p class="list-total">共 ${dates.length} 天，${money(total)}</p>` +
    dates
      .map((d) => {
        const list = groups.get(d).sort(byTime);
        const sum = list.reduce((a, e) => a + e.amount, 0);
        const j = state.journal[d];
        return `<section class="day-group">
          <h3><button type="button" class="link" data-goto="${d}">${d === state.today ? '今天 ' : ''}${dayLabel(d)}</button><span>${money(sum)}</span></h3>
          <ul class="entry-list">${list.map(entryItem).join('')}</ul>
          ${j ? `<p class="journal-note">${esc(j)}</p>` : ''}
        </section>`;
      })
      .join('');
}

/* ---------- 統計 ---------- */

const statusBadge = (s) => (s ? `<span class="badge badge-${{ OK: 'ok', 快用完: 'warn', 超支: 'over' }[s]}">${s}</span>` : '');

function renderStats() {
  const s = state.summary;
  $('weekTable').innerHTML = `
    <thead><tr><th>週次</th><th class="num">預算</th><th class="num">已花</th><th class="num">剩餘</th><th>狀態</th></tr></thead>
    <tbody>${s.weeks
      .map(
        (w) => `<tr class="${w.isCurrent ? 'is-current' : ''}">
          <td><span class="wk">第 ${w.week} 週${w.isCurrent ? '<span class="sr-only">（本週）</span>' : ''}</span><span class="range">${C.shortDate(w.start)}–${C.shortDate(w.end)}</span></td>
          <td class="num">${money(w.budget)}${w.carry ? `<span class="cut">扣 ${money(w.carry)}</span>` : ''}</td>
          <td class="num">${money(w.spent)}</td>
          <td class="num ${w.remaining < 0 ? 'neg' : ''}">${money(w.remaining)}${
            w.spreadCount ? `<span class="cut">${w.spreadCount > 1 ? `分到後 ${w.spreadCount} 週` : '扣到下週'}</span>` : ''
          }</td>
          <td>${statusBadge(w.status)}</td>
        </tr>`,
      )
      .join('')}</tbody>
    <tfoot><tr><th>合計</th><td class="num">${money(s.totals.planned)}</td><td class="num">${money(s.totals.spent)}</td>
      <td colspan="2" class="saved">已存下 ${money(s.totals.saved)}</td></tr></tfoot>`;

  const m = C.categoryMatrix(state.entries, state.settings, s.nWeeks);

  // 範圍選單
  const ranges = [['cur', `本週（第 ${s.curWeek} 週）`], ['all', '全部週次']];
  for (let w = 1; w <= s.nWeeks; w++) if (w !== s.curWeek) ranges.push([String(w), `第 ${w} 週`]);
  if (!ranges.some(([k]) => k === state.catRange)) state.catRange = 'cur';
  $('catRange').innerHTML = ranges.map(([k, l]) => `<option value="${k}" ${k === state.catRange ? 'selected' : ''}>${l}</option>`).join('');

  const pick = (r) =>
    state.catRange === 'all' ? r.total : r.perWeek[(state.catRange === 'cur' ? s.curWeek : Number(state.catRange)) - 1] || 0;
  const rows = m.rows.map((r) => ({ cat: r.category, v: pick(r) })).filter((r) => r.v !== 0).sort((a, b) => b.v - a.v);
  const sum = rows.reduce((a, r) => a + r.v, 0);
  const max = rows.length ? rows[0].v : 1;
  $('catBars').innerHTML = rows.length
    ? rows
        .map(
          (r) => `<li>
            <span class="cat-name">${esc(r.cat)}</span>
            <span class="cat-track" aria-hidden="true"><span style="width:${(r.v / max) * 100}%"></span></span>
            <span class="cat-val">${money(r.v)}</span>
            <span class="cat-pct">${pct(sum ? r.v / sum : 0)}</span>
          </li>`,
        )
        .join('') + `<li class="cat-sum"><span class="cat-name">合計</span><span></span><span class="cat-val">${money(sum)}</span><span class="cat-pct"></span></li>`
    : '<li class="empty">這段期間沒有花費。</li>';

  // 分類 × 週
  const wk = Array.from({ length: s.nWeeks }, (_, i) => i + 1);
  $('catTable').innerHTML = `
    <thead><tr><th>分類</th>${wk.map((w) => `<th class="num ${w === s.curWeek ? 'is-current' : ''}">第${w}週</th>`).join('')}<th class="num">合計</th><th class="num">佔比</th></tr></thead>
    <tbody>${m.rows
      .map(
        (r) => `<tr><th>${esc(r.category)}</th>${r.perWeek
          .map((v, i) => `<td class="num ${i + 1 === s.curWeek ? 'is-current' : ''} ${v ? '' : 'zero'}">${v ? money(v) : '–'}</td>`)
          .join('')}<td class="num">${money(r.total)}</td><td class="num">${pct(r.share)}</td></tr>`,
      )
      .join('')}</tbody>
    <tfoot><tr><th>合計</th>${m.weekTotals.map((v, i) => `<td class="num ${i + 1 === s.curWeek ? 'is-current' : ''}">${money(v)}</td>`).join('')}<td class="num">${money(m.grand)}</td><td></td></tr></tfoot>`;
}

/* ---------- 設定 ---------- */

const lines = (txt) => [...new Set(txt.split('\n').map((x) => x.trim()).filter(Boolean))];

function fillSettingsForm() {
  const s = state.settings;
  const sig = JSON.stringify(s);
  if (sig === state.settingsSig) return;
  if ($('settingsForm').contains(document.activeElement)) return; // 正在改，不要蓋掉
  state.settingsSig = sig;
  $('sBudget').value = s.weeklyBudget;
  $('sStart').value = s.startDate;
  $('sWeeks').value = s.totalWeeks;
  $('sCats').value = s.categories.join('\n');
  $('sPays').value = s.payments.join('\n');
}

function saveSettings(ev) {
  ev.preventDefault();
  const msg = $('settingsMsg');
  const s = {
    weeklyBudget: Number($('sBudget').value),
    startDate: $('sStart').value,
    totalWeeks: parseInt($('sWeeks').value, 10),
    categories: lines($('sCats').value),
    payments: lines($('sPays').value),
  };
  if (!(s.weeklyBudget >= 0) || $('sBudget').value === '') return void (msg.textContent = '每週預算要填數字。');
  if (!C.isDateStr(s.startDate)) return void (msg.textContent = '請選第一週開始日。');
  if (!(s.totalWeeks >= 1 && s.totalWeeks <= 104)) return void (msg.textContent = '計畫週數填 1 到 104。');
  if (!s.categories.length) return void (msg.textContent = '至少要有一個分類。');
  msg.textContent = '';
  state.settingsSig = '';
  document.activeElement.blur();
  saveSettingsPatch(s);
  toast('設定已儲存');
}

/** 設定是同一份文件（含固定支出），只改其中幾項，其他保留 */
function saveSettingsPatch(patch) {
  state.store.saveSettings({ ...state.settings, ...patch }).catch(onDbError);
}

function renderAccount() {
  const local = state.store.mode === 'local';
  $('accountInfo').textContent = local
    ? '示範模式：資料存在這個瀏覽器，不會同步。照 README 填好 Firebase 設定後就會改成登入模式。'
    : `已用 ${state.user.email} 登入。`;
  $('signOutBtn').hidden = local;
  $('clearDemoBtn').hidden = !local;
}

/* ---------- 匯入 / 匯出 ---------- */

let pendingImport = null;

async function onImportFile(ev) {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const box = $('importPreview');
  box.hidden = false;
  let rec;
  try {
    const text = CSV.decodeFile(await file.arrayBuffer());
    rec = CSV.rowsToRecords(CSV.parseCSV(text));
  } catch (err) {
    box.innerHTML = `<p class="form-msg">讀不了這個檔案：${esc(err.message)}</p>`;
    return;
  }
  const key = (e) => `${e.date}|${(e.item || '').trim()}|${Number(e.amount)}`;
  const existing = new Set(state.entries.map(key));
  const dupes = rec.entries.filter((e) => existing.has(key(e)));
  const before = rec.entries.filter((e) => e.date < state.settings.startDate).length;
  // 心得：已經有一樣內容的就不重複；當天已有別的心得就接在後面
  const journals = {};
  for (const [d, t] of Object.entries(rec.journals)) {
    const old = state.journal[d] || '';
    if (!old.includes(t)) journals[d] = old ? `${old}\n${t}` : t;
  }
  const jCount = Object.keys(journals).length;
  const jTotal = Object.keys(rec.journals).length;
  pendingImport = { rec, key, existing, journals };

  box.innerHTML = `
    <p>「${esc(file.name)}」裡有 <b>${rec.entries.length}</b> 筆帳目${jTotal ? `、<b>${jTotal}</b> 則心得` : ''}。</p>
    ${rec.skipped.length ? `<p class="form-msg">有 ${rec.skipped.length} 列看不懂，會略過：</p><ul class="skip-list">${rec.skipped.slice(0, 6).map((x) => `<li>第 ${x.line} 列：${esc(x.reason)}</li>`).join('')}</ul>` : ''}
    ${dupes.length ? `<label class="check"><input type="checkbox" id="skipDup" checked> 略過 ${dupes.length} 筆已經有的帳目（日期、品項、金額都一樣）</label>` : ''}
    ${before ? `<p class="hint">其中 ${before} 筆早於第一週開始日（${state.settings.startDate}），匯入後不會出現在統計裡。</p>` : ''}
    <div class="btn-row">
      <button id="confirmImport" class="btn btn-primary" type="button">匯入</button>
      <button id="cancelImport" class="btn btn-ghost" type="button">取消</button>
    </div>`;
  const updateBtn = () => {
    const n = importList().length;
    const parts = [n && `${n} 筆帳目`, jCount && `${jCount} 則心得`].filter(Boolean);
    $('confirmImport').textContent = parts.length ? `匯入 ${parts.join('和')}` : '沒有新資料可以匯入';
    $('confirmImport').disabled = !parts.length;
  };
  if ($('skipDup')) $('skipDup').onchange = updateBtn;
  $('confirmImport').onclick = doImport;
  $('cancelImport').onclick = () => {
    pendingImport = null;
    box.hidden = true;
  };
  updateBtn();
}

function importList() {
  const { rec, key, existing } = pendingImport;
  const skip = $('skipDup') && $('skipDup').checked;
  return skip ? rec.entries.filter((e) => !existing.has(key(e))) : rec.entries;
}

async function doImport() {
  if (!pendingImport) return;
  const entries = importList();
  const { journals } = pendingImport;
  const btn = $('confirmImport');
  btn.disabled = true;
  btn.textContent = '匯入中…';
  try {
    await state.store.importBatch(entries, journals);
    $('importPreview').innerHTML = `<p>已匯入 ${entries.length} 筆帳目${Object.keys(journals).length ? `和 ${Object.keys(journals).length} 則心得` : ''}。</p>`;
    pendingImport = null;
  } catch (err) {
    onDbError(err);
    btn.disabled = false;
    btn.textContent = '再試一次';
  }
}

async function exportCSV() {
  const btn = $('exportBtn');
  btn.disabled = true;
  try {
    const { entries, journal } = await state.store.fetchAll();
    const start = state.settings.startDate;
    const csv = CSV.toCSV(entries, journal, (d) => {
      const w = C.weekOf(d, start);
      return w >= 1 ? w : '';
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget_${state.today}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1000);
    toast(`已匯出 ${entries.length} 筆`);
  } catch (err) {
    onDbError(err);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 跨日 ---------- */

function checkToday() {
  const t = C.todayStr();
  if (t === state.today) return;
  const wasToday = state.selDay === state.today;
  state.today = t;
  if (wasToday) {
    state.selDay = t;
    $('fDate').value = t;
  }
  weightView.onDayChange();
  renderAll();
}

/* ---------- 綁定事件 ---------- */

let weightView = null;
let monthView = null;

function bindUI() {
  weightView = createWeightView({ state, $, esc, toast, onDbError, dayLabel });
  monthView = createMonthView({ state, $, esc, toast, onDbError, money, saveSettingsPatch });

  // 統計：每週 / 每月（記住這台裝置上次選的）
  const setStatsMode = (mode) => {
    state.statsMode = mode === 'month' ? 'month' : 'week';
    pref.set('smode', state.statsMode);
    for (const b of document.querySelectorAll('[data-smode]')) b.setAttribute('aria-pressed', String(b.dataset.smode === state.statsMode));
    $('statsWeek').hidden = state.statsMode !== 'week';
    $('statsMonth').hidden = state.statsMode !== 'month';
    if (state.view === 'stats') renderAll();
  };
  for (const b of document.querySelectorAll('[data-smode]')) b.addEventListener('click', () => setStatsMode(b.dataset.smode));
  setStatsMode(pref.get('smode') || 'week');
  $('signInBtn').onclick = signIn;
  $('signOutBtn').onclick = () => state.store.signOut();
  $('clearDemoBtn').onclick = () => {
    const b = $('clearDemoBtn');
    if (!b.classList.contains('armed')) {
      b.classList.add('armed');
      b.textContent = '確定清除？';
      setTimeout(() => {
        b.classList.remove('armed');
        b.textContent = '清除示範資料';
      }, 4000);
      return;
    }
    state.store.clearDemo();
    b.classList.remove('armed');
    b.textContent = '清除示範資料';
    toast('示範資料已清除');
  };

  for (const b of document.querySelectorAll('.tabbar button')) b.onclick = () => setView(b.dataset.view);

  $('fDate').value = state.selDay;
  $('addForm').addEventListener('submit', addEntry);
  $('fItem').addEventListener('change', autofillFromItem);
  $('fDate').addEventListener('change', (e) => e.target.value && selectDay(e.target.value));
  $('hero').addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (b) selectDay(b.dataset.day);
  });

  $('journal').addEventListener('input', queueJournal);
  $('journal').addEventListener('blur', flushJournal);

  document.addEventListener('click', (e) => {
    const entry = e.target.closest('.entry[data-id]');
    if (entry) return openEdit(entry.dataset.id);
    const goto = e.target.closest('[data-goto]');
    if (goto) {
      setView('home');
      selectDay(goto.dataset.goto);
      return;
    }
    const wk = e.target.closest('[data-week]');
    if (wk) {
      state.listWeek = wk.dataset.week;
      renderList();
    }
  });

  $('editForm').addEventListener('submit', saveEdit);
  $('deleteBtn').onclick = onDelete;
  $('cancelEdit').onclick = () => $('editDialog').close();
  $('editDialog').addEventListener('click', (e) => {
    if (e.target === $('editDialog')) $('editDialog').close();
  });

  $('catRange').onchange = (e) => {
    state.catRange = e.target.value;
    renderStats();
  };

  $('settingsForm').addEventListener('submit', saveSettings);
  $('importFile').addEventListener('change', onImportFile);
  $('exportBtn').onclick = exportCSV;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkToday();
    else flushJournal();
  });
  window.addEventListener('pagehide', flushJournal);
  setInterval(checkToday, 60000);
}

boot();
