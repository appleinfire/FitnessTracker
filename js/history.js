// История тренировок: сводка «Сегодня» на главном экране, экран истории,
// правка и удаление подходов, резервная копия в файл и восстановление.

import { addSet, updateSet, deleteSet, allSets, importSets } from './db.js';
import { EXERCISE_NAMES } from './exercises.js';
import {
  initCloud, onCloudChange, cloudState, isSignedIn, signIn, signOut, sync, syncSoon,
} from './cloud.js';

const $ = (id) => document.getElementById(id);
const BACKUP_KEY = 'ft.lastBackup';

let sets = []; // все подходы, новые сверху — держим под рукой для экспорта
let editing = null;
let showScreen = () => {};

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const nameOf = (key) => EXERCISE_NAMES[key] || key;
const dayKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const timeOf = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

function dayTitle(key) {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());
  if (key === today) return 'Сегодня';
  if (key === yesterday) return 'Вчера';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const opts = { weekday: 'short', day: 'numeric', month: 'long' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('ru-RU', opts);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Значок упражнения из набора в index.html.
export function exerciseIcon(key) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `ic-${key}`);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#ic-${key}`);
  svg.append(use);
  return svg;
}

// Сумма повторений по упражнениям: [[упражнение, повторения, подходы], ...].
function totalsOf(list) {
  const totals = new Map();
  for (const s of list) {
    const t = totals.get(s.exercise) || [0, 0];
    totals.set(s.exercise, [t[0] + s.reps, t[1] + 1]);
  }
  return [...totals].map(([ex, [reps, count]]) => [ex, reps, count]);
}

// Плашки «значок, название, число» — по одной на упражнение.
function renderTotals(el, list) {
  el.replaceChildren(...totalsOf(list).map(([ex, reps]) => {
    const chip = document.createElement('span');
    chip.className = 'total-chip';
    const b = document.createElement('b');
    b.textContent = reps;
    chip.append(exerciseIcon(ex), nameOf(ex), b);
    return chip;
  }));
}

function setRow(s) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.className = 'set-row';
  btn.innerHTML = '<span class="set-time"></span><span class="set-name"></span><span class="set-reps"></span>';
  btn.querySelector('.set-time').textContent = timeOf(s.startedAt);
  btn.querySelector('.set-name').textContent = nameOf(s.exercise);
  btn.setAttribute('aria-label', `${nameOf(s.exercise)}, ${timeOf(s.startedAt)}, ${s.reps}. Изменить`);
  btn.querySelector('.set-reps').textContent = s.reps;
  btn.addEventListener('click', () => openEdit(s));
  li.append(btn);
  return li;
}

// ---------- Данные ----------

export async function refresh() {
  try {
    sets = await allSets();
  } catch (err) {
    console.error(err);
    sets = [];
  }
  renderToday();
  renderWeek();
  renderStreak();
  renderHistory();
}

// Сохраняет законченный подход. Возвращает текст ошибки или ''.
export async function recordSet(record) {
  try {
    await addSet({
      exercise: record.exercise,
      reps: record.reps,
      startedAt: (record.startedAt || record.endedAt).toISOString(),
      endedAt: record.endedAt.toISOString(),
      reason: record.reason,
    });
    await refresh();
    syncSoon();
    return '';
  } catch (err) {
    console.error(err);
    return err?.message || String(err);
  }
}

// ---------- Главный экран: сегодня ----------

function renderToday() {
  const today = dayKey(new Date().toISOString());
  const list = sets.filter((s) => dayKey(s.startedAt) === today);
  $('today').classList.toggle('hidden', list.length === 0);
  renderTotals($('today-totals'), list);
  const ol = $('today-list');
  ol.replaceChildren(...list.map(setRow));
}

// ---------- Главный экран: неделя и серия ----------

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // понедельник
  return d;
}

