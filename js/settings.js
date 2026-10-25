// Настройки хранятся в localStorage телефона.

const KEY = 'ft.settings.v1';

export const DEFAULTS = {
  squatMethod: 'knee',   // 'knee' — угол в колене, 'hips' — высота бёдер
  squatKneeDown: 110,    // внизу, если угол в колене меньше (°)
  squatKneeUp: 155,      // вверху, если угол больше (°)
  squatHipDown: 75,      // внизу, если бёдра ниже (% от высоты стоя)
  squatHipUp: 90,        // вверху, если выше (%)
  pushupMethod: 'elbow', // 'elbow' — угол в локте, 'shoulders' — высота плеч над запястьями
  pushupElbowDown: 95,
  pushupElbowUp: 140,    // на камере спереди прямые руки дают 145–160°
  pushupShoulderDown: 60,
  pushupShoulderUp: 80,
  pullupMethod: 'head',  // 'head' — голова относительно запястий, 'elbow' — угол в локте
  pullupHeadTop: 100,    // наверху, если голова поднялась до уровня перекладины (%)
  pullupHeadBottom: 40,  // внизу, если опустилась ниже (%; 0% — полный вис)
  pullupElbowTop: 90,
  pullupElbowBottom: 150,
  jackTop: 70,           // джампинг-джек «наверху»: руки и ноги разведены (%)
  jackBottom: 30,        // «внизу»: руки опущены, ноги вместе (%)
  lineGap: 44,           // расстояние между двумя линиями у ног, % ширины кадра
  lineMode: 'static',    // прыжки через линию: 'static' — одна, 'double' — две (через одну, потом через другую), 'moving' — едет (игра)
  setEndSec: 8,          // подход заканчивается после стольких секунд без повторений
  beep: true,
  voice: false,
  debug: true,
  model: 'full',         // 'full' — точная, 'lite' — быстрая
};

// Старые значения по умолчанию: если они остались в сохранённых настройках,
// значит человек их не трогал — заменяем на новые.
const OLD_DEFAULTS = {
  pushupElbowUp: [155],
  pushupShoulderUp: [85],
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const [key, olds] of Object.entries(OLD_DEFAULTS)) {
      if (olds.includes(saved[key])) delete saved[key];
    }
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

// Сохраняем только то, что отличается от значений по умолчанию, —
// тогда улучшенные значения по умолчанию доходят и до тех, кто уже пользуется.
export function saveSettings(settings) {
  const changed = {};
  for (const [key, value] of Object.entries(settings)) {
    if (value !== DEFAULTS[key]) changed[key] = value;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(changed));
  } catch {
    // Приватный режим или переполнено — просто не сохраняем.
  }
}
