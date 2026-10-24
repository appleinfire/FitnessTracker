// Облако (Supabase): вход по коду из письма и синхронизация истории.
// Главное хранилище — телефон (db.js): тренировка работает без интернета,
// а при появлении связи изменения уходят в облако и приходят с других устройств.

import { allRecords, putRecords } from './db.js';

const SUPABASE_URL = 'https://hkdpdztgrybcpnheoktp.supabase.co';
// Публичный ключ: он и предназначен для кода приложения. Доступ к данным
// закрывают правила в базе — каждый видит только свои подходы.
const SUPABASE_KEY = 'sb_publishable_uw5MQrUWwQyZxO59gUgwGQ_-pUeQD6C';

const SESSION_KEY = 'ft.cloud.session';
const PULL_KEY = 'ft.cloud.lastPull';
const SYNC_KEY = 'ft.cloud.lastSync';
const PAGE = 1000;

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* нет доступа */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* нет доступа */ } },
};

let session = null;
try { session = JSON.parse(store.get(SESSION_KEY) || 'null'); } catch { session = null; }

// Состояние для экрана: status — 'off' | 'idle' | 'syncing' | 'offline' | 'error'.
const state = { status: session ? 'idle' : 'off', message: '', lastSync: store.get(SYNC_KEY) };
const listeners = new Set();
let onData = () => {};

export const cloudState = () => ({ ...state, email: session?.email || '' });
export const isSignedIn = () => Boolean(session);
export function onCloudChange(fn) { listeners.add(fn); }

function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(cloudState());
}

// ---------- Запросы ----------

async function api(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...headers };
  if (auth) h.Authorization = `Bearer ${await accessToken()}`;
  const res = await fetch(SUPABASE_URL + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error(data?.msg || data?.message || data?.error_description || data?.error || `Ошибка сервера ${res.status}`);
    err.status = res.status;
    err.code = data?.error_code || data?.code;
    throw err;
  }
  return data;
}

// ---------- Вход ----------

function saveSession(data) {
  const prevUser = session?.user_id;
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    email: data.user?.email || session?.email || '',
    user_id: data.user?.id || session?.user_id || '',
  };
  store.set(SESSION_KEY, JSON.stringify(session));
  if (prevUser !== session.user_id) store.remove(PULL_KEY);
}

function forgetSession() {
  session = null;
  store.remove(SESSION_KEY);
  store.remove(PULL_KEY);
  store.remove(SYNC_KEY);
  setState({ status: 'off', message: '', lastSync: null });
}

// Понятные сообщения для частых ошибок входа.
function authMessage(err) {
  const code = err.code || '';
  if (code === 'otp_expired' || /expired|invalid/i.test(err.message)) return 'Код не подошёл или устарел. Запросите новый.';
  if (code === 'over_email_send_rate_limit' || err.status === 429) return 'Слишком много писем подряд. Подождите минуту и попробуйте снова.';
  if (!navigator.onLine || err instanceof TypeError) return 'Нет связи с облаком. Проверьте интернет.';
  return err.message;
}

export async function requestCode(email) {
  try {
    await api('/auth/v1/otp', { method: 'POST', auth: false, body: { email, create_user: true } });
  } catch (err) {
    throw new Error(authMessage(err));
  }
}

export async function verifyCode(email, token) {
  try {
    const data = await api('/auth/v1/verify', { method: 'POST', auth: false, body: { type: 'email', email, token } });
    saveSession(data);
  } catch (err) {
    throw new Error(authMessage(err));
  }
  setState({ status: 'idle', message: '' });
  // Всё, что уже есть на телефоне, отправится в облако.
  sync();
}

export async function signOut() {
  if (session) {
    try { await api('/auth/v1/logout', { method: 'POST' }); } catch { /* всё равно выходим */ }
  }
  forgetSession();
}

// Токен доступа живёт около часа — обновляем заранее.
let refreshing = null;
async function accessToken() {
  if (!session) throw new Error('Вы не вошли в облако');
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  if (!refreshing) {
    refreshing = api('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', auth: false, body: { refresh_token: session.refresh_token },
    }).then((data) => {
      saveSession(data);
    }).catch((err) => {
      if (err.status === 400 || err.status === 401) {
        forgetSession();
        throw new Error('Вход устарел — войдите снова.');
      }
      throw err;
    }).finally(() => { refreshing = null; });
  }
  await refreshing;
  return session.access_token;
}

