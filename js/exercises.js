// Разбор позы для каждого упражнения: из точек скелета получаем одно число
// (угол или высоту), по которому считаются повторения.
//
// У каждого упражнения есть исходное положение («отдых») и рабочее («работа»):
// приседания — стоя / внизу, отжимания — руки прямые / внизу,
// подтягивания — вис / подбородок у перекладины.

// Номера точек MediaPipe Pose.
export const LM = {
  nose: 0,
  lEar: 7, rEar: 8,
  lShoulder: 11, rShoulder: 12,
  lElbow: 13, rElbow: 14,
  lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28,
};

export const EXERCISE_NAMES = {
  squat: 'Приседания',
  pushup: 'Отжимания',
  pullup: 'Подтягивания',
  jack: 'Джампинг-джеки',
  line: 'Прыжки через линию',
};

const LEGS = [[LM.lHip, LM.lKnee, LM.lAnkle], [LM.rHip, LM.rKnee, LM.rAnkle]];
const ARMS = [[LM.lShoulder, LM.lElbow, LM.lWrist], [LM.rShoulder, LM.rElbow, LM.rWrist]];

const VISIBLE = 0.5;
const vis = (p) => (p ? p.visibility ?? 1 : 0);
const mean = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;

// Угол в точке b (в градусах) между отрезками b→a и b→c, в 3D.
export function angle3d(a, b, c) {
  const v1 = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v2 = [c.x - b.x, c.y - b.y, c.z - b.z];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const len = Math.hypot(...v1) * Math.hypot(...v2);
  if (!len) return null;
  return (Math.acos(Math.max(-1, Math.min(1, dot / len))) * 180) / Math.PI;
}

// Какие стороны тела (левая/правая конечность) видно достаточно хорошо.
// Конечность видна настолько, насколько видна её худшая точка.
function visibleLimbs(lm, [left, right]) {
  const l = Math.min(...left.map((i) => vis(lm[i])));
  const r = Math.min(...right.map((i) => vis(lm[i])));
  const limbs = [];
  if (l >= VISIBLE) limbs.push(left);
  if (r >= VISIBLE) limbs.push(right);
  if (!limbs.length && Math.max(l, r) >= 0.3) limbs.push(l > r ? left : right);
  return limbs;
}

// Средний угол в средней точке конечностей (колено, локоть), по 3D-координатам —
// так угол верный и при съёмке спереди, а не только сбоку.
function limbAngle(world, limbs) {
  const angles = limbs
    .map(([a, b, c]) => angle3d(world[a], world[b], world[c]))
    .filter((v) => v != null);
  return angles.length ? mean(angles) : null;
}

const avgY = (lm, ids) => mean(ids.map((i) => lm[i].y));

// Запоминает «эталон» — наибольшее значение — и медленно его забывает
// (на случай, если человек отошёл дальше или ближе к телефону).
// Возвращает текущее значение в процентах от эталона.
class RefTracker {
  constructor(decayPerSec = 0.005) {
    this.decay = decayPerSec;
    this.reset();
  }

  reset() {
    this.ref = null;
    this.t = 0;
  }

  percent(v, t) {
    const dt = this.t ? (t - this.t) / 1000 : 0;
    this.t = t;
    if (this.ref == null || v > this.ref) this.ref = v;
    else this.ref -= this.ref * this.decay * dt;
    return this.ref > 0 ? (v / this.ref) * 100 : null;
  }
}

// ---------- Приседания ----------

class Squat {
  name = EXERCISE_NAMES.squat;
  startHint = 'Встаньте прямо, чтобы начать';
  prompts = { rest: 'Вниз ↓', work: 'Вверх ↑' };
  countOn = 'return'; // повторение засчитывается, когда встали обратно

  constructor() { this.hips = new RefTracker(); }
  reset() { this.hips.reset(); }

  analyze(lm, world, t, s) {
    const legs = visibleLimbs(lm, LEGS);
    if (!legs.length) {
      this.reset();
      return { ok: false, hint: 'Не видно ног — отойдите дальше или поставьте телефон ниже' };
    }

    const knee = limbAngle(world, legs);
    // Высота бёдер над щиколотками на кадре, в % от высоты стоя.
    const hips = this.hips.percent(avgY(lm, legs.map((l) => l[2])) - avgY(lm, legs.map((l) => l[0])), t);

    const byKnee = s.squatMethod !== 'hips';
    const joints = legs.flat();
    return {
      ok: true,
      value: byKnee ? knee : hips,
      unit: byKnee ? '°' : '%',
      rule: byKnee
        ? { dir: 'below', work: s.squatKneeDown, rest: s.squatKneeUp }
        : { dir: 'below', work: s.squatHipDown, rest: s.squatHipUp },
      range: byKnee ? [60, 180] : [30, 105],
      metrics: [['колено', knee, '°'], ['бёдра', hips, '%']],
      joints: byKnee ? joints : legs.map((l) => l[0]),
    };
  }
}

