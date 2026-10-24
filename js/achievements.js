// Достижения: считаются из истории подходов, поэтому ничего отдельно не хранят
// и сами появляются на всех устройствах через облако.

const SEEN_KEY = 'ft.achievements.seen';

const localDay = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// Сводка по истории, из которой проверяются все достижения.
function summarize(sets) {
  const days = new Map(); // день → { reps, sets, exercises }
  const totals = { all: 0, squat: 0, pushup: 0, pullup: 0 };
  let bestSet = 0;
  let early = false;
  let late = false;
  for (const s of sets) {
    totals.all += s.reps;
    totals[s.exercise] = (totals[s.exercise] || 0) + s.reps;
    bestSet = Math.max(bestSet, s.reps);
    const hour = new Date(s.startedAt).getHours();
    if (hour < 8) early = true;
    if (hour >= 22) late = true;
    const key = localDay(s.startedAt);
    const day = days.get(key) || { reps: 0, sets: 0, exercises: new Set() };
    day.reps += s.reps;
    day.sets += 1;
    day.exercises.add(s.exercise);
    days.set(key, day);
  }

  // Самая длинная серия дней подряд за всё время.
  let longest = 0;
  for (const key of days.keys()) {
    const [y, m, d] = key.split('-').map(Number);
    const prev = new Date(y, m - 1, d - 1);
    if (days.has(localDay(prev.toISOString()))) continue; // не начало серии
    let n = 0;
    const cur = new Date(y, m - 1, d);
    while (days.has(localDay(cur.toISOString()))) {
      n += 1;
      cur.setDate(cur.getDate() + 1);
    }
    longest = Math.max(longest, n);
  }

  const dayList = [...days.values()];
  return {
    count: sets.length,
    totals,
    bestSet,
    early,
    late,
    longest,
    bestDayReps: Math.max(0, ...dayList.map((d) => d.reps)),
    bestDaySets: Math.max(0, ...dayList.map((d) => d.sets)),
    allThreeInDay: dayList.some((d) => d.exercises.size >= 3),
  };
}

export const ACHIEVEMENTS = [
  { id: 'first', icon: '🚀', name: 'Kickoff', desc: 'Первый подход', test: (s) => s.count >= 1 },
  { id: 'set10', icon: '🔟', name: 'Ten Up', desc: '10 повторений за подход', test: (s) => s.bestSet >= 10 },
  { id: 'set25', icon: '💪', name: 'Power Set', desc: '25 повторений за подход', test: (s) => s.bestSet >= 25 },
  { id: 'set50', icon: '🦾', name: 'Machine', desc: '50 повторений за подход', test: (s) => s.bestSet >= 50 },
  { id: 'day100', icon: '💯', name: 'Century', desc: '100 повторений за день', test: (s) => s.bestDayReps >= 100 },
  { id: 'day5sets', icon: '🔥', name: 'High Five', desc: '5 подходов за день', test: (s) => s.bestDaySets >= 5 },
  { id: 'trio', icon: '🎯', name: 'All-In', desc: 'Все три упражнения за день', test: (s) => s.allThreeInDay },
  { id: 'streak3', icon: '📅', name: 'Three-Peat', desc: 'Тренировки 3 дня подряд', test: (s) => s.longest >= 3 },
  { id: 'streak7', icon: '🗓️', name: 'Full Week', desc: 'Тренировки 7 дней подряд', test: (s) => s.longest >= 7 },
  { id: 'pullup100', icon: '🧗', name: 'Bar Boss', desc: '100 подтягиваний всего', test: (s) => s.totals.pullup >= 100 },
  { id: 'pushup500', icon: '🛡️', name: 'Iron Arms', desc: '500 отжиманий всего', test: (s) => s.totals.pushup >= 500 },
  { id: 'squat1000', icon: '🦵', name: 'Steel Legs', desc: '1000 приседаний всего', test: (s) => s.totals.squat >= 1000 },
  { id: 'total1000', icon: '🏅', name: 'Grinder', desc: '1000 повторений всего', test: (s) => s.totals.all >= 1000 },
  { id: 'total10000', icon: '🏆', name: 'Legend', desc: '10 000 повторений всего', test: (s) => s.totals.all >= 10000 },
  { id: 'early', icon: '🌅', name: 'Early Bird', desc: 'Подход до 8 утра', test: (s) => s.early },
  { id: 'late', icon: '🌙', name: 'Night Owl', desc: 'Подход после 22:00', test: (s) => s.late },
];

export function unlockedIds(sets) {
  const s = summarize(sets);
  return new Set(ACHIEVEMENTS.filter((a) => a.test(s)).map((a) => a.id));
}

function readSeen() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeSeen(ids) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids])); } catch { /* нет доступа */ }
}

// Достижения, полученные, но ещё не показанные в итогах тренировки.
// При самом первом запуске всё уже заработанное считаем показанным.
export function unseen(unlocked) {
  const seen = readSeen();
  if (!seen) {
    writeSeen(unlocked);
    return new Set();
  }
  return new Set([...unlocked].filter((id) => !seen.has(id)));
}

export function markSeen(unlocked) {
  writeSeen(new Set([...(readSeen() || []), ...unlocked]));
}