// ---------- Синхронизация ----------

const toRow = (r) => ({
  id: r.uid,
  exercise: r.exercise,
  reps: r.reps,
  started_at: r.startedAt,
  ended_at: r.endedAt,
  reason: r.reason ?? null,
  deleted: Boolean(r.deleted),
});

const iso = (value) => new Date(value).toISOString();

// Отправить свои изменения.
async function push() {
  const dirty = (await allRecords()).filter((r) => r.dirty);
  for (let i = 0; i < dirty.length; i += PAGE) {
    const chunk = dirty.slice(i, i + PAGE);
    await api('/rest/v1/sets?on_conflict=id', {
      method: 'POST',
      body: chunk.map(toRow),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    // Снимаем отметку, только если запись не поменяли, пока шла отправка.
    const sent = new Map(chunk.map((r) => [r.id, r.updatedAt]));
    const fresh = (await allRecords()).filter((r) => r.dirty && sent.get(r.id) === r.updatedAt);
    await putRecords(fresh.map((r) => ({ ...r, dirty: false })));
  }
  return dirty.length;
}

// Забрать изменения с других устройств.
async function pull() {
  let since = store.get(PULL_KEY) || '1970-01-01T00:00:00Z';
  let changed = 0;
  for (;;) {
    const rows = await api(`/rest/v1/sets?select=id,exercise,reps,started_at,ended_at,reason,deleted,updated_at&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc&limit=${PAGE}`);
    if (!rows.length) break;
    const local = new Map((await allRecords()).map((r) => [r.uid, r]));
    const updates = [];
    for (const row of rows) {
      const mine = local.get(row.id);
      if (mine?.dirty) continue;          // своё изменение новее — уйдёт при следующей отправке
      if (!mine && row.deleted) continue; // удалённое, которого здесь и не было
      if (mine && mine.reps === row.reps && Boolean(mine.deleted) === row.deleted) continue;
      updates.push({
        ...(mine || {}),
        uid: row.id,
        exercise: row.exercise,
        reps: row.reps,
        startedAt: iso(row.started_at),
        endedAt: iso(row.ended_at),
        reason: row.reason,
        deleted: row.deleted,
        updatedAt: iso(row.updated_at),
        dirty: false,
      });
    }
    await putRecords(updates);
    changed += updates.length;
    since = rows[rows.length - 1].updated_at;
    store.set(PULL_KEY, since);
    if (rows.length < PAGE) break;
  }
  return changed;
}

let running = null;
let again = false;

export function sync() {
  if (!session) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      if (!navigator.onLine) {
        setState({ status: 'offline', message: '' });
        return;
      }
      setState({ status: 'syncing', message: '' });
      try {
        await push();
        const changed = await pull();
        const lastSync = new Date().toISOString();
        store.set(SYNC_KEY, lastSync);
        setState({ status: 'idle', message: '', lastSync });
        if (changed) onData();
      } catch (err) {
        console.error('Синхронизация не удалась', err);
        if (!session) return; // вход устарел — состояние уже «не вошли»
        const offline = !navigator.onLine || err instanceof TypeError;
        setState(offline
          ? { status: 'offline', message: '' }
          : { status: 'error', message: err.message });
        return;
      }
    } while (again);
  })().finally(() => { running = null; });
  return running;
}

// Синхронизация вскоре после изменения: несколько правок подряд уйдут одним разом.
let soonTimer = 0;
export function syncSoon(ms = 1500) {
  if (!session) return;
  clearTimeout(soonTimer);
  soonTimer = setTimeout(sync, ms);
}

export function initCloud({ onDataChanged }) {
  onData = onDataChanged;
  window.addEventListener('online', () => syncSoon(500));
  window.addEventListener('offline', () => { if (session) setState({ status: 'offline' }); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncSoon(500);
  });
  syncSoon(300);
}
