import { loadSettings, saveSettings, DEFAULTS } from './settings.js';
import { RepCounter, Smoother } from './counter.js';
import { EXERCISES } from './exercises.js';
import { getLandmarker, drawPose } from './pose.js';
import { KeepAwake, Sound } from './device.js';

const $ = (id) => document.getElementById(id);

const ui = {
  home: $('home'),
  workout: $('workout'),
  start: $('start'),
  stop: $('stop'),
  homeError: $('home-error'),
  session: $('session'),
  sessionList: $('session-list'),
  video: $('video'),
  canvas: $('overlay'),
  exTitle: $('ex-title'),
  status: $('status'),
  counter: $('counter'),
  setTimer: $('set-timer'),
  meterFill: $('meter-fill'),
  meterWork: $('meter-work'),
  meterRest: $('meter-rest'),
  debug: $('debug'),
  toast: $('toast'),
  loading: $('loading'),
  loadingText: $('loading-text'),
  settings: $('settings'),
  settingsForm: $('settings-form'),
};

const ABSENT_END_MS = 3000; // столько без человека в кадре — и подход окончен

let settings = loadSettings();
let exerciseKey = 'squat';
const sound = new Sound();
const keepAwake = new KeepAwake($('keepawake'));
const sessionSets = [];

// Состояние текущей тренировки.
let running = false;
let stream = null;
let rafId = 0;
let pose = null;
let analyzer = null;
// Сглаживание и задержка подобраны так, чтобы успевать за быстрыми повторениями.
const smoother = new Smoother(50);
const counter = new RepCounter(60);
// Самая «глубокая» точка последнего движения — для проверки порогов.
let depth = { cur: null, raw: null, last: null, lastRaw: null };
let lastVideoTime = -1;
let set = null;
let lastSeenAt = 0;
let fps = { frames: 0, since: 0, value: 0 };
let wakeMode = '';

// ---------- Главный экран ----------

document.querySelectorAll('.exercise').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    exerciseKey = btn.dataset.exercise;
    document.querySelectorAll('.exercise').forEach((b) => {
      b.classList.toggle('selected', b === btn);
      b.setAttribute('aria-checked', String(b === btn));
    });
  });
});

ui.start.addEventListener('click', startWorkout);
ui.stop.addEventListener('click', () => stopWorkout());

function showHomeError(text) {
  ui.homeError.textContent = text;
  ui.homeError.classList.toggle('hidden', !text);
}

function renderSession() {
  ui.session.classList.toggle('hidden', sessionSets.length === 0);
  ui.sessionList.innerHTML = '';
  for (const s of sessionSets) {
    const li = document.createElement('li');
    const time = s.endedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `<b></b> — <span class="reps"></span> <span class="time"></span>`;
    li.querySelector('b').textContent = s.name;
    li.querySelector('.reps').textContent = `${s.reps} ${plural(s.reps, 'раз', 'раза', 'раз')}`;
    li.querySelector('.time').textContent = `· ${time}`;
    ui.sessionList.append(li);
  }
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// ---------- Настройки ----------

$('open-settings').addEventListener('click', () => {
  fillSettingsForm();
  ui.settings.showModal();
});

$('reset-settings').addEventListener('click', () => {
  settings = { ...DEFAULTS };
  saveSettings(settings);
  fillSettingsForm();
});

function fillSettingsForm() {
  const f = ui.settingsForm;
  for (const [key, value] of Object.entries(settings)) {
    const inputs = f.querySelectorAll(`[name="${key}"]`);
    inputs.forEach((input) => {
      if (input.type === 'radio') input.checked = input.value === value;
      else if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = value;
    });
  }
  updateOutputs();
}

function updateOutputs() {
  ui.settingsForm.querySelectorAll('output[data-for]').forEach((out) => {
    out.textContent = ui.settingsForm.elements[out.dataset.for].value;
  });
}

ui.settingsForm.addEventListener('input', (e) => {
  const input = e.target;
  if (!input.name) return;
  if (input.type === 'checkbox') settings[input.name] = input.checked;
  else if (input.type === 'range') settings[input.name] = Number(input.value);
  else settings[input.name] = input.value;
  saveSettings(settings);
  updateOutputs();
});

// ---------- Тренировка ----------

async function startWorkout() {
  showHomeError('');
  sound.unlock();

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showHomeError('Камера доступна только по защищённому адресу (https). Откройте приложение по ссылке GitHub Pages.');
    return;
  }

  analyzer = EXERCISES[exerciseKey]();
  ui.exTitle.textContent = analyzer.name;
  ui.home.classList.add('hidden');
  ui.workout.classList.remove('hidden');
  setLoading('Включаю камеру…');

  try {
    await startCamera();
  } catch (err) {
    console.error(err);
    backHome(cameraErrorText(err));
    return;
  }

  try {
    setLoading('Загружаю распознавание позы…\nВ первый раз это может занять до минуты.');
    pose = await getLandmarker(settings.model);
  } catch (err) {
    console.error(err);
    backHome(`Не удалось загрузить распознавание позы.\n${err?.message || err}`);
    return;
  }

  wakeMode = await keepAwake.enable();
  resetSet();
  counter.reset();
  smoother.reset();
  analyzer.reset();
  depth = { cur: null, raw: null, last: null, lastRaw: null };
  lastSeenAt = performance.now();
  fps = { frames: 0, since: performance.now(), value: 0 };
  running = true;
  setLoading(null);
  loop();
}