function renderWeek() {
  const monday = startOfWeek(new Date());
  const keys = DAY_NAMES.map((_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return dayKey(d.toISOString());
  });
  const perDay = new Map(keys.map((k) => [k, 0]));
  const prevMonday = new Date(monday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  let lastWeek = 0;
  for (const s of sets) {
    const k = dayKey(s.startedAt);
    if (perDay.has(k)) perDay.set(k, perDay.get(k) + s.reps);
    else {
      const t = new Date(s.startedAt);
      if (t >= prevMonday && t < monday) lastWeek += s.reps;
    }
  }

  const values = keys.map((k) => perDay.get(k));
  const total = values.reduce((a, b) => a + b, 0);
  $('week-total').textContent = total;
  $('week-total-label').textContent = plural(total, 'повторение', 'повторения', 'повторений');

  const delta = $('week-delta');
  if (lastWeek > 0) {
    const pct = Math.round(((total - lastWeek) / lastWeek) * 100);
    delta.textContent = pct >= 0 ? `+${pct}% к прошлой неделе` : `${pct}% к прошлой неделе`;
    delta.classList.toggle('up', pct > 0);
  } else {
    delta.textContent = total ? '' : 'Здесь появятся повторения по дням.';
    delta.classList.remove('up');
  }

  const max = Math.max(...values, 1);
  const todayKey = dayKey(new Date().toISOString());
  $('week-chart').replaceChildren(...keys.map((k, i) => {
    const col = document.createElement('button');
    col.className = 'day-col' + (k === todayKey ? ' today' : '');
    col.setAttribute('role', 'listitem');
    col.setAttribute('aria-label', `${DAY_NAMES[i]}: ${values[i]}`);
    const h = `${Math.round((values[i] / max) * 100)}%`;
    col.innerHTML = '<span class="bar-area"><span class="bar-value"></span><span class="bar"></span></span><span class="day-label"></span>';
    col.querySelector('.bar-area').style.setProperty('--h', h);
    col.querySelector('.bar').style.height = h;
    col.querySelector('.bar-value').textContent = values[i] || '';
    col.querySelector('.day-label').textContent = DAY_NAMES[i];
    col.addEventListener('click', () => col.classList.toggle('show'));
    return col;
  }));
}

// Сколько дней подряд (до сегодня или до вчера) были тренировки.
export function streakDays() {
  const days = new Set(sets.map((s) => dayKey(s.startedAt)));
  const d = new Date();
  if (!days.has(dayKey(d.toISOString()))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d.toISOString()))) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function renderStreak() {
  const n = streakDays();
  $('streak').classList.toggle('hidden', n < 1);
  $('streak-days').textContent = n;
  $('streak-label').textContent = `${plural(n, 'день', 'дня', 'дней')} подряд`;
}

// ---------- Итоги тренировки ----------

export function showSummary(records, startedAt, endedAt) {
  const total = records.reduce((a, r) => a + r.reps, 0);
  $('summary-total').textContent = total;
  $('summary-total-label').textContent = plural(total, 'повторение', 'повторения', 'повторений');
  $('summary-when').textContent = `${dayTitle(dayKey(startedAt.toISOString()))}, ${timeOf(startedAt.toISOString())}–${timeOf(endedAt.toISOString())}`;

  const sec = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  $('summary-duration').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  $('summary-sets').textContent = records.length;
  $('summary-sets-label').textContent = plural(records.length, 'Подход', 'Подхода', 'Подходов');
  const streak = Math.max(1, streakDays());
  $('summary-streak').textContent = streak;
  $('summary-streak-label').textContent = `${plural(streak, 'День', 'Дня', 'Дней')} подряд`;

  $('summary-list').replaceChildren(...totalsOf(records).map(([ex, reps, count]) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = nameOf(ex);
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = `${count} ${plural(count, 'подход', 'подхода', 'подходов')}`;
    name.append(sub);
    const b = document.createElement('b');
    b.textContent = reps;
    li.append(exerciseIcon(ex), name, b);
    return li;
  }));
  showScreen('summary');
}

// ---------- Экран истории ----------

function renderHistory() {
  const box = $('history-days');
  $('history-empty').classList.toggle('hidden', sets.length > 0);

  const days = new Map();
  for (const s of sets) {
    const key = dayKey(s.startedAt);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(s);
  }

  box.replaceChildren(...[...days].map(([key, list]) => {
    const section = document.createElement('section');
    section.className = 'day';
    const h = document.createElement('h3');
    h.textContent = dayTitle(key);
    const totals = document.createElement('div');
    totals.className = 'totals';
    renderTotals(totals, list);
    const ol = document.createElement('ol');
    ol.className = 'set-list';
    ol.append(...list.map(setRow));
    section.append(h, totals, ol);
    return section;
  }));

  renderBackupInfo();
}

function renderBackupInfo() {
  let last = null;
  try { last = localStorage.getItem(BACKUP_KEY); } catch { /* нет доступа */ }
  const el = $('backup-info');
  if (isSignedIn()) {
    el.textContent = 'История и так хранится в облаке — файл нужен только про запас.';
    return;
  }
  if (!last) {
    el.textContent = sets.length ? 'Резервную копию ещё не делали.' : '';
    return;
  }
  const days = Math.floor((Date.now() - new Date(last)) / 86400000);
  const when = days <= 0 ? 'сегодня' : days === 1 ? 'вчера' : `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  el.textContent = `Последняя резервная копия: ${when}.`;
}

// ---------- Правка подхода ----------

function openEdit(s) {
  editing = s;
  $('edit-title').textContent = nameOf(s.exercise);
  $('edit-when').textContent = `${dayTitle(dayKey(s.startedAt))}, ${timeOf(s.startedAt)}`;
  $('edit-reps').value = s.reps;
  $('set-dialog').showModal();
}

function stepReps(delta) {
  const input = $('edit-reps');
  input.value = Math.max(0, (parseInt(input.value, 10) || 0) + delta);
}

async function saveEdit() {
  const reps = parseInt($('edit-reps').value, 10);
  if (!editing || !Number.isFinite(reps) || reps < 0) return;
  await updateSet({ ...editing, reps });
  $('set-dialog').close();
  await refresh();
  syncSoon();
}

async function removeEdit() {
  if (!editing) return;
  if (!confirm(`Удалить подход: ${nameOf(editing.exercise)}, ${editing.reps}?`)) return;
  await deleteSet(editing.id);
  $('set-dialog').close();
  await refresh();
  syncSoon();
}

// ---------- Файлы ----------

function stamp() {
  return dayKey(new Date().toISOString());
}

// На iPhone открывает меню «Поделиться» (там есть «Сохранить в Файлы»),
// в других браузерах — просто скачивает файл.
async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      console.warn('Поделиться не получилось, скачиваю', err);
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

async function exportJson() {
  const data = {
    app: 'fitness-tracker',
    format: 1,
    exportedAt: new Date().toISOString(),
    sets: sets.map(({ exercise, reps, startedAt, endedAt, reason }) => ({ exercise, reps, startedAt, endedAt, reason })),
  };
  const ok = await saveFile(`trenirovki-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
  if (ok) {
    try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch { /* нет доступа */ }
    renderBackupInfo();
  }
}

