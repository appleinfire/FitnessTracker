// Цель на день: сколько повторений (всех упражнений вместе) сделать за день.
// «Каждый день» действует, пока её не поменяют; «только на сегодня» — до полуночи.

const KEY = 'ft.goal';
const DEFAULT_GOAL = 100;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

function read() {
  try {
    return { daily: DEFAULT_GOAL, override: null, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { daily: DEFAULT_GOAL, override: null };
  }
}

function write(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* нет доступа */ }
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
