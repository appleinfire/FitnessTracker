// Загрузка MediaPipe Pose Landmarker и рисование скелета.
// Всё работает на телефоне: видео никуда не отправляется.

const ROOT = new URL('../', import.meta.url);

let cached = null; // { model, landmarker, delegate }

export async function getLandmarker(model) {
  if (cached && cached.model === model) return cached;
  if (cached) cached.landmarker.close();
  cached = null;

  const { FilesetResolver, PoseLandmarker } = window.Vision;
  const fileset = await FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', ROOT).href.replace(/\/$/, ''));
  const modelAssetPath = new URL(`models/pose_landmarker_${model}.task`, ROOT).href;
  const options = (delegate) => ({
    baseOptions: { modelAssetPath, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  let landmarker;
  let delegate = 'GPU';
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (err) {
    console.warn('GPU недоступен, переключаюсь на процессор', err);
    delegate = 'CPU';
    landmarker = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
  }
  cached = { model, landmarker, delegate };
  return cached;
}

// Связи между точками, без лица (лицо только мешает на расстоянии).
let connections = null;
function bodyConnections() {
  if (!connections) {
    connections = window.Vision.PoseLandmarker.POSE_CONNECTIONS
      .filter(({ start, end }) => start >= 11 && end >= 11);
  }
  return connections;
}

export function drawPose(ctx, lm, { highlight = [], highlightColor = '#c8ff3d' } = {}) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;

  const unit = Math.max(w, h) / 160;
  const shown = (p) => p && (p.visibility ?? 1) > 0.5;
  const hl = new Set(highlight);

  ctx.lineCap = 'round';
  ctx.lineWidth = unit * 1.6;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  for (const { start, end } of bodyConnections()) {
    const a = lm[start];
    const b = lm[end];
    if (!shown(a) || !shown(b)) continue;
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
  }
  ctx.stroke();

  // Голова — кружок в районе носа.
  if (shown(lm[0])) {
    ctx.beginPath();
    ctx.arc(lm[0].x * w, lm[0].y * h, unit * 4, 0, Math.PI * 2);
    if (hl.has(0)) ctx.strokeStyle = highlightColor;
    ctx.stroke();
  }

  for (let i = 11; i < lm.length; i++) {
    const p = lm[i];
    if (!shown(p) || (i > 16 && i < 23) || i > 28) continue; // без пальцев и стоп
    const big = hl.has(i);
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, unit * (big ? 2.8 : 1.8), 0, Math.PI * 2);
    ctx.fillStyle = big ? highlightColor : '#ffffff';
    ctx.fill();
  }
}