async function startCamera() {
  stopCamera();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  ui.video.srcObject = stream;
  await ui.video.play();
  if (!ui.video.videoWidth) {
    await new Promise((resolve) => ui.video.addEventListener('loadedmetadata', resolve, { once: true }));
  }
  lastVideoTime = -1;
}

function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  ui.video.srcObject = null;
}

function cameraErrorText(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Нет доступа к камере.\nРазрешите камеру: «Настройки» iPhone → Safari → Камера → «Спрашивать» или «Разрешить», затем нажмите «Начать» ещё раз.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Не нашлась фронтальная камера.';
  }
  if (name === 'NotReadableError') {
    return 'Камера занята другим приложением. Закройте его и попробуйте снова.';
  }
  return `Не удалось включить камеру: ${err?.message || name || err}`;
}

function stopWorkout(errorText = '') {
  if (set && set.reps > 0) finishSet('stop');
  backHome(errorText);
}

function backHome(errorText = '') {
  running = false;
  cancelAnimationFrame(rafId);
  stopCamera();
  keepAwake.disable();
  ui.workout.classList.add('hidden');
  ui.home.classList.remove('hidden');
  renderSession();
  showHomeError(errorText);
}

function setLoading(text) {
  ui.loading.classList.toggle('hidden', !text);
  if (text) ui.loadingText.textContent = text;
  ui.loadingText.style.whiteSpace = 'pre-line';
}

// iOS останавливает камеру, когда приложение уходит в фон. При возврате — включаем снова.
document.addEventListener('visibilitychange', async () => {
  if (!running || document.visibilityState !== 'visible') return;
  const track = stream?.getVideoTracks()[0];
  if (track && track.readyState === 'live') return;
  try {
    setLoading('Включаю камеру…');
    await startCamera();
    setLoading(null);
  } catch (err) {
    stopWorkout(cameraErrorText(err));
  }
});

// ---------- Подход ----------

function resetSet() {
  set = { reps: 0, lastRepAt: 0, startedAt: null };
  ui.counter.textContent = '0';
  ui.setTimer.textContent = '';
}

function onRep(t) {
  if (set.reps === 0) set.startedAt = new Date();
  set.reps += 1;
  set.lastRepAt = t;
  ui.counter.textContent = String(set.reps);
  ui.counter.classList.add('bump');
  setTimeout(() => ui.counter.classList.remove('bump'), 160);
  if (settings.voice) sound.say(String(set.reps));
  else if (settings.beep) sound.beep(880, 120);
}

function finishSet(reason) {
  const record = {
    exercise: exerciseKey,
    name: analyzer.name,
    reps: set.reps,
    startedAt: set.startedAt,
    endedAt: new Date(),
    reason,
  };
  sessionSets.push(record);
  const word = plural(record.reps, 'повторение', 'повторения', 'повторений');
  showToast(`Подход записан\n${record.name}: ${record.reps} ${word}`);
  if (settings.voice) sound.say(`Подход окончен. ${record.reps}`);
  else if (settings.beep) { sound.beep(660, 160); sound.beep(990, 220, 0.18); }
  resetSet();
}

let toastTimer = 0;
function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.style.whiteSpace = 'pre-line';
  ui.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.add('hidden'), 3500);
}

// ---------- Главный цикл: кадр → поза → счёт ----------

