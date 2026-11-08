// 體重計畫的計算：計畫線、每週要減多少、7 天平均、超前/落後、每週目標
// 日期一樣用 'YYYY-MM-DD' 字串，以天數計算

import { toDays, fromDays } from './calc.js';

export const round1 = (n) => Math.round(n * 10) / 10;

/**
 * @param {{startDate:string, startWeight:number, targetWeight:number, targetDate:string}} goal
 * @param {Array<{date:string, weight:number}>} records 每天一筆
 * @param {string} today
 */
export function weightSummary(goal, records, today) {
  const s0 = toDays(goal.startDate);
  const s1 = toDays(goal.targetDate);
  const totalDays = Math.max(1, s1 - s0);
  const totalLoss = goal.startWeight - goal.targetWeight;
  const perDay = totalLoss / totalDays;
  const perWeek = perDay * 7;

  /** 照計畫，某一天應該是幾公斤（開始日以前 = 起始體重，目標日以後 = 目標體重） */
  const planAt = (date) => {
    const d = Math.min(Math.max(toDays(date) - s0, 0), totalDays);
    return goal.startWeight - perDay * d;
  };

  const recs = records
    .filter((r) => r.date >= goal.startDate && Number.isFinite(r.weight))
    .sort((a, b) => a.date.localeCompare(b.date));
  const byDay = new Map(recs.map((r) => [toDays(r.date), r.weight]));

  /** 某天往前 7 天（含當天）有記錄的平均，和同幾天的計畫平均（拿來公平比較） */
  const avg7 = (date) => {
    const end = toDays(date);
    let sum = 0;
    let plan = 0;
    let n = 0;
    for (let d = end - 6; d <= end; d++) {
      if (!byDay.has(d)) continue;
      sum += byDay.get(d);
      plan += planAt(fromDays(d));
      n++;
    }
    return n ? { avg: sum / n, plan: plan / n, n } : null;
  };

  const past = recs.filter((r) => r.date <= today);
  const latest = past.length ? past[past.length - 1] : null;
  const a = latest ? avg7(latest.date) : null;
  const current = a ? a.avg : goal.startWeight;
  const diff = a ? a.avg - a.plan : 0; // 正數 = 比計畫重（落後）

  const daysLeft = s1 - toDays(today);
  const remainingLoss = current - goal.targetWeight;
  const requiredPerWeek = daysLeft > 0 ? (remainingLoss / daysLeft) * 7 : null;

  // 一般建議：每週不超過約 1 公斤，或體重的 1%（取比較小的）
  const limitFor = (w) => Math.min(1, w * 0.01);
  const fastLimit = limitFor(goal.startWeight);

  // 每週目標：第 k 週的最後一天，照計畫應該到幾公斤；實際用那一週的平均
  const nWeeks = Math.ceil(totalDays / 7);
  const weeks = [];
  for (let k = 1; k <= nWeeks; k++) {
    const from = s0 + (k - 1) * 7 + 1;
    const to = Math.min(s0 + k * 7, s1);
    let sum = 0;
    let plan = 0;
    let n = 0;
    for (let d = from; d <= to; d++) {
      if (!byDay.has(d)) continue;
      sum += byDay.get(d);
      plan += planAt(fromDays(d));
      n++;
    }
    weeks.push({
      week: k,
      start: fromDays(from),
      end: fromDays(to),
      target: planAt(fromDays(to)),
      avg: n ? sum / n : null,
      diff: n ? sum / n - plan / n : null, // 和同一段時間的計畫比
      isCurrent: toDays(today) >= from && toDays(today) <= to,
      isFuture: from > toDays(today),
    });
  }

  return {
    goal,
    totalDays,
    totalLoss,
    perDay,
    perWeek,
    planAt,
    records: recs,
    avg7,
    latest,
    current,
    hasAvg: !!a,
    avgCount: a ? a.n : 0,
    diff,
    lost: goal.startWeight - current,
    remainingLoss,
    daysLeft,
    requiredPerWeek,
    progress: totalLoss > 0 ? Math.min(1, Math.max(0, (goal.startWeight - current) / totalLoss)) : 0,
    fastLimit,
    tooFast: perWeek > fastLimit + 1e-9,
    requiredTooFast: requiredPerWeek != null && requiredPerWeek > limitFor(current) + 1e-9,
    weeks,
  };
}

/** 檢查目標設定，回傳錯誤訊息或空字串 */
export function validateGoal(g) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (!ok(g.startDate)) return '請選開始日期。';
  if (!ok(g.targetDate)) return '請選目標日期。';
  if (g.targetDate <= g.startDate) return '目標日期要在開始日期之後。';
  if (!(g.startWeight >= 20 && g.startWeight <= 400)) return '現在體重請填 20～400 公斤。';
  if (!(g.targetWeight >= 20 && g.targetWeight <= 400)) return '目標體重請填 20～400 公斤。';
  if (g.targetWeight >= g.startWeight) return '目標體重要比現在輕。';
  return '';
}
