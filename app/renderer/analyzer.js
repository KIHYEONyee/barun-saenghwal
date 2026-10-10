// 숨은 분석 창: 웹캠 → MediaPipe 관절 → 판정 규칙(shared/rules.js) → 본체로 결과 전송(초당 8회)
// 영상은 어디에도 저장·전송하지 않는다. 본체로 보내는 건 판정 결과 숫자뿐.
import { FilesetResolver, PoseLandmarker } from 'app://bundle/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';

const R = window.Rules;
const FPS = 8;
const video = document.getElementById('video');
const srcCanvas = document.getElementById('src');
const lumCanvas = document.getElementById('lum');

let cfg = await window.barun.invoke('get-analyzer-config');
let settings = cfg.settings;
let tracker = new R.IssueTracker(cfg.cautionSec);
let paused = cfg.paused;
let base = null, sm = null, device = null, stream = null, landmarker = null, fakeImg = null, fakeAngle = 0;
let calib = null;   // { start, samples: [], lastMove }
let brightness = 255, lastLum = 0, lastPost = 0;

function loadBaseline(b) {
  // 같은 카메라·같은 형식으로 잰 기준만 쓴다
  if (!b || b.version !== R.BASELINE_VERSION || (device && b.camera !== device.label)) return null;
  if (b.side) return { side: true };
  return { ...b.mean, _std: b.std || {} };
}

async function listDevices() {
  const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const list = all.map((d) => ({ id: d.deviceId, label: d.label || '카메라' }));
  window.barun.send('devices', list);
  return list;
}
function pickDevice(list) {
  const want = list.find((d) => d.id && d.id === settings.cameraId);
  if (want) return want;
  // 맥: 아이폰 연속성 카메라·데스크뷰가 먼저 잡히는 문제 → 내장 카메라를 우선
  const bad = /iphone|desk ?view|데스크뷰|virtual|obs|snap/i;
  return list.find((d) => /facetime|built-?in|내장|integrated/i.test(d.label) && !bad.test(d.label))
    || list.find((d) => !bad.test(d.label)) || list[0] || null;
}

async function startCamera() {
  if (cfg.fakeImage) {   // 시험 모드: 사진을 카메라 대신 사용
    fakeImg = new Image(); fakeImg.src = cfg.fakeImage; await fakeImg.decode();
    srcCanvas.width = fakeImg.naturalWidth; srcCanvas.height = fakeImg.naturalHeight;
    device = { id: 'fake', label: '시험용 사진' };
    window.barun.send('devices', [device]);
    return;
  }
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });   // 권한을 먼저 받아야 카메라 이름이 보인다
    tmp.getTracks().forEach((t) => t.stop());
  } catch (e) { post({ present: false, level: 'nocamera', issues: [], error: String(e) }); return; }
  device = pickDevice(await listDevices());
  if (!device) { post({ present: false, level: 'nocamera', issues: [] }); return; }
  stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: device.id }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  video.srcObject = stream;
  await video.play();
}
function stopCamera() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; }

async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks('app://bundle/node_modules/@mediapipe/tasks-vision/wasm');
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: 'app://models/pose_landmarker_full.task', delegate }, runningMode: 'VIDEO', numPoses: 1 });
  try { return await PoseLandmarker.createFromOptions(fileset, opts('GPU')); } catch { return PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
}

function frameSource() {
  if (!fakeImg) return { src: video, w: video.videoWidth, h: video.videoHeight };
  const ctx = srcCanvas.getContext('2d');
  const W = srcCanvas.width, H = srcCanvas.height;
  ctx.save(); ctx.fillStyle = '#888'; ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H * 0.45); ctx.rotate((fakeAngle * Math.PI) / 180); ctx.drawImage(fakeImg, -W / 2, -H * 0.45); ctx.restore();
  return { src: srcCanvas, w: W, h: H };
}
function measureBrightness(src) {
  const ctx = lumCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, 64, 36);
  const d = ctx.getImageData(0, 0, 64, 36).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return s / (d.length / 4);
}
function post(p) { window.barun.send('posture', { t: Date.now(), mode: settings.mode, device: device && device.label, ...p }); lastPost = Date.now(); }