// ---------- Отжимания ----------

class Pushup {
  name = EXERCISE_NAMES.pushup;
  startHint = 'Примите упор лёжа на прямых руках';
  prompts = { rest: 'Вниз ↓', work: 'Вверх ↑' };
  countOn = 'return'; // засчитывается, когда руки снова выпрямились

  constructor() { this.shoulders = new RefTracker(); }
  reset() { this.shoulders.reset(); }

  analyze(lm, world, t, s) {
    const arms = visibleLimbs(lm, ARMS);
    if (!arms.length) {
      this.reset();
      return { ok: false, hint: 'Не видно рук — поставьте телефон так, чтобы были видны руки и плечи' };
    }

    // Если тело стоит вертикально — это не отжимания (защита от ложного счёта,
    // когда человек встал и машет руками). Проверяем, только если видно бёдра.
    const hipsSeen = vis(lm[LM.lHip]) >= VISIBLE || vis(lm[LM.rHip]) >= VISIBLE;
    if (hipsSeen) {
      const sh = midpoint(world, LM.lShoulder, LM.rShoulder);
      const hp = midpoint(world, LM.lHip, LM.rHip);
      const len = Math.hypot(sh.x - hp.x, sh.y - hp.y, sh.z - hp.z);
      const upright = len ? Math.abs(sh.y - hp.y) / len : 0;
      if (upright > 0.85) {
        this.reset();
        return { ok: false, hint: this.startHint };
      }
    }

    const elbow = limbAngle(world, arms);
    // Высота плеч над запястьями на кадре, в % от высоты на прямых руках.
    const shoulders = this.shoulders.percent(avgY(lm, arms.map((a) => a[2])) - avgY(lm, arms.map((a) => a[0])), t);

    const byElbow = s.pushupMethod !== 'shoulders';
    return {
      ok: true,
      value: byElbow ? elbow : shoulders,
      unit: byElbow ? '°' : '%',
      rule: byElbow
        ? { dir: 'below', work: s.pushupElbowDown, rest: s.pushupElbowUp }
        : { dir: 'below', work: s.pushupShoulderDown, rest: s.pushupShoulderUp },
      range: byElbow ? [40, 180] : [0, 105],
      metrics: [['локоть', elbow, '°'], ['плечи', shoulders, '%']],
      joints: byElbow ? arms.map((a) => a[1]) : arms.map((a) => a[0]),
    };
  }
}

function midpoint(pts, a, b) {
  return { x: (pts[a].x + pts[b].x) / 2, y: (pts[a].y + pts[b].y) / 2, z: (pts[a].z + pts[b].z) / 2 };
}

// ---------- Подтягивания ----------

class Pullup {
  name = EXERCISE_NAMES.pullup;
  startHint = 'Повисните на турнике';
  prompts = { rest: 'Вверх ↑', work: 'Вниз ↓' };
  countOn = 'peak'; // засчитывается, когда голова дошла до перекладины

  constructor() { this.hang = new RefTracker(); }
  reset() { this.hang.reset(); }

  analyze(lm, world, t, s) {
    const arms = visibleLimbs(lm, ARMS);
    if (!arms.length) {
      this.reset();
      return { ok: false, hint: 'Не видно рук — отойдите дальше, чтобы турник был в кадре' };
    }

    // На турнике запястья выше локтей (и в висе, и наверху).
    // Если опустились ниже — человек спрыгнул или ещё не повис.
    const wristY = avgY(lm, arms.map((a) => a[2]));
    const elbowY = avgY(lm, arms.map((a) => a[1]));
    if (wristY > elbowY - 0.02) {
      this.reset();
      return { ok: false, hint: this.startHint };
    }

    // Голова: нос и уши (уши видно, даже если человек спиной к телефону).
    const headY = avgY(lm, [LM.nose, LM.lEar, LM.rEar]);
    // Насколько голова ниже перекладины (запястий); в висе — больше всего.
    const below = headY - wristY;
    // 0% — полный вис, 100% — голова на уровне перекладины, больше 100% — выше.
    const pct = this.hang.percent(below, t);
    const head = pct == null ? null : 100 - pct;
    const elbow = limbAngle(world, arms);

    const byHead = s.pullupMethod !== 'elbow';
    return {
      ok: true,
      value: byHead ? head : elbow,
      unit: byHead ? '%' : '°',
      rule: byHead
        ? { dir: 'above', work: s.pullupHeadTop, rest: s.pullupHeadBottom }
        : { dir: 'below', work: s.pullupElbowTop, rest: s.pullupElbowBottom },
      range: byHead ? [0, 120] : [40, 180],
      metrics: [['голова', head, '%'], ['локоть', elbow, '°']],
      joints: byHead ? [LM.nose, ...arms.map((a) => a[2])] : arms.map((a) => a[1]),
    };
  }
}