function loop() {
  if (!running) return;
  rafId = requestAnimationFrame(loop);

  const video = ui.video;
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const canvas = ui.canvas;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  const t = performance.now();
  let result;
  try {
    result = pose.landmarker.detectForVideo(video, t);
  } catch (err) {
    console.error(err);
    return;
  }
  countFps(t);

  const lm = result.landmarks?.[0];
  const world = result.worldLandmarks?.[0];
  const info = lm && world ? analyzer.analyze(lm, world, t, settings) : null;

  if (!info || !info.ok) {
    drawPose(canvas.getContext('2d'), lm);
    smoother.reset();
    // Короткие пропадания (на долю секунды) не сбрасывают фазу повторения.
    if (t - lastSeenAt > 1000) counter.reset();
    setStatus(info?.hint || 'Не вижу человека — встаньте в кадр целиком', 'warn');
    updateMeter(null);
    if (set.reps > 0 && t - lastSeenAt > ABSENT_END_MS) finishSet('absent');
    updateDebug(info);
    return;
  }

  lastSeenAt = t;
  const value = smoother.update(info.value, t);
  if (value != null && counter.update(value, t, info.rule, analyzer.countOn)) onRep(t);
  trackDepth(info, value);

  const phase = counter.phase;
  const color = phase === 'work' ? '#ff7a45' : '#c8ff3d';
  drawPose(canvas.getContext('2d'), lm, { highlight: info.joints, highlightColor: color });

  if (phase === 'unknown') setStatus(analyzer.startHint, 'warn');
  else setStatus(analyzer.prompts[phase], phase);

  updateMeter(value, info);

  if (set.reps > 0) {
    const left = settings.setEndSec * 1000 - (t - set.lastRepAt);
    if (left <= 0) finishSet('pause');
    else ui.setTimer.textContent = left < 4000 ? `Конец подхода через ${Math.ceil(left / 1000)}…` : '';
  }

  updateDebug(info, value);
}

let lastStatus = '';
function setStatus(text, kind) {
  const key = `${kind}|${text}`;
  if (key === lastStatus) return;
  lastStatus = key;
  ui.status.textContent = text;
  ui.status.className = `status ${kind}`;
}

function updateMeter(value, info) {
  if (value == null) {
    ui.meterFill.style.height = '0';
    return;
  }
  const [lo, hi] = info.range;
  const { dir, work, rest } = info.rule;
  const pos = (v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100;
  ui.meterFill.style.height = `${pos(value)}%`;
  ui.meterFill.classList.toggle('work', dir === 'below' ? value <= work : value >= work);
  ui.meterWork.style.bottom = `${pos(work)}%`;
  ui.meterRest.style.bottom = `${pos(rest)}%`;
}

function countFps(t) {
  fps.frames += 1;
  if (t - fps.since >= 1000) {
    fps.value = Math.round((fps.frames * 1000) / (t - fps.since));
    fps.frames = 0;
    fps.since = t;
  }
}

function trackDepth(info, value) {
  if (value == null || info.value == null) return;
  const { dir, rest } = info.rule;
  const deeper = (a, b) => (a == null ? b : dir === 'below' ? Math.min(a, b) : Math.max(a, b));
  const inRest = dir === 'below' ? value >= rest : value <= rest;
  if (!inRest) {
    depth.cur = deeper(depth.cur, value);
    depth.raw = deeper(depth.raw, info.value);
  } else if (depth.cur != null) {
    depth.last = depth.cur;
    depth.lastRaw = depth.raw;
    depth.cur = depth.raw = null;
  }
}

function updateDebug(info, value) {
  ui.debug.classList.toggle('hidden', !settings.debug);
  if (!settings.debug) return;
  const f = (v, unit) => (v == null ? '—' : `${Math.round(v)}${unit}`);
  const parts = [];
  if (info?.ok) {
    const { dir, work, rest } = info.rule;
    const [wSign, rSign] = dir === 'below' ? ['<', '>'] : ['>', '<'];
    for (const [label, v, unit] of info.metrics) parts.push(`${label} ${f(v, unit)}`);
    parts.push(`сглаж. ${f(value, info.unit)} (работа ${wSign} ${work}, отдых ${rSign} ${rest})`);
    if (depth.last != null) parts.push(`предел движения ${f(depth.last, info.unit)} (без сглаж. ${f(depth.lastRaw, info.unit)})`);
  }
  parts.push(`${fps.value} к/с`, pose?.delegate === 'GPU' ? 'GPU' : 'CPU');
  if (wakeMode !== 'wakelock') parts.push(wakeMode === 'video' ? 'экран: запасной режим' : 'экран может погаснуть');
  ui.debug.textContent = parts.join(' · ');
}

// ---------- Офлайн-режим ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker не зарегистрирован', err));
  });
}
