// CSV 匯入 / 匯出
// 匯入欄位用標題對應：日期、品項、分類、金額、付款方式、備註、心得（週次會自動算，不需要）

/** Excel 繁中版「另存 CSV」常是 Big5，UTF-8 解不開就改用 Big5 */
export function decodeFile(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch (_) {
    return new TextDecoder('big5').decode(buffer);
  }
}

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const pad = (n) => String(n).padStart(2, '0');

/** 2026-11-05、2026/11/5、2026/11/5 上午 12:00:00、11/5/2026 → 2026-11-05 */
export function normalizeDate(s) {
  const t = String(s || '').trim().split(/[\sT]/)[0];
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return valid(+m[3], +m[1], +m[2]);
  return null;
}

function valid(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

export function normalizeAmount(s) {
  const t = String(s ?? '').replace(/NT\$|\$|,|，|元|\s/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const HEADERS = {
  date: ['日期', 'date'],
  item: ['品項', '項目', 'item'],
  category: ['分類', '類別', 'category'],
  amount: ['金額', 'amount'],
  payment: ['付款方式', '付款', 'payment'],
  note: ['備註', 'note'],
  journal: ['心得', 'journal'],
};

/**
 * @returns {{entries: Array, journals: Object<string,string>, skipped: Array<{line:number, reason:string}>}}
 */
export function rowsToRecords(rows) {
  if (!rows.length) throw new Error('檔案是空的');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  for (const [key, names] of Object.entries(HEADERS)) {
    idx[key] = head.findIndex((h) => names.includes(h));
  }
  if (idx.date < 0 || idx.amount < 0) {
    throw new Error('第一列要有「日期」和「金額」欄位標題');
  }
  const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');

  const entries = [];
  const journals = {};
  const skipped = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const rawDate = get(r, 'date');
    const rawAmount = get(r, 'amount');
    const journal = get(r, 'journal');
    if (!rawDate && !rawAmount && !journal) return;
    const date = normalizeDate(rawDate);
    if (!date) {
      skipped.push({ line, reason: `日期看不懂：「${rawDate}」` });
      return;
    }
    if (journal) journals[date] = journals[date] ? `${journals[date]}\n${journal}` : journal;
    if (rawAmount === '') return; // 只有心得的列
    const amount = normalizeAmount(rawAmount);
    if (amount === null || amount < 0) {
      skipped.push({ line, reason: `金額看不懂：「${rawAmount}」` });
      return;
    }
    entries.push({
      date,
      item: get(r, 'item'),
      category: get(r, 'category'),
      amount,
      payment: get(r, 'payment'),
      note: get(r, 'note'),
    });
  });
  return { entries, journals, skipped };
}

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 匯出成 Excel 打得開的 UTF-8（含 BOM）CSV；心得放在當天第一筆，沒帳目的日子單獨一列 */
export function toCSV(entries, journal, weekOfFn) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  const lines = [['日期', '品項', '分類', '金額', '付款方式', '週次', '備註', '心得']];
  const used = new Set();
  for (const e of sorted) {
    const j = !used.has(e.date) && journal[e.date] ? journal[e.date] : '';
    if (j) used.add(e.date);
    lines.push([e.date, e.item, e.category, e.amount, e.payment, weekOfFn(e.date), e.note, j]);
  }
  for (const [d, t] of Object.entries(journal).sort()) {
    if (!used.has(d) && t) lines.push([d, '', '', '', '', weekOfFn(d), '', t]);
  }
  return '﻿' + lines.map((r) => r.map(esc).join(',')).join('\r\n');
}
