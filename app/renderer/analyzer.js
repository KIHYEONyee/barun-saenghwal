// 숨은 분석 창: 웹캠 → MediaPipe 관절 → 판정 규칙(shared/rules.js) → 본체로 결과 전송(초당 8회)
// 영상은 어디에도 저장·전송하지 않는다. 본체로 보내는 건 판정 결과 숫자뿐.
// MediaPipe 위치: 앱은 app:// 로 앱 안의 파일, 웹은 window.BARUN_PATHS(CDN)
const PATHS = window.BARUN_PATHS || {
  vision: 'app://bundle/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs',
  wasm: 'app://bundle/node_modules/@mediapipe/tasks-vision/wasm',
  model: 'app://models/pose_landmarker_full.task',
};
const { FilesetResolver, PoseLandmarker } = await import(PATHS.vision);

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
  if (b.side) return { side: true, cva: b.cva || null };   // cva 가 없으면(예전 기준) 고정 50°로 판정
  return { ...b.mean, _std: b.std || {} };
}
// 정면(웹캠)과 측면(정밀) 기준은 따로 저장된다
const pickBaseline = (c) => loadBaseline(settings.mode === 'precise' ? c.sideBaseline : c.baseline);

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

let delegate = 'GPU', fileset = null, switching = false;
async function createLandmarker(want = 'GPU') {
  fileset ||= await FilesetResolver.forVisionTasks(PATHS.wasm);
  const opts = (d) => ({ baseOptions: { modelAssetPath: PATHS.model, delegate: d }, runningMode: 'VIDEO', numPoses: 1 });
  if (want === 'GPU') { try { delegate = 'GPU'; return await PoseLandmarker.createFromOptions(fileset, opts('GPU')); } catch { /* 아래 CPU로 */ } }
  delegate = 'CPU';
  return PoseLandmarker.createFromOptions(fileset, opts('CPU'));
}
// GPU(WebGL)를 쓸 수 없는 컴퓨터에서는 만들기는 성공해도 분석할 때 실패한다 → CPU로 다시 만든다
async function fallbackToCpu(err) {
  if (switching || delegate === 'CPU') return;
  switching = true;
  console.warn('GPU 분석 실패, CPU로 전환:', err);
  try { if (landmarker) landmarker.close(); } catch { /* 무시 */ }
  landmarker = null;
  landmarker = await createLandmarker('CPU');
  switching = false;
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
function post(p) { window.barun.send('posture', { t: Date.now(), mode: settings.mode, device: device && device.label, ...p }); lastPost = Date.now(); if (window.__barunAnalyzer) window.__barunAnalyzer.posts++; }

const diag = (window.__barunAnalyzer = { ticks: 0, detects: 0, lastDetectMs: 0, posts: 0, error: null, get delegate() { return delegate; } });   // 진단용(느림·오류 확인)
let lastTickAt = 0;
function tick() {
  // 분석이 느린 컴퓨터에서는 타이머 신호가 밀려 쌓인다. 직전 분석 뒤 충분히 지났을 때만 분석해 화면이 버벅이지 않게 한다.
  // 분석 1회가 오래 걸리면 간격을 그 2배 이상으로 늘려, 화면 그리기에 쓸 시간을 남긴다(초당 8회 → 느린 PC는 자동으로 줄어듦)
  const t = performance.now();
  if (t - lastTickAt < Math.max(1000 / FPS, diag.lastDetectMs * 2) * 0.8) return;
  lastTickAt = t;
  diag.ticks++;
  try { tickInner(); } catch (e) { diag.error = String(e && e.stack || e); }
}
function tickInner() {
  if (!landmarker || (!fakeImg && video.readyState < 2)) return;
  if (paused) { if (Date.now() - lastPost > 1000) post({ present: false, paused: true, level: 'paused', issues: [] }); return; }
  const { src, w, h } = frameSource();
  if (!w || !h) return;
  const now = performance.now();
  if (Date.now() - lastLum > 1000) { brightness = measureBrightness(src); lastLum = Date.now(); }
  const t0 = performance.now();
  let res;
  try { res = landmarker.detectForVideo(src, now); } catch (e) { if (delegate === 'GPU') { fallbackToCpu(e); return; } throw e; }
  diag.detects++; diag.lastDetectMs = Math.round(performance.now() - t0);
  const raw = res.landmarks && res.landmarks[0];
  // 거울 화면 기준으로 맞춘다(화면 오른쪽 = 사용자 오른쪽). 파이썬 데모는 영상을 뒤집은 뒤 검출한다.
  const lm = raw ? raw.map((p) => [1 - p.x, p.y, p.z, p.visibility ?? 1]) : null;
  const checks = { ...R.frameChecks(lm, w, h), brightness: Math.round(brightness), lightOk: brightness > 55,
    side: settings.mode === 'precise' && !!lm && R.cva(lm, w, h).angle !== null };   // 측면: 귀·어깨가 옆에서 보여 각도를 잴 수 있음
  const present = !!lm && lm[0][3] > 0.5;

  if (calib) { tickCalibration(lm, w, h, checks); return; }

  let issues = [], level = 'good', rel = null, cva = null, cvaRef = null;
  if (!present) { tracker.reset(); sm = null; level = 'away'; }
  else if (settings.mode === 'precise') {
    const ref = base && base.cva;
    const r = R.cva(lm, w, h, ref); cva = r.angle; cvaRef = ref || null;
    issues = tracker.update(R.sideIssues(lm, w, h, ref), Date.now());
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
        sizeRel: sm.shoulder_w / base.shoulder_w, shift: sm.head_shift - base.head_shift, wristsUp,
      };
    }
  }
  if (issues.length) level = issues[0].dur >= R.WARN_SEC ? 'warning' : 'caution';
  post({ present, level, issues, rel, cva, cvaRef, checks, landmarks: lmOut(lm) });
}

