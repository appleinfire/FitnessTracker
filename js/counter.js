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

// Повторение = «отдых» → «работа» → снова «отдых» (например, стоя → внизу → стоя).
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

  // rule: { dir: 'below' | 'above', work, rest } — при dir 'below' «работа»,
  //   когда значение ниже порога work, «отдых» — когда выше rest; при 'above' наоборот.
  // countOn: 'return' — засчитать при возврате в «отдых», 'peak' — при достижении «работы»,
  //   'both' — каждый переход между сторонами (прыжки через линию туда и обратно).
  // Возвращает true, если только что засчитано повторение.
  update(value, t, { dir, work, rest }, countOn = 'return') {
    const isWork = dir === 'below' ? value <= work : value >= work;
    const isRest = dir === 'below' ? value >= rest : value <= rest;
    let target = isWork ? 'work' : isRest ? 'rest' : null;

    // Пока не увидели исходное положение, ничего не считаем.
    if (this.phase === 'unknown' && target === 'work' && countOn !== 'both') target = null;

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
    if (countOn === 'both') return prev !== 'unknown';
    return countOn === 'peak'
      ? prev === 'rest' && target === 'work'
      : prev === 'work' && target === 'rest';
  }
}
