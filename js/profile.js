// Профиль: чья сейчас тренировка — «Я» или «Kids». У каждого свой журнал,
// цель, рекорды и достижения. Это не отдельный аккаунт: данные одного телефона
// (и одного облачного входа), просто помеченные профилем.

const KEY = 'ft.profile';

export const PROFILES = { me: 'Я', kids: 'Kids' };

let current = 'me';
try { current = PROFILES[localStorage.getItem(KEY)] ? localStorage.getItem(KEY) : 'me'; } catch { /* нет доступа */ }

export const getProfile = () => current;

// Подходы, записанные до появления профилей, — мои.
export const profileOf = (record) => record.profile || 'me';

// Ключ хранилища для настроек профиля: у «Я» — прежний, чтобы ничего не потерялось.
export const profileKey = (base) => (current === 'me' ? base : `${base}.${current}`);

export function setProfile(p) {
  if (!PROFILES[p]) return;
  current = p;
  try { localStorage.setItem(KEY, p); } catch { /* нет доступа */ }
  applyProfileTheme();
}

export function applyProfileTheme() {
  document.body.classList.toggle('kids', current === 'kids');
}
