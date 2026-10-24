// История тренировок: сводка «Сегодня» на главном экране, экран истории,
// правка и удаление подходов, резервная копия в файл и восстановление.

import { addSet, updateSet, deleteSet, allSets, importSets } from './db.js';
import { EXERCISE_NAMES } from './exercises.js';

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

// «Отжимания 30 · Приседания 45» — сумма повторений по упражнениям.
function totalsText(list) {
  const totals = new Map();
  for (const s of list) totals.set(s.exercise, (totals.get(s.exercise) || 0) + s.reps);
  return [...totals].map(([ex, reps]) => `${nameOf(ex)} ${reps}`).join(' · ');
}

function setRow(s) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.className = 'set-row';
  btn.innerHTML = '<span class="set-time"></span><span class="set-name"></span><span class="set-reps"></span>';
  btn.querySelector('.set-time').textContent = timeOf(s.startedAt);
  btn.querySelector('.set-name').textContent = nameOf(s.exercise);
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
  $('today-totals').textContent = totalsText(list);
  const ol = $('today-list');
  ol.replaceChildren(...list.map(setRow));
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
    const totals = document.createElement('p');
    totals.className = 'day-totals';
    totals.textContent = totalsText(list);
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
}

async function removeEdit() {
  if (!editing) return;
  if (!confirm(`Удалить подход: ${nameOf(editing.exercise)}, ${editing.reps}?`)) return;
  await deleteSet(editing.id);
  $('set-dialog').close();
  await refresh();
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
    sets: sets.map(({ id, ...rest }) => rest),
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
    alert(`Восстановлено подходов: ${added}.` + (skipped ? `\nУже были в истории: ${skipped}.` : ''));
  } catch (err) {
    console.error(err);
    alert(`Не удалось прочитать файл: ${err?.message || err}`);
  }
}

// ---------- Подключение ----------

export function initHistory({ show }) {
  showScreen = show;
  $('open-history').addEventListener('click', () => { showScreen('history'); refresh(); });
  $('history-back').addEventListener('click', () => showScreen('home'));
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
  refresh();
}