// Таблица для Excel / Numbers: разделитель «;» и метка UTF-8, чтобы русский текст не поломался.
async function exportCsv() {
  const rows = [['Дата', 'Начало', 'Конец', 'Упражнение', 'Повторения']];
  for (const s of [...sets].reverse()) {
    rows.push([dayKey(s.startedAt), timeOf(s.startedAt), timeOf(s.endedAt), nameOf(s.exercise), s.reps]);
  }
  const csv = '﻿' + rows.map((r) => r.join(';')).join('\r\n');
  await saveFile(`trenirovki-${stamp()}.csv`, csv, 'text/csv');
}

async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data?.sets) ? data.sets : null;
    if (!list) throw new Error('это не резервная копия тренировок');
    const valid = list.filter((r) => EXERCISE_NAMES[r?.exercise] && Number.isFinite(r.reps)
      && !Number.isNaN(Date.parse(r.startedAt)) && !Number.isNaN(Date.parse(r.endedAt)));
    const { added, skipped } = await importSets(valid);
    await refresh();
    syncSoon();
    alert(`Восстановлено подходов: ${added}.` + (skipped ? `\nУже были в истории: ${skipped}.` : ''));
  } catch (err) {
    console.error(err);
    alert(`Не удалось прочитать файл: ${err?.message || err}`);
  }
}

// ---------- Облако ----------

function agoText(iso) {
  const min = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
  return `${dayTitle(dayKey(iso)).toLowerCase()}, ${timeOf(iso)}`;
}

function renderCloud() {
  const st = cloudState();
  const signedIn = isSignedIn();
  $('cloud-out').classList.toggle('hidden', signedIn);
  $('cloud-in').classList.toggle('hidden', !signedIn);
  if (!signedIn) return;

  $('cloud-email-label').textContent = st.email;
  const status = {
    syncing: 'Синхронизирую…',
    offline: 'Нет интернета — отправлю, когда появится связь.',
    error: `Не получилось синхронизировать: ${st.message}`,
    idle: st.lastSync ? `Всё сохранено в облаке. Последняя синхронизация: ${agoText(st.lastSync)}.` : 'Готовлю синхронизацию…',
  }[st.status] || '';
  const el = $('cloud-status');
  el.textContent = status;
  el.classList.toggle('warn', st.status === 'error');
  $('cloud-sync').disabled = st.status === 'syncing';
}

function cloudError(text) {
  const el = $('cloud-error');
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

async function withBusy(button, fn) {
  button.disabled = true;
  cloudError('');
  try {
    await fn();
  } catch (err) {
    cloudError(err.message);
  } finally {
    button.disabled = false;
  }
}

function initCloudCard() {
  $('cloud-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('cloud-email').value.trim();
    const password = $('cloud-password').value;
    if (!email || !password) return;
    withBusy($('cloud-login'), async () => {
      await signIn(email, password);
      $('cloud-password').value = '';
      renderCloud();
    });
  });
  $('cloud-sync').addEventListener('click', () => sync());
  $('cloud-signout').addEventListener('click', () => {
    if (!confirm('Выйти из облака? История на этом телефоне останется, но перестанет синхронизироваться.')) return;
    withBusy($('cloud-signout'), signOut);
  });
  onCloudChange(() => { renderCloud(); renderBackupInfo(); });
  renderCloud();
  initCloud({ onDataChanged: refresh });
}

// ---------- Подключение ----------

export function initHistory({ show }) {
  showScreen = show;
  $('open-history').addEventListener('click', () => { showScreen('history'); refresh(); });
  $('history-back').addEventListener('click', () => showScreen('home'));
  $('summary-done').addEventListener('click', () => showScreen('home'));
  $('export-json').addEventListener('click', exportJson);
  $('export-csv').addEventListener('click', exportCsv);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) importFile(file);
  });
  $('edit-minus').addEventListener('click', () => stepReps(-1));
  $('edit-plus').addEventListener('click', () => stepReps(1));
  $('edit-save').addEventListener('click', saveEdit);
  $('edit-delete').addEventListener('click', removeEdit);
  $('edit-cancel').addEventListener('click', () => $('set-dialog').close());
  initCloudCard();
  refresh();
}
