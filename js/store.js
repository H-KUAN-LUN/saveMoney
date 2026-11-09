// 資料層：有填 firebaseConfig 就用 Firebase；沒填就是「示範模式」，資料只存在這個瀏覽器
// 兩種模式提供同一組方法，畫面程式不用管資料存在哪裡

const FIREBASE_VERSION = '10.14.1';

const ENTRY_FIELDS = ['date', 'item', 'category', 'amount', 'payment', 'note'];

/** 確保每個欄位都存在且型別正確（Firestore 規則會檢查） */
export function cleanEntry(d) {
  return {
    date: String(d.date || ''),
    item: String(d.item || '').trim().slice(0, 100),
    category: String(d.category || '').trim().slice(0, 30),
    amount: Number(d.amount) || 0,
    payment: String(d.payment || '').trim().slice(0, 30),
    note: String(d.note || '').trim().slice(0, 500),
  };
}

export async function createStore({ firebaseConfig, allowedEmail }) {
  if (!firebaseConfig || !firebaseConfig.apiKey) return createLocalStore();
  return createFirebaseStore(firebaseConfig, allowedEmail);
}

/* ---------------- Firebase ---------------- */

async function createFirebaseStore(firebaseConfig, allowedEmail) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [appM, authM, fs] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);

  const app = appM.initializeApp(firebaseConfig);
  const auth = authM.getAuth(app);

  // 開啟離線快取：沒網路也能記，連上後自動同步；多分頁共用
  let db;
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch (err) {
    console.warn('離線快取無法啟用，改用一般模式', err);
    db = fs.getFirestore(app);
  }

  let uid = null;
  const col = (name) => fs.collection(db, 'users', uid, name);
  const ref = (...path) => fs.doc(db, 'users', uid, ...path);
  const stamp = () => fs.serverTimestamp();

  return {
    mode: 'firebase',
    allowedEmail: (allowedEmail || '').trim().toLowerCase(),

    onUser(cb) {
      return authM.onAuthStateChanged(auth, (u) => {
        uid = u ? u.uid : null;
        cb(u ? { uid: u.uid, email: u.email || '', name: u.displayName || '' } : null);
      });
    },

    async signIn() {
      const provider = new authM.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await authM.signInWithPopup(auth, provider);
    },

    signOut() {
      return authM.signOut(auth);
    },

    watch(startDate, { onEntries, onJournal, onError }) {
      const u1 = fs.onSnapshot(
        fs.query(col('entries'), fs.where('date', '>=', startDate)),
        // 'estimate'：剛記的帳還沒寫到伺服器時，先用本機時間排序
        (snap) => onEntries(snap.docs.map((d) => ({ id: d.id, ...pick(d.data({ serverTimestamps: 'estimate' })) }))),
        onError,
      );
      const u2 = fs.onSnapshot(
        fs.query(col('journal'), fs.where('date', '>=', startDate)),
        (snap) => {
          const m = {};
          snap.forEach((d) => (m[d.id] = d.data().text || ''));
          onJournal(m);
        },
        onError,
      );
      return () => {
        u1();
        u2();
      };
    },

    watchSettings(cb, onError) {
      return fs.onSnapshot(ref('meta', 'settings'), (s) => cb(s.exists() ? s.data() : null), onError);
    },

    /** 回傳 {id, done}：id 立刻拿得到（給「復原」用），done 是寫到伺服器的 promise */
    addEntry(data) {
      const r = fs.doc(col('entries'));
      const done = fs.setDoc(r, { ...cleanEntry(data), createdAt: stamp(), updatedAt: stamp() });
      return { id: r.id, done };
    },

    updateEntry(id, data) {
      return fs.updateDoc(ref('entries', id), { ...cleanEntry(data), updatedAt: stamp() });
    },

    deleteEntry(id) {
      return fs.deleteDoc(ref('entries', id));
    },

    setJournal(date, text) {
      const r = ref('journal', date);
      return text.trim() ? fs.setDoc(r, { date, text, updatedAt: stamp() }) : fs.deleteDoc(r);
    },

    saveSettings(s) {
      return fs.setDoc(ref('meta', 'settings'), s);
    },

    /* ----- 體重、腰圍（每天一筆，兩個都是選填） ----- */

    watchWeight({ onRecords, onGoal, onError }) {
      const u1 = fs.onSnapshot(col('weights'), (snap) => onRecords(snap.docs.map((d) => toMeasure(d.id, d.data()))), onError);
      const u2 = fs.onSnapshot(ref('meta', 'weight'), (s) => onGoal(s.exists() ? s.data() : null), onError);
      return () => {
        u1();
        u2();
      };
    },

    /** 整筆覆蓋；沒填的欄位不存 */
    setMeasure(date, m) {
      const data = { date, updatedAt: stamp() };
      if (m.weight != null) data.weight = Number(m.weight);
      if (m.waist != null) data.waist = Number(m.waist);
      return fs.setDoc(ref('weights', date), data);
    },

    deleteMeasure(date) {
      return fs.deleteDoc(ref('weights', date));
    },

    saveWeightGoal(goal) {
      return fs.setDoc(ref('meta', 'weight'), goal);
    },

    async importBatch(entries, journals) {
      const ops = [
        ...entries.map((e) => (b) => b.set(fs.doc(col('entries')), { ...cleanEntry(e), createdAt: stamp(), updatedAt: stamp() })),
        ...Object.entries(journals).map(([date, text]) => (b) => b.set(ref('journal', date), { date, text, updatedAt: stamp() })),
      ];
      // 一個 batch 最多 500 筆
      for (let i = 0; i < ops.length; i += 400) {
        const b = fs.writeBatch(db);
        ops.slice(i, i + 400).forEach((op) => op(b));
        await b.commit();
      }
    },

    async fetchAll() {
      const [es, js] = await Promise.all([fs.getDocs(col('entries')), fs.getDocs(col('journal'))]);
      const journal = {};
      js.forEach((d) => (journal[d.id] = d.data().text || ''));
      return { entries: es.docs.map((d) => ({ id: d.id, ...pick(d.data()) })), journal };
    },
  };
}

