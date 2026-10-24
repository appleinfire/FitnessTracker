// История подходов в IndexedDB — хранится на телефоне и работает без интернета.
// Запись: { id, uid, exercise: 'squat' | 'pushup' | 'pullup', reps, startedAt, endedAt,
//           reason, updatedAt, deleted, dirty }
// - даты — строки ISO, чтобы их было просто выгружать в файл и в облако;
// - uid — постоянный идентификатор подхода, одинаковый на всех устройствах;
// - dirty — изменение ещё не отправлено в облако;
// - deleted — подход удалён (запись остаётся, чтобы удаление дошло до облака).

const DB_NAME = 'fitness-tracker';
const STORE = 'sets';

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = (e) => {
        const store = e.oldVersion < 1
          ? req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
          : req.transaction.objectStore(STORE);
        if (e.oldVersion < 1) store.createIndex('startedAt', 'startedAt');
        if (e.oldVersion < 2) store.createIndex('uid', 'uid');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Постоянный идентификатор подхода: из упражнения и времени начала.
// Один и тот же подход (например, из одной резервной копии на двух телефонах)
// получает один и тот же uid и не задваивается в облаке.
export async function uidFor(exercise, startedAt) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${exercise}|${startedAt}`)));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // формат UUID
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Просим браузер не удалять данные при нехватке места.
let persistAsked = false;
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  navigator.storage?.persist?.().catch(() => {});
}

const now = () => new Date().toISOString();

export async function addSet(record) {
  askPersist();
  const uid = await uidFor(record.exercise, record.startedAt);
  return run('readwrite', (store) => store.add({ ...record, uid, updatedAt: now(), deleted: false, dirty: true }));
}

export function updateSet(record) {
  return run('readwrite', (store) => store.put({ ...record, updatedAt: now(), dirty: true }));
}

export async function deleteSet(id) {
  const record = await run('readonly', (store) => store.get(id));
  if (record) await updateSet({ ...record, deleted: true });
}

// Все записи, включая удалённые, — для синхронизации.
export async function allRecords() {
  const list = await run('readonly', (store) => store.getAll());
  // Подходы, записанные до появления облака, получают uid при первом чтении.
  const missing = list.filter((r) => !r.uid);
  if (missing.length) {
    for (const r of missing) {
      r.uid = await uidFor(r.exercise, r.startedAt);
      r.updatedAt = r.updatedAt || now();
      r.deleted = Boolean(r.deleted);
      r.dirty = true;
    }
    await run('readwrite', (store) => {
      let last = null;
      for (const r of missing) last = store.put(r);
      return last;
    });
  }
  return list;
}

// Подходы для показа, новые сверху.
export async function allSets() {
  const list = (await allRecords()).filter((r) => !r.deleted);
  return list.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

// Сохраняет записи как есть (для синхронизации).
export function putRecords(records) {
  if (!records.length) return Promise.resolve();
  return run('readwrite', (store) => {
    let last = null;
    for (const r of records) last = store.put(r);
    return last;
  });
}

// Добавляет подходы из резервной копии, пропуская те, что уже есть.
export async function importSets(records) {
  const existing = new Set((await allRecords()).filter((r) => !r.deleted).map((r) => r.uid));
  const fresh = [];
  for (const r of records) {
    const uid = await uidFor(r.exercise, r.startedAt);
    if (existing.has(uid)) continue;
    existing.add(uid);
    const { id, ...rest } = r;
    fresh.push({ ...rest, uid, updatedAt: now(), deleted: false, dirty: true });
  }
  if (fresh.length) {
    // Если подход был удалён и восстанавливается из копии — оживляем ту же запись.
    const byUid = new Map((await allRecords()).map((r) => [r.uid, r]));
    await putRecords(fresh.map((r) => (byUid.has(r.uid) ? { ...r, id: byUid.get(r.uid).id } : r)));
  }
  return { added: fresh.length, skipped: records.length - fresh.length };
}