// 화면에 선을 그릴 관절(0~24번) 좌표. 기준 측정 중에도 보내야 측정 화면에 선이 계속 보인다
const lmOut = (lm) => lm && lm.slice(0, 25).map((p) => [+(p[0].toFixed(4)), +(p[1].toFixed(4)), +(p[3].toFixed(2))]);

function tickCalibration(lm, w, h, checks) {
  const now = Date.now();
  const side = settings.mode === 'precise';
  const m = lm && !side ? R.metrics(lm, w, h) : null;
  const a = lm && side ? R.cva(lm, w, h).angle : null;   // 측면: 기준 측정 동안 목 각도를 모은다
  const ok = side ? a !== null : !!m;
  if (ok && side) {
    const n = calib.samples.length;
    if (n > 5 && Math.abs(a - calib.samples.reduce((s, x) => s + x.cva, 0) / n) > 6) { calib.samples = []; calib.start = now; calib.rewinds++; }
    calib.samples.push({ cva: a });
  } else if (ok && m) {
    // 움직임이 크면 처음부터(디자인 S2: 진행 바가 되감긴다)
    const n = calib.samples.length;
    if (n > 5) {
      const avg = (k) => calib.samples.reduce((a, s) => a + s[k], 0) / n;
      if (Math.abs(m.head_roll - avg('head_roll')) > 6 || Math.abs(m.shoulder_w / avg('shoulder_w') - 1) > 0.1) { calib.samples = []; calib.start = now; calib.rewinds++; }
    }
    calib.samples.push(m);
  }
  const progress = Math.min(1, (now - calib.start) / (R.CAL_SEC * 1000));
  const steady = calib.samples.length > 5 && now - calib.start > 1500;
  post({ present: !!lm, cva: a, landmarks: lmOut(lm), calibrating: { progress, left: Math.max(0, R.CAL_SEC - (now - calib.start) / 1000), samples: calib.samples.length, rewinds: calib.rewinds }, checks: { ...checks, steady, side: a !== null }, issues: [], level: 'calibrating' });
  if (progress < 1) return;
  let result;
  if (side) {
    const xs = calib.samples.map((s) => s.cva).sort((p, q) => p - q);
    const mid = xs[Math.floor(xs.length / 2)];   // 중간값: 잠깐 튄 프레임에 덜 흔들린다
    result = xs.length >= 15 ? { base: { side: true, cva: mid }, msg: `측면 기준 저장 · 내 바른 자세 목 각도 ${mid.toFixed(0)}°`, reason: 'ok' } : { base: null, msg: '귀와 어깨가 옆에서 잘 안 보였어요. 몸 옆쪽이 보이게 앉아 다시 측정해 주세요.', reason: 'few' };
  } else result = R.makeBaseline(calib.samples.filter((s) => s.shoulder_w));
  calib = null;
  if (result.base) {
    base = result.base; sm = null; tracker.reset();
    const save = result.base.side ? { version: R.BASELINE_VERSION, camera: device.label, side: true, cva: result.base.cva, saved: Date.now() }
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
    if (camChanged && !fakeImg) { stopCamera(); await startCamera(); base = pickBaseline(await window.barun.invoke('get-analyzer-config')); }
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
base = pickBaseline(cfg);
landmarker = await createLandmarker();
if (paused && !fakeImg) stopCamera();
// 타이머는 워커에서 돌린다: 브라우저는 뒤에 있는 탭의 setInterval 을 1초 이상으로 늦추지만 워커 타이머는 덜 늦춘다
try {
  const worker = new Worker(URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${Math.round(1000 / FPS)})`], { type: 'text/javascript' })));
  worker.onmessage = tick;
} catch { setInterval(tick, 1000 / FPS); }