function pick(data) {
  const o = {};
  for (const k of ENTRY_FIELDS) o[k] = data[k];
  o.amount = Number(o.amount) || 0;
  o.createdAt = data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : 0;
  return o;
}

/** 每日紀錄統一成 {date, weight, waist}，沒有的是 null（舊版只存數字的也轉過來） */
function toMeasure(date, v) {
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  if (typeof v === 'number') return { date, weight: v, waist: null };
  return { date, weight: num(v && v.weight), waist: num(v && v.waist) };
}

/* ---------------- 示範模式（localStorage） ---------------- */

function createLocalStore() {
  const KEY = 'weekly-budget-demo-v1';
  const load = () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {
      /* 私密視窗等情況讀不到，就從空的開始 */
    }
    return { entries: {}, journal: {}, settings: null };
  };
  let data = load();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (_) {
      /* 存不了就只留在記憶體 */
    }
  };

  if (!data.weights) data.weights = {};
  let watcher = null;
  let settingsCb = null;
  let weightCbs = null;
  const emitWeight = () => {
    if (!weightCbs) return;
    weightCbs.onRecords(Object.entries(data.weights).map(([date, v]) => toMeasure(date, v)));
    weightCbs.onGoal(data.weightGoal || null);
  };
  const emit = () => {
    if (watcher) {
      const { startDate, onEntries, onJournal } = watcher;
      onEntries(Object.entries(data.entries).filter(([, e]) => e.date >= startDate).map(([id, e]) => ({ id, ...e })));
      const j = {};
      for (const [d, t] of Object.entries(data.journal)) if (d >= startDate) j[d] = t;
      onJournal(j);
    }
  };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const later = (fn) => setTimeout(fn, 0);

  return {
    mode: 'local',
    allowedEmail: '',
    onUser(cb) {
      later(() => cb({ uid: 'local', email: '', name: '示範模式' }));
      return () => {};
    },
    async signIn() {},
    async signOut() {},
    watch(startDate, cbs) {
      watcher = { startDate, ...cbs };
      later(emit);
      return () => (watcher = null);
    },
    watchSettings(cb) {
      settingsCb = cb;
      later(() => cb(data.settings));
      return () => (settingsCb = null);
    },
    addEntry(d) {
      const id = newId();
      data.entries[id] = { ...cleanEntry(d), createdAt: Date.now() };
      save();
      emit();
      return { id, done: Promise.resolve() };
    },
    async updateEntry(id, d) {
      if (!data.entries[id]) return;
      data.entries[id] = { ...data.entries[id], ...cleanEntry(d) };
      save();
      emit();
    },
    async deleteEntry(id) {
      delete data.entries[id];
      save();
      emit();
    },
    async setJournal(date, text) {
      if (text.trim()) data.journal[date] = text;
      else delete data.journal[date];
      save();
      emit();
    },
    async saveSettings(s) {
      data.settings = s;
      save();
      if (settingsCb) settingsCb(s);
    },
    watchWeight(cbs) {
      weightCbs = cbs;
      later(emitWeight);
      return () => (weightCbs = null);
    },
    async setMeasure(date, m) {
      data.weights[date] = { weight: m.weight != null ? Number(m.weight) : null, waist: m.waist != null ? Number(m.waist) : null };
      save();
      emitWeight();
    },
    async deleteMeasure(date) {
      delete data.weights[date];
      save();
      emitWeight();
    },
    async saveWeightGoal(goal) {
      data.weightGoal = goal;
      save();
      emitWeight();
    },
    async importBatch(entries, journals) {
      let t = Date.now();
      for (const e of entries) data.entries[newId()] = { ...cleanEntry(e), createdAt: t++ };
      Object.assign(data.journal, journals);
      save();
      emit();
    },
    async fetchAll() {
      return {
        entries: Object.entries(data.entries).map(([id, e]) => ({ id, ...e })),
        journal: { ...data.journal },
      };
    },
    clearDemo() {
      data = { entries: {}, journal: {}, settings: null, weights: {}, weightGoal: null };
      save();
      emit();
      emitWeight();
      if (settingsCb) settingsCb(null);
    },
  };
}
