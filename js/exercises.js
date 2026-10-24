// Разбор позы для каждого упражнения: из точек скелета получаем одно число
// (угол или высоту), по которому считаются повторения.

// Номера точек MediaPipe Pose.
export const LM = {
  nose: 0,
  lShoulder: 11, rShoulder: 12,
  lElbow: 13, rElbow: 14,
  lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28,
};

const VISIBLE = 0.5;

// Угол в точке b (в градусах) между отрезками b→a и b→c, в 3D.
export function angle3d(a, b, c) {
  const v1 = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v2 = [c.x - b.x, c.y - b.y, c.z - b.z];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const len = Math.hypot(...v1) * Math.hypot(...v2);
  if (!len) return null;
  return (Math.acos(Math.max(-1, Math.min(1, dot / len))) * 180) / Math.PI;
}

const vis = (p) => (p ? p.visibility ?? 1 : 0);

// Насколько хорошо видна нога: по самой плохо видимой из трёх точек.
function legVisibility(lm, hip, knee, ankle) {
  return Math.min(vis(lm[hip]), vis(lm[knee]), vis(lm[ankle]));
}

export class SquatAnalyzer {
  constructor() {
    this.name = 'Приседания';
    this.reset();
  }

  reset() {
    this.standRef = null; // высота бёдер над щиколотками в положении стоя
    this.lastT = 0;
  }

  // lm — точки на кадре (0..1), world — те же точки в метрах (3D).
  analyze(lm, world, t, s) {
    const left = legVisibility(lm, LM.lHip, LM.lKnee, LM.lAnkle);
    const right = legVisibility(lm, LM.rHip, LM.rKnee, LM.rAnkle);
    const sides = [];
    if (left >= VISIBLE) sides.push('l');
    if (right >= VISIBLE) sides.push('r');
    if (!sides.length && Math.max(left, right) >= 0.3) sides.push(left > right ? 'l' : 'r');

    if (!sides.length) {
      this.reset();
      return { ok: false, hint: 'Не видно ног — отойдите дальше или поставьте телефон ниже' };
    }

    const idx = (side) => side === 'l'
      ? [LM.lHip, LM.lKnee, LM.lAnkle]
      : [LM.rHip, LM.rKnee, LM.rAnkle];

    // Угол в колене — по 3D-координатам, чтобы работало и при съёмке спереди.
    const angles = sides
      .map((side) => {
        const [h, k, a] = idx(side);
        return angle3d(world[h], world[k], world[a]);
      })
      .filter((v) => v != null);
    const knee = angles.length ? angles.reduce((x, y) => x + y, 0) / angles.length : null;

    // Высота бёдер над щиколотками на кадре, в % от высоты стоя.
    const avgY = (ids) => ids.reduce((sum, i) => sum + lm[i].y, 0) / ids.length;
    const hipY = avgY(sides.map((side) => idx(side)[0]));
    const ankleY = avgY(sides.map((side) => idx(side)[2]));
    const height = ankleY - hipY;

    // Высоту стоя запоминаем как максимум, который медленно «забывается»
    // (на случай, если человек отошёл дальше или ближе к телефону).
    const dt = this.lastT ? (t - this.lastT) / 1000 : 0;
    this.lastT = t;
    if (this.standRef == null || height > this.standRef) this.standRef = height;
    else this.standRef -= this.standRef * 0.005 * dt;
    const hips = this.standRef > 0 ? (height / this.standRef) * 100 : null;

    const useKnee = s.squatMethod !== 'hips';
    const joints = sides.flatMap((side) => idx(side));
    return {
      ok: true,
      knee,
      hips,
      value: useKnee ? knee : hips,
      down: useKnee ? s.squatKneeDown : s.squatHipDown,
      up: useKnee ? s.squatKneeUp : s.squatHipUp,
      unit: useKnee ? '°' : '%',
      // Диапазон для полоски глубины: [значение внизу до упора, значение стоя].
      range: useKnee ? [60, 180] : [40, 105],
      joints: useKnee ? joints : joints.filter((_, i) => i % 3 === 0),
    };
  }
}

export const EXERCISES = {
  squat: () => new SquatAnalyzer(),
};
