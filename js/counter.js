// Сглаживание сигнала и счётчик повторений с двумя порогами (гистерезис).

// Экспоненциальное сглаживание, не зависящее от частоты кадров.
export class Smoother {
  constructor(tauMs = 120) {
    this.tau = tauMs;
    this.reset();
  }

  reset() {
    this.value = null;
    this.t = 0;
  }

  update(v, t) {
    if (v == null || !Number.isFinite(v)) {
      this.reset();
      return null;
    }
    if (this.value == null) {
      this.value = v;
    } else {
      const a = 1 - Math.exp(-(t - this.t) / this.tau);
      this.value += a * (v - this.value);
    }
    this.t = t;
    return this.value;
  }
}

// Повторение = «вверху» → «внизу» → снова «вверху».
// Между порогами — мёртвая зона: там фаза не меняется, поэтому дрожание сигнала
// не даёт ложных повторений. Новая фаза засчитывается, только если сигнал
// продержался за порогом holdMs миллисекунд.
export class RepCounter {
  constructor(holdMs = 120) {
    this.holdMs = holdMs;
    this.reset();
  }

  reset() {
    this.phase = 'unknown';
    this.pending = null;
    this.pendingSince = 0;
  }

  // Возвращает true, если только что завершилось повторение.
  update(value, t, downBelow, upAbove) {
    let target = null;
    if (value <= downBelow) target = 'down';
    else if (value >= upAbove) target = 'up';

    // Пока не увидели исходное положение «вверху», ничего не считаем.
    if (this.phase === 'unknown' && target === 'down') target = null;

    if (!target || target === this.phase) {
      this.pending = null;
      return false;
    }
    if (this.pending !== target) {
      this.pending = target;
      this.pendingSince = t;
      return false;
    }
    if (t - this.pendingSince < this.holdMs) return false;

    const prev = this.phase;
    this.phase = target;
    this.pending = null;
    return prev === 'down' && target === 'up';
  }
}
