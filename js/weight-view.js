// 「體重」分頁：目標設定、每天登記體重和腰圍、圖表、每週目標、紀錄

import * as C from './calc.js';
import { weightSummary, validateGoal, round1 } from './weight.js';

const fmt = (n) => round1(n).toFixed(1);
const kg = (n) => `${fmt(n)} kg`;
const cm = (n) => `${fmt(n)} cm`;
const pct = (r) => `${Math.round(r * 100)}%`;
const has = (v) => typeof v === 'number' && Number.isFinite(v);

export function createWeightView({ state, $, esc, toast, onDbError, dayLabel }) {
  let s = null; // 最近一次的體重計算結果
  let formDirty = false;
  let goalSig = '';
  let range = 'recent'; // 圖表範圍

  const store = () => state.store;
  const recordOn = (date) => state.weights.find((r) => r.date === date);
  const waistRecords = () => state.weights.filter((r) => has(r.waist)).sort((a, b) => a.date.localeCompare(b.date));

  /** 「體重 79.3 kg、腰圍 82.0 cm」 */
  const describe = (m) =>
    [has(m.weight) ? `體重 ${kg(m.weight)}` : '', has(m.waist) ? `腰圍 ${cm(m.waist)}` : ''].filter(Boolean).join('、');

  /* ---------- 整頁 ---------- */

  function render() {
    if (state.view !== 'weight' || !state.user) return;
    const goal = state.weightGoal;
    const box = $('wGoalBox');

    if (!state.weightLoaded) {
      $('wHero').hidden = false;
      $('wHero').className = 'hero tone-ok';
      $('wHero').innerHTML = '<p class="hero-label">讀取中…</p>';
      $('wBody').hidden = $('wTables').hidden = box.hidden = true;
      return;
    }
    box.hidden = false;

    if (!goal) {
      $('wHero').hidden = $('wBody').hidden = $('wTables').hidden = true;
      box.open = true;
      $('wGoalSummary').textContent = '設定減重目標';
      $('wGoalIntro').textContent = '填好現在體重、目標體重和目標日期，會幫你算出每週要減多少。';
      fillGoalForm(null);
      return;
    }

    $('wHero').hidden = $('wBody').hidden = $('wTables').hidden = false;
    $('wGoalSummary').textContent = '調整目標';
    $('wGoalIntro').textContent = '';
    fillGoalForm(goal);

    s = weightSummary(goal, state.weights, state.today);
    renderHero();
    syncForm();
    renderCharts();
    renderWeeks();
    renderList();
  }

  /* ---------- 上方色塊 ---------- */

  function renderHero() {
    const g = s.goal;
    const behind = s.hasAvg && s.diff >= 0.5;
    const reached = s.remainingLoss <= 0;
    let label = '起始體重';
    if (s.hasAvg) label = s.avgCount > 1 ? '目前（7 天平均）' : '目前（最新一筆）';

    let sub;
    if (reached) sub = `已經達到目標體重 ${kg(g.targetWeight)}`;
    else if (s.daysLeft > 0) sub = `還要減 ${kg(s.remainingLoss)}，計畫每週減 <b>${kg(s.perWeek)}</b>`;
    else sub = `目標日期已經過了，還差 ${kg(s.remainingLoss)}`;

    const notes = [];
    if (s.hasAvg && !reached) {
      if (s.diff <= -0.05) notes.push(`比計畫超前 ${kg(-s.diff)}。`);
      else if (s.diff >= 0.05) notes.push(`比計畫落後 ${kg(s.diff)}。`);
      else notes.push('跟計畫差不多。');
      if (s.requiredPerWeek != null && Math.abs(s.requiredPerWeek - s.perWeek) >= 0.05) {
        notes.push(`照現在的進度，接下來每週要減 ${kg(s.requiredPerWeek)}，才會在 ${C.shortDate(g.targetDate)} 達標。`);
      }
    }
    if (!reached) {
      if (s.tooFast) notes.push(`每週減 ${kg(s.perWeek)} 比一般建議的上限（約每週 ${kg(s.fastLimit)}）快，可以考慮把目標日期往後延。`);
      else if (s.requiredTooFast) notes.push(`接下來需要的速度比一般建議的上限（約每週 ${kg(Math.min(1, s.current * 0.01))}）快，可以考慮把目標日期往後延。`);
    }

    // 腰圍：最新一次，和第一次比
    const ws = waistRecords().filter((r) => r.date <= state.today);
    if (ws.length) {
      const first = ws[0];
      const last = ws[ws.length - 1];
      const ch = round1(last.waist - first.waist);
      notes.push(
        ws.length > 1 && first !== last
          ? `腰圍 ${cm(last.waist)}，比 ${C.shortDate(first.date)} ${ch < 0 ? `少 ${fmt(-ch)}` : ch > 0 ? `多 ${fmt(ch)}` : '一樣'}${ch ? ' cm' : ''}。`
          : `腰圍 ${cm(last.waist)}。`,
      );
    }

    const hero = $('wHero');
    hero.className = `hero tone-${behind ? 'warn' : 'ok'}`;
    hero.innerHTML = `
      <div class="hero-meta">
        <span>目標 ${kg(g.targetWeight)}</span>
        <span>${dayLabel(g.startDate)} – ${dayLabel(g.targetDate)}</span>
      </div>
      <p class="hero-label">${label}</p>
      <p class="hero-amount">${fmt(s.current)}<span class="unit">kg</span></p>
      <p class="hero-sub">${sub}</p>
      <div class="hero-adjust">${notes.map((n) => `<p>${n}</p>`).join('')}</div>
      <div class="meter" role="meter" aria-label="減重進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(s.progress * 100)}">
        <span style="width:${s.progress * 100}%"></span>
      </div>
      <p class="meter-text">已減 ${kg(Math.max(0, s.lost))}，總共要減 ${kg(s.totalLoss)}（${pct(s.progress)}）${
        s.daysLeft > 0 ? `，剩 ${s.daysLeft} 天` : ''
      }</p>`;
  }

  /* ---------- 記體重、腰圍 ---------- */

  function syncForm() {
    const dateEl = $('wDate');
    if (!dateEl.value) dateEl.value = state.today;
    const rec = recordOn(dateEl.value);
    const w = $('wWeight');
    const z = $('wWaist');
    const editing = document.activeElement === w || document.activeElement === z;
    if (!formDirty && !editing) {
      w.value = rec && has(rec.weight) ? fmt(rec.weight) : '';
      z.value = rec && has(rec.waist) ? fmt(rec.waist) : '';
    }
    const lastW = [...state.weights].filter((r) => has(r.weight)).sort((a, b) => a.date.localeCompare(b.date)).pop();
    const lastZ = waistRecords().pop();
    w.placeholder = lastW ? fmt(lastW.weight) : '';
    z.placeholder = lastZ ? fmt(lastZ.waist) : '';
    $('wFormHint').textContent = rec ? `這天已經記過${describe(rec)}，再存一次會覆蓋。` : '';
    $('wDelete').hidden = !rec;
    disarmDelete();
  }

  function onSubmit(ev) {
    ev.preventDefault();
    const date = $('wDate').value;
    const wv = $('wWeight').value.trim();
    const zv = $('wWaist').value.trim();
    const msg = $('wFormMsg');
    if (!C.isDateStr(date)) return void (msg.textContent = '請選日期。');
    if (!wv && !zv) {
      $('wWeight').focus();
      return void (msg.textContent = '請填體重或腰圍，至少一個。');
    }
    const weight = wv ? Number(wv) : null;
    const waist = zv ? Number(zv) : null;
    if (weight != null && !(weight >= 20 && weight <= 400)) {
      $('wWeight').focus();
      return void (msg.textContent = '體重請填 20～400 公斤。');
    }
    if (waist != null && !(waist >= 30 && waist <= 250)) {
      $('wWaist').focus();
      return void (msg.textContent = '腰圍請填 30～250 公分。');
    }
    msg.textContent = '';
    const m = { weight: weight != null ? round1(weight) : null, waist: waist != null ? round1(waist) : null };
    store().setMeasure(date, m).catch(onDbError);
    formDirty = false;
    toast(`已記下 ${dayLabel(date)} ${describe(m)}`);
  }

  let armTimer = null;
  function disarmDelete() {
    clearTimeout(armTimer);
    const b = $('wDelete');
    b.classList.remove('armed');
    b.textContent = '刪除這天';
  }

  function onDelete() {
    const b = $('wDelete');
    const date = $('wDate').value;
    const rec = recordOn(date);
    if (!rec) return;
    if (!b.classList.contains('armed')) {
      b.classList.add('armed');
      b.textContent = '確定刪除？';
      armTimer = setTimeout(disarmDelete, 4000);
      return;
    }
    formDirty = false;
    store().deleteMeasure(date).catch(onDbError);
    toast(`已刪除 ${dayLabel(date)} 的紀錄`, '復原', () => {
      store().setMeasure(date, { weight: rec.weight, waist: rec.waist }).catch(onDbError);
      toast('已復原');
    });
  }

  /* ---------- 圖表 ---------- */

  /** 兩張圖共用的日期範圍：近期 = 最近約 5 週（到今天後 7 天）；整個計畫 = 開始日到目標日 */
  function chartRange() {
    const g = s.goal;
    const dS = C.toDays(g.startDate);
    const dT = C.toDays(g.targetDate);
    const tD = C.toDays(state.today);
    const lastRec = state.weights.length ? Math.max(...state.weights.map((r) => C.toDays(r.date))) : dS;
    if (range === 'all') return { d0: dS, d1: Math.max(dT, lastRec, dS + 1) };
    let d1 = Math.max(tD, lastRec) + 7;
    const d0 = Math.max(dS, d1 - 35);
    d1 = Math.max(d1, d0 + 14);
    return { d0, d1 };
  }

  function renderCharts() {
    const g = s.goal;
    const { d0, d1 } = chartRange();
    const dT = C.toDays(g.targetDate);
    const inView = (d) => d >= d0 && d <= d1;

    // 體重：每天（空心點）、7 天平均（實線）、計畫（虛線）
    const shown = s.records.filter((r) => inView(C.toDays(r.date)));
    const planDays = [d0, ...(dT > d0 && dT < d1 ? [dT] : []), d1];
    drawChart($('wChart'), {
      d0,
      d1,
      height: null,
      dots: shown.map((r) => ({ d: C.toDays(r.date), v: r.weight })),
      line: shown.map((r) => ({ d: C.toDays(r.date), v: s.avg7(r.date).avg })),
      plan: planDays.map((d) => ({ d, v: s.planAt(C.fromDays(d)) })),
      mark: inView(dT) ? { d: dT, v: g.targetWeight, text: `目標 ${fmt(g.targetWeight)}` } : null,
      aria: '體重變化圖：每天體重、7 天平均和計畫線',
      tip(date) {
        const rec = recordOn(date);
        const a = rec && has(rec.weight) ? s.avg7(date) : null;
        return `<b>${dayLabel(date)}</b>${rec && has(rec.weight) ? `<span>當天 ${kg(rec.weight)}</span>` : ''}${
          a ? `<span>7 天平均 ${kg(a.avg)}</span>` : ''
        }<span>計畫 ${kg(s.planAt(date))}</span>`;
      },
      anyDay: true,
    });

    // 腰圍：有記過才顯示；點連成線
    const ws = waistRecords();
    $('wWaistBox').hidden = !ws.length;
    if (!ws.length) return;
    const wShown = ws.filter((r) => inView(C.toDays(r.date)));
    const pts = wShown.map((r) => ({ d: C.toDays(r.date), v: r.waist }));
    drawChart($('wWaistChart'), {
      d0,
      d1,
      height: 160,
      dots: pts,
      line: pts,
      plan: null,
      mark: null,
      aria: '腰圍變化圖',
      empty: '這段期間沒有腰圍紀錄，切到「整個計畫」看看。',
      tip(date) {
        const rec = recordOn(date);
        return `<b>${dayLabel(date)}</b><span>腰圍 ${cm(rec.waist)}</span>`;
      },
      anyDay: false,
    });
  }

  /**
   * 畫一張折線圖（x = 日期、y = 數值，只有一個 y 軸）
   * o: {d0, d1, height, dots:[{d,v}], line:[{d,v}], plan:[{d,v}]|null, mark:{d,v,text}|null, aria, tip(date), anyDay, empty}
   */
  function drawChart(el, o) {
    const W = Math.max(280, Math.round(el.clientWidth || 600));
    const H = o.height || (W < 520 ? 220 : 260);
    const m = { l: 40, r: 14, t: 14, b: 28 };
    const { d0, d1 } = o;
    const tD = C.toDays(state.today);

    const vals = [...o.dots.map((p) => p.v), ...o.line.map((p) => p.v), ...(o.plan || []).map((p) => p.v)];
    if (!vals.length) {
      el.innerHTML = `<p class="empty">${o.empty || '沒有資料。'}</p>`;
      return;
    }
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const step = [0.5, 1, 2, 5, 10, 20].find((st) => (hi - lo) / st <= 4) || 20;
    lo = Math.floor((lo - step * 0.3) / step) * step;
    hi = Math.ceil((hi + step * 0.3) / step) * step;
    if (hi - lo < step * 2) hi = lo + step * 2;

    const x = (d) => m.l + ((d - d0) / (d1 - d0)) * (W - m.l - m.r);
    const y = (v) => m.t + ((hi - v) / (hi - lo)) * (H - m.t - m.b);
    const pt = (p) => `${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`;

    let grid = '';
    for (let v = lo; v <= hi + 1e-9; v += step) {
      grid += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      grid += `<text class="tick" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${step < 1 ? v.toFixed(1) : v}</text>`;
    }
    const lab = (d) => (d === tD ? '今天' : C.shortDate(C.fromDays(d)));
    const xl = [[d0, lab(d0), 'start']];
    if (tD > d0 && tD < d1 && x(tD) - x(d0) > 44 && x(d1) - x(tD) > 44) xl.push([tD, '今天', 'middle']);
    xl.push([d1, lab(d1), 'end']);
    const xlab = xl.map(([d, t, a]) => `<text class="tick" x="${x(d)}" y="${H - 8}" text-anchor="${a}">${t}</text>`).join('');
    const todayLine = tD > d0 && tD < d1 ? `<line class="today" x1="${x(tD)}" x2="${x(tD)}" y1="${m.t}" y2="${H - m.b}"/>` : '';

    const plan = o.plan ? `<polyline class="plan" points="${o.plan.map(pt).join(' ')}"/>` : '';
    const mark = o.mark
      ? `<text class="label" x="${x(o.mark.d)}" y="${y(o.mark.v) + 16}" text-anchor="${o.mark.d > d1 - 7 ? 'end' : 'middle'}">${o.mark.text}</text>`
      : '';
    const line = o.line.length > 1 ? `<polyline class="avg" points="${o.line.map(pt).join(' ')}"/>` : '';
    const dots = o.dots.map((p) => `<circle class="day" cx="${x(p.d)}" cy="${y(p.v)}" r="4"/>`).join('');

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${o.aria}">
        ${grid}${todayLine}${plan}${line}${dots}${mark}${xlab}
        <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
        <rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}"/>
      </svg>
      <div class="w-tip" hidden></div>`;

    // 滑鼠移過 / 手指點：顯示最近一天的數字
    const svg = el.querySelector('svg');
    const cross = svg.querySelector('.cross');
    const tip = el.querySelector('.w-tip');
    const show = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const d = Math.round(d0 + ((px - m.l) / (W - m.l - m.r)) * (d1 - d0));
      let best = null;
      for (const p of o.dots) {
        const dd = Math.abs(p.d - d);
        if (!best || dd < best.dd) best = { p, dd };
      }
      let day;
      if (best && (best.dd <= 3 || !o.anyDay)) day = best.p.d;
      else if (o.anyDay) day = Math.min(Math.max(d, d0), d1);
      else return;
      const cx = x(day);
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.setAttribute('visibility', 'visible');
      tip.innerHTML = o.tip(C.fromDays(day));
      tip.hidden = false;
      const left = (cx / W) * r.width;
      tip.style.left = `${Math.min(Math.max(left, 70), r.width - 70)}px`;
      tip.style.top = `${(m.t / H) * r.height}px`;
    };
    const hide = () => {
      tip.hidden = true;
      cross.setAttribute('visibility', 'hidden');
    };
    const hit = svg.querySelector('.hit');
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
  }

  /* ---------- 每週目標 ---------- */

  function renderWeeks() {
    $('wWeeks').innerHTML = `
      <thead><tr><th>週次</th><th class="num">週末目標</th><th class="num">週平均</th><th>進度</th></tr></thead>
      <tbody>${s.weeks
        .map((w) => {
          let status = '';
          if (w.diff != null) {
            if (w.diff <= 0.05) status = `<span class="badge badge-ok">${w.diff <= -0.05 ? `超前 ${fmt(-w.diff)}` : '照計畫'}</span>`;
            else status = `<span class="badge badge-warn">落後 ${fmt(w.diff)}</span>`;
          }
          return `<tr class="${w.isCurrent ? 'is-current' : ''}">
            <td><span class="wk">第 ${w.week} 週${w.isCurrent ? '<span class="sr-only">（本週）</span>' : ''}</span><span class="range">${C.shortDate(w.start)}–${C.shortDate(w.end)}</span></td>
            <td class="num">${fmt(w.target)}</td>
            <td class="num ${w.avg == null ? 'zero' : ''}">${w.avg == null ? '–' : fmt(w.avg)}</td>
            <td>${status}</td>
          </tr>`;
        })
        .join('')}</tbody>`;
  }

  /* ---------- 紀錄 ---------- */

  function renderList() {
    const recs = [...state.weights].sort((a, b) => b.date.localeCompare(a.date));
    if (!recs.length) {
      $('wList').innerHTML = '<li class="empty">還沒有記錄。在上面記下今天的體重。</li>';
      return;
    }
    // 跟「前一次有記同一項」的那天比
    const prevOf = (i, key) => recs.slice(i + 1).find((r) => has(r[key]));
    const change = (now, prev, unit) => {
      if (!prev) return '';
      const ch = round1(now - prev);
      if (ch < 0) return `<span class="pos">少 ${fmt(-ch)}</span>`;
      if (ch > 0) return `<span class="neg">多 ${fmt(ch)}</span>`;
      return '<span>持平</span>';
    };
    $('wList').innerHTML = recs
      .map((r, i) => {
        const meta = [];
        const pw = prevOf(i, 'weight');
        const pz = prevOf(i, 'waist');
        if (has(r.weight) && pw) meta.push(`<span>比上次${change(r.weight, pw.weight)}</span>`);
        if (has(r.waist)) meta.push(`<span>腰圍 ${cm(r.waist)}${pz ? `（${change(r.waist, pz.waist)}）` : ''}</span>`);
        return `<li><button type="button" class="entry" data-wdate="${esc(r.date)}">
          <span class="entry-main">
            <span class="entry-item">${r.date === state.today ? '今天 ' : ''}${dayLabel(r.date)}</span>
            <span class="entry-meta w-meta">${meta.join('')}</span>
          </span>
          <span class="entry-amt">${has(r.weight) ? `${fmt(r.weight)}<span class="unit-sm"> kg</span>` : '<span class="unit-sm">沒量體重</span>'}</span>
        </button></li>`;
      })
      .join('');
  }

  /* ---------- 目標設定 ---------- */

  function fillGoalForm(goal) {
    const sig = JSON.stringify(goal);
    if (sig === goalSig || $('wGoalForm').contains(document.activeElement)) return;
    goalSig = sig;
    const latest = [...state.weights].filter((r) => has(r.weight)).sort((a, b) => a.date.localeCompare(b.date)).pop();
    $('gStartDate').value = goal ? goal.startDate : state.today;
    $('gStartWeight').value = goal ? fmt(goal.startWeight) : latest ? fmt(latest.weight) : '';
    $('gTargetDate').value = goal ? goal.targetDate : '';
    $('gTargetWeight').value = goal ? fmt(goal.targetWeight) : '';
    $('gMsg').textContent = '';
    preview();
  }

  function readGoal() {
    return {
      startDate: $('gStartDate').value,
      startWeight: round1(Number($('gStartWeight').value)),
      targetDate: $('gTargetDate').value,
      targetWeight: round1(Number($('gTargetWeight').value)),
    };
  }

  function preview() {
    const g = readGoal();
    const el = $('gPreview');
    if (validateGoal(g) || !$('gStartWeight').value || !$('gTargetWeight').value) {
      el.textContent = '';
      return;
    }
    const p = weightSummary(g, [], g.startDate);
    el.textContent =
      `總共要減 ${kg(p.totalLoss)}，${p.totalDays} 天（約 ${round1(p.totalDays / 7)} 週），每週約減 ${kg(p.perWeek)}。` +
      (p.tooFast ? `這比一般建議的上限（約每週 ${kg(p.fastLimit)}）快，可以考慮把目標日期往後延。` : '');
  }

  function onGoalSubmit(ev) {
    ev.preventDefault();
    const g = readGoal();
    const err = !$('gStartWeight').value || !$('gTargetWeight').value ? '請填現在體重和目標體重。' : validateGoal(g);
    if (err) return void ($('gMsg').textContent = err);
    $('gMsg').textContent = '';
    const old = state.weightGoal;
    store().saveWeightGoal(g).catch(onDbError);
    // 開始日那天的體重：沒記過，或還是舊目標自動填的值，就跟著更新（腰圍保留）
    const rec = recordOn(g.startDate);
    if (!rec || !has(rec.weight) || (old && old.startDate === g.startDate && rec.weight === old.startWeight)) {
      store().setMeasure(g.startDate, { weight: g.startWeight, waist: rec ? rec.waist : null }).catch(onDbError);
    }
    goalSig = '';
    document.activeElement.blur();
    $('wGoalBox').open = false;
    toast(old ? '目標已更新' : '目標已設定');
    window.scrollTo(0, 0);
  }

  /* ---------- 綁定事件 ---------- */

  $('wForm').addEventListener('submit', onSubmit);
  $('wWeight').addEventListener('input', () => (formDirty = true));
  $('wWaist').addEventListener('input', () => (formDirty = true));
  $('wDate').addEventListener('change', () => {
    formDirty = false;
    $('wFormMsg').textContent = '';
    if (s) syncForm();
  });
  $('wDelete').addEventListener('click', onDelete);
  $('wGoalForm').addEventListener('submit', onGoalSubmit);
  $('wGoalForm').addEventListener('input', preview);
  $('wList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wdate]');
    if (!b) return;
    $('wDate').value = b.dataset.wdate;
    formDirty = false;
    syncForm();
    $('wForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('wWeight').focus({ preventScroll: true });
  });
  for (const b of document.querySelectorAll('[data-wrange]')) {
    b.addEventListener('click', () => {
      range = b.dataset.wrange;
      for (const o of document.querySelectorAll('[data-wrange]')) o.setAttribute('aria-pressed', String(o === b));
      if (s) renderCharts();
    });
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.view === 'weight' && s && renderCharts(), 150);
  });

  return {
    render,
    onDayChange() {
      if ($('wDate').value && !formDirty) $('wDate').value = state.today;
    },
  };
}
