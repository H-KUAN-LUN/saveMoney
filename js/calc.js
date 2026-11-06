// 純計算邏輯：對應原本 Excel「每週總覽」「分類統計」的公式
// 日期一律用 'YYYY-MM-DD' 字串，以「天數」計算，避免時區造成差一天

export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const DAY_MS = 86400000;

const pad = (n) => String(n).padStart(2, '0');

export function toDays(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDays(n) {
  const dt = new Date(n * DAY_MS);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 本機時區的今天（不能用 toISOString，那是 UTC） */
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isDateStr(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '');
}

export function addDays(dateStr, n) {
  return fromDays(toDays(dateStr) + n);
}

export function weekdayOf(dateStr) {
  return WEEKDAYS[new Date(toDays(dateStr) * DAY_MS).getUTCDay()];
}

/** 11/5 → "11/5" */
export function shortDate(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
}

/** Excel：INT((日期 - 開始日) / 7) + 1 */
export function weekOf(dateStr, startStr) {
  return Math.floor((toDays(dateStr) - toDays(startStr)) / 7) + 1;
}

export function weekRange(week, startStr) {
  const s = toDays(startStr) + (week - 1) * 7;
  return { start: fromDays(s), end: fromDays(s + 6) };
}

/** Excel：IF(E=0,"",IF(E>D,"超支",IF(E>D*0.8,"快用完","OK"))) */
export function weekStatus(spent, budget) {
  if (spent === 0) return '';
  if (spent > budget) return '超支';
  if (spent > budget * 0.8) return '快用完';
  return 'OK';
}

/** 每日：超出 / 少於 / 剛好（未來的日子空白） */
export function dayStatus(spent, avg) {
  if (spent > avg) return '超出';
  if (spent < avg) return '少於';
  return '剛好';
}

const amountOf = (e) => Number(e.amount) || 0;

/**
 * 算出首頁與統計頁需要的全部數字
 * @param {Array} entries  [{date, amount, category, ...}]
 * @param {{weeklyBudget:number, startDate:string, totalWeeks:number}} settings
 * @param {string} today 'YYYY-MM-DD'
 */
export function computeSummary(entries, settings, today) {
  const budget = Number(settings.weeklyBudget) || 0;
  const start = settings.startDate;
  const curWeek = Math.max(1, weekOf(today, start));

  const byWeek = new Map();
  const byDate = new Map();
  let maxEntryWeek = 0;
  for (const e of entries) {
    const w = weekOf(e.date, start);
    if (w < 1) continue;
    maxEntryWeek = Math.max(maxEntryWeek, w);
    byWeek.set(w, (byWeek.get(w) || 0) + amountOf(e));
    byDate.set(e.date, (byDate.get(e.date) || 0) + amountOf(e));
  }

  const nWeeks = Math.max(Number(settings.totalWeeks) || 1, curWeek, maxEntryWeek);
  const dailyBase = budget / 7;

  // 每週預算：超支的部分從下週扣掉；沒花完的錢存起來，不加到下週
  const weeks = [];
  let debt = 0;
  for (let w = 1; w <= nWeeks; w++) {
    const spent = byWeek.get(w) || 0;
    const carry = debt;
    const wkBudget = budget - carry;
    const remaining = wkBudget - spent;
    weeks.push({
      week: w,
      ...weekRange(w, start),
      base: budget,
      carry,
      budget: wkBudget,
      spent,
      remaining,
      rate: wkBudget > 0 ? spent / wkBudget : null,
      status: weekStatus(spent, wkBudget),
      saved: w < curWeek ? Math.max(0, remaining) : 0,
      isCurrent: w === curWeek,
    });
    debt = Math.max(0, -remaining);
  }
  const totals = {
    planned: budget * nWeeks,
    spent: weeks.reduce((s, w) => s + w.spent, 0),
    saved: weeks.reduce((s, w) => s + w.saved, 0),
  };

  const cw = weeks[curWeek - 1];
  // 含今天還剩幾天（Excel：MAX(1, 開始日 + 週次*7 - TODAY())）
  const remainingDays = Math.max(1, toDays(start) + curWeek * 7 - toDays(today));
  const daysLeft = Math.min(7, remainingDays);

  // 今天的預算 = 今天以前還沒花掉的錢 ÷ 含今天剩下的天數，但不超過平常的每日預算
  let spentBeforeToday = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(cw.start, i);
    if (d < today) spentBeforeToday += byDate.get(d) || 0;
  }
  const leftForDays = cw.budget - spentBeforeToday;
  const todayBudget = Math.min(dailyBase, Math.max(0, leftForDays) / daysLeft);
  const savedThisWeek = Math.max(0, leftForDays - dailyBase * daysLeft); // 前幾天省下、不加進每日預算的錢
  const todaySpent = byDate.get(today) || 0;

  // 每一天當天的預算（過去的日子照當時算；本週之後的日子先用今天的預算）
  const dayBudget = new Map();
  for (const wk of weeks.slice(0, curWeek)) {
    let before = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(wk.start, i);
      if (d > today) {
        dayBudget.set(d, todayBudget);
        continue;
      }
      dayBudget.set(d, Math.min(dailyBase, Math.max(0, wk.budget - before) / (7 - i)));
      before += byDate.get(d) || 0;
    }
  }

  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(cw.start, i);
    const spent = byDate.get(date) || 0;
    const isFuture = date > today;
    const db = dayBudget.get(date);
    days.push({
      date,
      weekday: weekdayOf(date),
      spent,
      budget: db,
      balance: isFuture ? null : db - spent,
      status: isFuture ? '' : dayStatus(spent, db),
      isToday: date === today,
      isFuture,
    });
  }

  return {
    curWeek,
    nWeeks,
    weeks,
    totals,
    cw,
    remainingDays,
    daysLeft,
    dailyBase,
    todayBudget,
    todaySpent,
    savedThisWeek,
    cut: dailyBase - todayBudget,
    nextCarry: Math.max(0, -cw.remaining),
    days,
    dayBudget,
    byDate,
  };
}

/** 分類 × 週 的矩陣；不在清單裡的分類也列出來，合計才會對 */
export function categoryMatrix(entries, settings, nWeeks) {
  const start = settings.startDate;
  const cats = [...settings.categories];
  const rows = new Map(cats.map((c) => [c, new Array(nWeeks).fill(0)]));
  for (const e of entries) {
    const w = weekOf(e.date, start);
    if (w < 1 || w > nWeeks) continue;
    const c = e.category || '未分類';
    if (!rows.has(c)) rows.set(c, new Array(nWeeks).fill(0));
    rows.get(c)[w - 1] += amountOf(e);
  }
  const list = [...rows.entries()].map(([category, perWeek]) => ({
    category,
    perWeek,
    total: perWeek.reduce((a, b) => a + b, 0),
  }));
  const weekTotals = new Array(nWeeks).fill(0);
  for (const r of list) r.perWeek.forEach((v, i) => (weekTotals[i] += v));
  const grand = weekTotals.reduce((a, b) => a + b, 0);
  for (const r of list) r.share = grand === 0 ? 0 : r.total / grand;
  return { rows: list, weekTotals, grand };
}
