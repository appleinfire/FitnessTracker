// Настройки хранятся в localStorage телефона.

const KEY = 'ft.settings.v1';

export const DEFAULTS = {
  squatMethod: 'knee',   // 'knee' — угол в колене, 'hips' — высота бёдер
  squatKneeDown: 110,    // внизу, если угол в колене меньше (°)
  squatKneeUp: 155,      // вверху, если угол больше (°)
  squatHipDown: 75,      // внизу, если бёдра ниже (% от высоты стоя)
  squatHipUp: 90,        // вверху, если выше (%)
  setEndSec: 8,          // подход заканчивается после стольких секунд без повторений
  beep: true,
  voice: false,
  debug: true,
  model: 'full',         // 'full' — точная, 'lite' — быстрая
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Приватный режим или переполнено — просто не сохраняем.
  }
}