// ---------- Джампинг-джеки ----------

class JumpingJack {
  name = EXERCISE_NAMES.jack;
  startHint = 'Встаньте прямо: ноги вместе, руки внизу';
  prompts = { rest: 'Прыжок: руки вверх ↑', work: 'Обратно ↓' };
  countOn = 'peak'; // темп быстрый — засчитываем сразу, как только руки вверху и ноги врозь

  reset() {}

  analyze(lm, world, t, s) {
    const need = [LM.lShoulder, LM.rShoulder, LM.lWrist, LM.rWrist, LM.lHip, LM.rHip, LM.lAnkle, LM.rAnkle];
    if (Math.min(...need.map((i) => vis(lm[i]))) < 0.3) {
      return { ok: false, hint: 'Нужно видеть всё тело — от рук над головой до ступней' };
    }
    const shoulderY = avgY(lm, [LM.lShoulder, LM.rShoulder]);
    const hipY = avgY(lm, [LM.lHip, LM.rHip]);
    const torso = Math.abs(hipY - shoulderY);
    const hipWidth = Math.abs(lm[LM.lHip].x - lm[LM.rHip].x);
    if (torso < 0.02 || hipWidth < 0.01) return { ok: false, hint: this.startHint };

    // Руки: −1 — внизу у бёдер, +1 — над головой (в длинах туловища).
    const arms = (shoulderY - avgY(lm, [LM.lWrist, LM.rWrist])) / torso;
    // Ноги: расстояние между щиколотками в ширинах таза (вместе ≈ 1, врозь ≈ 3).
    const legs = Math.abs(lm[LM.lAnkle].x - lm[LM.rAnkle].x) / hipWidth;
    const clamp = (v) => Math.max(0, Math.min(100, v));
    const armsPct = clamp(((arms + 1) / 2) * 100);
    const legsPct = clamp(((legs - 1.2) / 1.6) * 100);
    const value = (armsPct + legsPct) / 2;

    return {
      ok: true,
      value,
      unit: '%',
      rule: { dir: 'above', work: s.jackTop, rest: s.jackBottom },
      range: [0, 100],
      metrics: [['руки', armsPct, '%'], ['ноги', legsPct, '%'], ['вместе', value, '%']],
      joints: [LM.lWrist, LM.rWrist, LM.lAnkle, LM.rAnkle],
    };
  }
}

// ---------- Прыжки через линию (для детей) ----------
// Линия идёт по полу от телефона к ребёнку, посередине кадра. Прыгать — влево-вправо;
// каждый перепрыг в любую сторону — повторение. Сторона определяется по щиколоткам:
// обе слева от линии или обе справа.

// Половина расстояния между двумя линиями, в долях ширины кадра (у ног).
const TWO_LINES_HALF = 0.13;

