// Цель на день: сколько повторений (всех упражнений вместе) сделать за день.
// «Каждый день» действует, пока её не поменяют; «только на сегодня» — до полуночи.

import { profileKey } from './profile.js';

const BASE_KEY = 'ft.goal';
const DEFAULT_GOAL = 100;
// У детей своя цель; пока её не задали — вдвое меньше.
const defaultGoal = () => (profileKey(BASE_KEY) === BASE_KEY ? DEFAULT_GOAL : DEFAULT_GOAL / 2);

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

function read() {
  try {
    return { daily: defaultGoal(), override: null, ...JSON.parse(localStorage.getItem(profileKey(BASE_KEY)) || '{}') };
  } catch {
    return { daily: defaultGoal(), override: null };
  }
}

function write(data) {
  try { localStorage.setItem(profileKey(BASE_KEY), JSON.stringify(data)); } catch { /* нет доступа */ }
}

// Цель на сегодня и откуда она: { value, todayOnly, daily }.
export function todayGoal() {
  const g = read();
  const todayOnly = g.override?.day === today();
  return { value: todayOnly ? g.override.value : g.daily, todayOnly, daily: g.daily };
}

export function setDailyGoal(value) {
  write({ daily: value, override: null });
}

export function setTodayGoal(value) {
  write({ ...read(), override: { day: today(), value } });
}