function tick() {
  if (!landmarker || (!fakeImg && video.readyState < 2)) return;
  if (paused) { if (Date.now() - lastPost > 1000) post({ present: false, paused: true, level: 'paused', issues: [] }); return; }
  const { src, w, h } = frameSource();
  if (!w || !h) return;
  const now = performance.now();
  if (Date.now() - lastLum > 1000) { brightness = measureBrightness(src); lastLum = Date.now(); }
  const res = landmarker.detectForVideo(src, now);
  const raw = res.landmarks && res.landmarks[0];
  // 거울 화면 기준으로 맞춘다(화면 오른쪽 = 사용자 오른쪽). 파이썬 데모는 영상을 뒤집은 뒤 검출한다.
  const lm = raw ? raw.map((p) => [1 - p.x, p.y, p.z, p.visibility ?? 1]) : null;
  const checks = { ...R.frameChecks(lm, w, h), brightness: Math.round(brightness), lightOk: brightness > 55 };
  const present = !!lm && lm[0][3] > 0.5;

  if (calib) { tickCalibration(lm, w, h, checks); return; }

  let issues = [], level = 'good', rel = null, cva = null;
  if (!present) { tracker.reset(); sm = null; level = 'away'; }
  else if (settings.mode === 'precise') {
    const r = R.cva(lm, w, h); cva = r.angle;
    issues = tracker.update(R.sideIssues(lm, w, h), Date.now());
  } else if (!base) level = 'nobase';
  else {
    const m = R.metrics(lm, w, h);
    if (!m) { level = 'cantsee'; tracker.update([], Date.now()); }
    else {
      sm = R.smooth(sm, m);
      issues = tracker.update(R.detectIssues(sm, base), Date.now());
      const wristsUp = [15, 16].every((i) => lm[i][3] > 0.5 && lm[i][1] < lm[0][1]);
      rel = {
        roll: sm.head_roll - base.head_roll, tilt: sm.shoulder_tilt - base.shoulder_tilt,
        faceRel: sm.face_ratio / base.face_ratio, neckRel: sm.neck_h / base.neck_h, pitch: sm.head_pitch - base.head_pitch,
        sizeRel: sm.shoulder_w / base.shoulder_w, wristsUp,
      };
    }
  }
  if (issues.length) level = issues[0].dur >= R.WARN_SEC ? 'warning' : 'caution';
  post({ present, level, issues, rel, cva, checks, landmarks: lm && lm.slice(0, 25).map((p) => [+(p[0].toFixed(4)), +(p[1].toFixed(4)), +(p[3].toFixed(2))]) });
}

function tickCalibration(lm, w, h, checks) {
  const now = Date.now();
  const m = lm && settings.mode !== 'precise' ? R.metrics(lm, w, h) : null;
  const ok = settings.mode === 'precise' ? !!lm : !!m;
  if (ok && m) {
    // 움직임이 크면 처음부터(디자인 S2: 진행 바가 되감긴다)
    const n = calib.samples.length;
    if (n > 5) {
      const avg = (k) => calib.samples.reduce((a, s) => a + s[k], 0) / n;
      if (Math.abs(m.head_roll - avg('head_roll')) > 6 || Math.abs(m.shoulder_w / avg('shoulder_w') - 1) > 0.1) { calib.samples = []; calib.start = now; calib.rewinds++; }
    }
    calib.samples.push(m);
  } else if (ok) calib.samples.push({});
  const progress = Math.min(1, (now - calib.start) / (R.CAL_SEC * 1000));
  const steady = calib.samples.length > 5 && now - calib.start > 1500;
  post({ present: !!lm, calibrating: { progress, left: Math.max(0, R.CAL_SEC - (now - calib.start) / 1000), samples: calib.samples.length, rewinds: calib.rewinds }, checks: { ...checks, steady }, issues: [], level: 'calibrating' });
  if (progress < 1) return;
  let result;
  if (settings.mode === 'precise') {
    result = calib.samples.length >= 15 ? { base: { side: true }, msg: '측면 기준 저장', reason: 'ok' } : { base: null, msg: '사람이 잘 안 보였어요. 다시 측정해 주세요.', reason: 'few' };
  } else result = R.makeBaseline(calib.samples.filter((s) => s.shoulder_w));
  calib = null;
  if (result.base) {
    base = result.base; sm = null; tracker.reset();
    const save = result.base.side ? { version: R.BASELINE_VERSION, camera: device.label, side: true, saved: Date.now() }
      : { version: R.BASELINE_VERSION, camera: device.label, saved: Date.now(), mean: Object.fromEntries(R.METRICS.map((k) => [k, base[k]])), std: base._std };
    window.barun.send('baseline', save);
  }
  post({ present: !!lm, calibrated: { ok: !!result.base, msg: result.msg, reason: result.reason }, issues: [], level: result.base ? 'good' : 'nobase' });
}

window.barun.on('cmd', async (c) => {
  if (c.type === 'calibrate') { calib = { start: Date.now(), samples: [], rewinds: 0 }; tracker.reset(); }
  if (c.type === 'cancel-calibrate') calib = null;
  if (c.type === 'pause') { paused = true; if (!fakeImg) stopCamera(); }   // 일시정지 중에는 카메라를 끈다
  if (c.type === 'resume') { paused = false; if (!fakeImg && !stream) await startCamera(); }
  if (c.type === 'settings') {
    const camChanged = c.settings.cameraId !== settings.cameraId;
    settings = c.settings; tracker = new R.IssueTracker(c.cautionSec);
    if (camChanged && !fakeImg) { stopCamera(); await startCamera(); base = loadBaseline((await window.barun.invoke('get-analyzer-config')).baseline); }
  }
  if (c.type === 'report-good' && sm && base && !base.side) {
    // "지금 바른 자세인데요": 지금 자세를 기준 쪽으로 30% 섞어 다음부터 덜 예민하게
    for (const k of R.METRICS) base[k] = 0.7 * base[k] + 0.3 * sm[k];
    tracker.reset();
    window.barun.send('baseline', { version: R.BASELINE_VERSION, camera: device.label, saved: Date.now(), mean: Object.fromEntries(R.METRICS.map((k) => [k, base[k]])), std: base._std });
  }
  if (c.type === 'dev-rotate') fakeAngle = c.angle;
});

await startCamera();
base = loadBaseline(cfg.baseline);
landmarker = await createLandmarker();
if (paused && !fakeImg) stopCamera();
setInterval(tick, 1000 / FPS);