// Одна светящаяся линия на полу: от низа кадра (xBottom) до ног (xTop, top).
function strip(ctx, xBottom, xTop, top, tint, flash) {
  const { width: w, height: h } = ctx.canvas;
  ctx.save();
  ctx.shadowColor = tint;
  ctx.shadowBlur = w * (0.02 + 0.04 * flash);
  const grad = ctx.createLinearGradient(0, h, 0, top);
  grad.addColorStop(0, tint);
  grad.addColorStop(1, 'rgba(255,255,255,0.15)');
  ctx.fillStyle = flash ? '#ffffff' : grad;
  ctx.globalAlpha = 0.95;
  const bottomHalf = w * 0.05;
  const topHalf = w * 0.01;
  ctx.beginPath();
  ctx.moveTo(xBottom - bottomHalf, h);
  ctx.lineTo(xTop - topHalf, top);
  ctx.lineTo(xTop + topHalf, top);
  ctx.lineTo(xBottom + bottomHalf, h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

class LineHop {
  name = EXERCISE_NAMES.line;
  startHint = 'Встань сбоку от линии';
  prompts = { rest: 'Прыгай через линию!', work: 'Прыгай через линию!' };
  countOn = 'both';
  lineX = 0.5;

  // mode: 'static' — линия стоит, прыгать через неё туда-обратно;
  //       'moving' — линия едет по полу, надо подпрыгнуть, когда она проезжает под ногами.
  constructor(mode = 'static') {
    this.moving = mode === 'moving';
    this.double = mode === 'double'; // две линии: через первую, потом через вторую — одно очко
    this.noPauseEnd = this.moving; // в игре подход заканчивается, только когда ребёнок ушёл из кадра
    this.reset();
  }

  reset() {
    this.flashAt = 0;
    this.missAt = 0;
    this.ground = null;   // уровень пола (щиколотки стоя), в долях высоты кадра
    this.airAt = -1e9;    // когда последний раз обе ноги были над полом
    this.state = 'idle';  // 'idle' — пауза перед заездом, 'run' — линия едет
    this.nextStart = 0;
    this.pos = 0;         // где линия на экране: 0 — левый край, 1 — правый
    this.speed = 0.3;     // экранов в секунду
    this.zoneEnter = null;
    this.lastT = 0;
    this.prevT = 0;
    this.from = null;     // две линии: с какой стороны начат прыжок — 'L' или 'R'
    this.mid = false;     // уже перепрыгнул первую и стоит между линиями
    this.midSince = 0;
  }

  onRep(t) { this.flashAt = t; }

  analyze(lm, world, t) {
    const need = [LM.lHip, LM.rHip, LM.lAnkle, LM.rAnkle];
    if (Math.min(...need.map((i) => vis(lm[i]))) < 0.3) {
      this.lastT = 0; // игра на паузе, пока не видно ног
      this.prevT = 0;
      return { ok: false, hint: 'Не видно ног — отойди дальше, чтобы были видны ступни' };
    }
    const xs = [lm[LM.lAnkle].x, lm[LM.rAnkle].x];
    this.feetY = avgY(lm, [LM.lAnkle, LM.rAnkle]);
    if (this.moving) return this.game(lm, xs, t);
    if (this.double) return this.twoLines(lm, xs, t);
    return this.still(lm, xs);
  }

  still(lm, xs) {
    const hipWidth = Math.max(0.02, Math.abs(lm[LM.lHip].x - lm[LM.rHip].x));
    // Насколько обе ноги по одну сторону от линии (в ширинах таза); 0 — стоит на линии.
    let side = 0;
    if (Math.min(...xs) > this.lineX) side = (Math.min(...xs) - this.lineX) / hipWidth;
    else if (Math.max(...xs) < this.lineX) side = (Math.max(...xs) - this.lineX) / hipWidth;
    return {
      ok: true,
      value: side,
      unit: '',
      rule: { dir: 'above', work: 0.15, rest: -0.15 },
      range: [-1, 1],
      noRing: true, // кольцо только вспыхивает на прыжке, заполнять его нечем
      metrics: [['сторона', side * 100, '%']],
      joints: [LM.lAnkle, LM.rAnkle],
    };
  }

  // Уровень пола (по щиколоткам стоя) и длина ноги — чтобы понимать, где нога: на полу или в воздухе.
  updateGround(lm, t) {
    const lowFoot = Math.max(lm[LM.lAnkle].y, lm[LM.rAnkle].y);
    const dt = this.lastT ? (t - this.lastT) / 1000 : 0;
    this.lastT = t;
    if (this.ground == null || lowFoot > this.ground) this.ground = lowFoot;
    else this.ground -= (this.ground - lowFoot) * Math.min(1, dt * 0.3); // медленно подстраиваемся
    return Math.max(0.05, this.ground - avgY(lm, [LM.lHip, LM.rHip]));
  }

  // Две линии на расстоянии друг от друга: прыжок через первую (приземлиться между ними),
  // потом через вторую — одно очко. Потом так же обратно.
  twoLines(lm, xs, t) {
    const g = TWO_LINES_HALF;
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    let zone = null;
    if (hi < this.lineX - g) zone = 'L';
    else if (lo > this.lineX + g) zone = 'R';
    else if (lo > this.lineX - g && hi < this.lineX + g) zone = 'M';

    let repNow = false;
    let halfNow = false;
    if (zone === 'L' || zone === 'R') {
      // Пришёл на другую сторону через середину — очко.
      if (this.mid && this.from && zone !== this.from) repNow = true;
      this.from = zone;
      this.mid = false;
    } else if (zone === 'M' && this.from && !this.mid) {
      // Приземлился между линиями (а не пролетел над серединой) — пробыл там ≥ 180 мс.
      this.midSince = this.midSince || t;
      if (t - this.midSince >= 180) {
        this.mid = true;
        halfNow = true;
      }
    }
    if (zone !== 'M') this.midSince = 0;
    let text = 'Встань сбоку от линий';
    if (this.from) text = this.mid ? 'Теперь через вторую!' : 'Прыгай через первую линию!';
    return {
      ok: true,
      game: true,
      repNow,
      halfNow,
      status: { text, kind: this.from ? (this.mid ? 'work' : 'rest') : 'warn' },
      value: 0,
      rule: { dir: 'above', work: 1, rest: -1 },
      range: [-1, 1],
      noRing: true,
      metrics: [['зона', { L: -100, M: 0, R: 100 }[zone] ?? 50, '%']],
      joints: [LM.lAnkle, LM.rAnkle],
    };
  }

  game(lm, xs, t) {
    // Отрыв от пола: нижняя из двух ног выше уровня пола на 8% длины ноги.
    const lowFoot = Math.max(lm[LM.lAnkle].y, lm[LM.rAnkle].y);
    const leg = this.updateGround(lm, t);
    const dt = this.prevT ? (t - this.prevT) / 1000 : 0;
    this.prevT = t;
    const lift = (this.ground - lowFoot) / leg;
    if (lift > 0.08) this.airAt = t;

    let repNow = false;
    let missNow = false;
    if (this.state === 'idle' && t >= this.nextStart) {
      this.state = 'run';
      this.pos = -0.05;
    }
    if (this.state === 'run') {
      this.pos += this.speed * dt;
      // Экран зеркальный: позиция на экране pos — это 1 − pos на кадре камеры.
      const x = 1 - this.pos;
      const inZone = x >= Math.min(...xs) - 0.03 && x <= Math.max(...xs) + 0.03;
      if (inZone && this.zoneEnter == null) this.zoneEnter = t;
      if (!inZone && this.zoneEnter != null) {
        // Линия проехала под ногами: успел ли подпрыгнуть (с небольшим запасом по времени)?
        if (this.airAt >= this.zoneEnter - 200) {
          repNow = true;
          this.speed = Math.min(0.75, this.speed * 1.08);
        } else {
          missNow = true;
          this.missAt = t;
          this.speed = Math.max(0.25, this.speed * 0.85);
        }
        this.zoneEnter = null;
      }
      if (this.pos > 1.05) {
        this.state = 'idle';
        this.nextStart = t + 800;
      }
    }

    const missed = t - this.missAt < 1200;
    return {
      ok: true,
      game: true,
      repNow,
      missNow,
      status: missed
        ? { text: 'Мимо! Ещё раз', kind: 'warn' }
        : { text: this.state === 'run' ? 'Прыгай, когда линия под ногами!' : 'Приготовься…', kind: 'rest' },
      value: 0,
      rule: { dir: 'above', work: 1, rest: -1 },
      range: [-1, 1],
      noRing: true,
      metrics: [['над полом', lift * 100, '%'], ['скорость', this.speed * 100, '%']],
      joints: [LM.lAnkle, LM.rAnkle],
    };
  }

  // Светящаяся «лента» на полу: от низа кадра до ног, сужается в перспективе.
  overlay(ctx, t, color) {
    if (this.moving && this.state !== 'run' && t - this.missAt > 400) return;
    const { width: w, height: h } = ctx.canvas;
    const top = Math.max(0.35, Math.min(0.95, (this.feetY || 0.88) - 0.06)) * h;
    const flash = this.flashAt && t - this.flashAt < 350 ? 1 - (t - this.flashAt) / 350 : 0;
    const tint = t - this.missAt < 400 ? '#FF4D4D' : color;
    if (!this.double) {
      const cx = (this.moving ? 1 - this.pos : this.lineX) * w;
      strip(ctx, cx, cx, top, tint, flash);
      return;
    }
    // Две линии на расстоянии: у ног — как при подсчёте, ближе к телефону расходятся (перспектива).
    // Первая перепрыгнутая линия светится белым, пока ребёнок между линиями.
    const g = TWO_LINES_HALF * w;
    const cx = this.lineX * w;
    ctx.save();
    ctx.fillStyle = this.mid ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.moveTo(cx - g * 1.5, h);
    ctx.lineTo(cx - g, top);
    ctx.lineTo(cx + g, top);
    ctx.lineTo(cx + g * 1.5, h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const done = (side) => (this.mid && this.from === side ? '#ffffff' : tint);
    strip(ctx, cx - g * 1.5, cx - g, top, done('L'), flash);
    strip(ctx, cx + g * 1.5, cx + g, top, done('R'), flash);
  }
}

export const EXERCISES = {
  squat: () => new Squat(),
  pushup: () => new Pushup(),
  pullup: () => new Pullup(),
  jack: () => new JumpingJack(),
  line: (s) => new LineHop(s?.lineMode),
};
