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
  name = 'Приседания';
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
  name = 'Отжимания';
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
  name = 'Подтягивания';
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

export const EXERCISES = {
  squat: () => new Squat(),
  pushup: () => new Pushup(),
  pullup: () => new Pullup(),
};
