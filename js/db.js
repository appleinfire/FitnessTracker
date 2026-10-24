// История подходов в IndexedDB — хранится на телефоне, без сервера.
// Запись: { id, exercise: 'squat' | 'pushup' | 'pullup', reps, startedAt, endedAt, reason }
// (даты — строки ISO, чтобы их было просто выгружать в файл).

const DB_NAME = 'fitness-tracker';
const STORE = 'sets';

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('startedAt', 'startedAt');
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

// Просим браузер не удалять данные при нехватке места.
let persistAsked = false;
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  navigator.storage?.persist?.().catch(() => {});
}

export function addSet(record) {
  askPersist();
  return run('readwrite', (store) => store.add(record));
}

export function updateSet(record) {
  return run('readwrite', (store) => store.put(record));
}

export function deleteSet(id) {
  return run('readwrite', (store) => store.delete(id));
}

// Все подходы, новые сверху.
export async function allSets() {
  const list = await run('readonly', (store) => store.getAll());
  return list.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

// Добавляет подходы из резервной копии, пропуская те, что уже есть.
export async function importSets(records) {
  const key = (r) => `${r.exercise}|${r.startedAt}`;
  const existing = new Set((await allSets()).map(key));
  const fresh = records.filter((r) => !existing.has(key(r)));
  if (fresh.length) {
    await run('readwrite', (store) => {
      let last = null;
      for (const r of fresh) {
        const { id, ...rest } = r;
        last = store.add(rest);
      }
      return last;
    });
  }
  return { added: fresh.length, skipped: records.length - fresh.length };
}
