// 바른생활 앱 본체(Electron 메인 프로세스)
// 창: 분석(숨김) · 메인(온보딩 S1·S2, 홈 S3, 리포트 S4, 스트레칭 S5, 설정 S6) · 위젯(S7·S8) · 화면 흐림(S10 ③) · 교정 유도 화면(S11) · 셀프 체크(S12)
// 메뉴바/트레이(S9). 단계적 개입(S10): 3초 노랑 → 10초 빨강+알림 → 화면 흐림 → (집중 교정 모드) 교정 유도 화면
const { app, BrowserWindow, ipcMain, protocol, net, Menu, Tray, nativeImage, Notification, powerMonitor, screen, systemPreferences, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Store, today } = require('./store');
const Rules = require('./shared/rules');
const Stretches = require('./shared/stretches');

const DEV = {
  fakeImage: process.env.JASAI_FAKE_IMAGE || '',      // 카메라 대신 쓸 사진(시험용)
  shots: process.env.JASAI_SHOTS || '',               // 화면 캡처 저장 폴더(시험용). 지정하면 시나리오를 돌리고 종료
  seed: process.env.JASAI_SEED === '1',               // 리포트 미리보기용 가짜 1주 기록(시험용)
};
if (process.env.JASAI_USERDATA) app.setPath('userData', process.env.JASAI_USERDATA);
const SHOW = !DEV.shots;   // 시험 캡처 중에는 창을 화면에 띄우지 않는다(사용자 화면을 가리지 않게)

const MODELS_DIR = [path.join(__dirname, '../models'), path.join(process.resourcesPath || '', 'models')].find((d) => fs.existsSync(d)) || path.join(__dirname, '../models');
// 시험·디버그 중에는 각 창의 콘솔 오류를 터미널로 보낸다
if (DEV.shots || process.env.JASAI_DEBUG) {
  app.on('web-contents-created', (e, wc) => wc.on('console-message', (ev, level, message, line, source) => {
    const msg = typeof ev === 'object' && ev.message !== undefined ? ev : { level, message, lineNumber: line, sourceId: source };
    if (msg.level === 'error' || msg.level >= 2 || /error|fail/i.test(msg.message)) console.log(`[renderer ${wc.getURL().split('/').pop()}] ${msg.message} (${(msg.sourceId || '').split('/').pop()}:${msg.lineNumber})`);
  }));
}
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let store;
const win = { main: null, analyzer: null, widget: null, dim: null, lock: null, selfcheck: null };
let tray = null, trayFrames = {}, trayAnim = null;
const live = {
  posture: null,          // 분석기가 보낸 마지막 판정
  widgetPose: 'good', widgetTint: 'auto', widgetDir: 0,
  snoozeUntil: 0, meeting: false,
  sitStart: null, lastSeen: 0, restDue: false, restNotified: false,
  episode: null,          // { start, key, notified, maxDur }
  praiseUntil: 0, lockedAt: 0, devices: [],
  basicUseStart: null, lastSelfcheck: 0,
};

// ---------- 공통 ----------
const send = (w, ch, data) => { if (w && !w.isDestroyed()) w.webContents.send(ch, data); };
const broadcast = (ch, data) => Object.values(win).forEach((w) => send(w, ch, data));
const pageURL = (file, hash = '') => `app://bundle/renderer/${file}${hash ? '#' + hash : ''}`;
const cautionSec = () => ({ fast: 2, normal: 3, relaxed: 5 }[store.settings.sensitivity] || 3);
const paused = () => Date.now() < live.snoozeUntil || live.meeting || outOfSchedule();
function outOfSchedule() {
  const s = store.settings.schedule;
  if (!s || !s.enabled) return false;
  const now = new Date(); const m = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = s.start.split(':').map(Number), [eh, em] = s.end.split(':').map(Number);
  return m < sh * 60 + sm || m >= eh * 60 + em;
}
function todayScore() {
  const d = store.day();
  const tot = d.sec.good + d.sec.caution + d.sec.warning;
  return tot > 0 ? Math.round((d.sec.good / tot) * 100) : null;
}
function webPrefs(extra = {}) {
  return { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, ...(DEV.shots ? { backgroundThrottling: false } : {}), ...extra };
}

// ---------- 창 ----------
function createAnalyzer() {
  if (win.analyzer || store.settings.mode === 'basic' || !store.settings.mode) return;
  win.analyzer = new BrowserWindow({ show: false, width: 640, height: 480, webPreferences: webPrefs({ backgroundThrottling: false }) });
  win.analyzer.loadURL(pageURL('analyzer.html'));
  win.analyzer.on('closed', () => { win.analyzer = null; });
}
function destroyAnalyzer() { if (win.analyzer) { win.analyzer.destroy(); win.analyzer = null; } }

function createMain(hash) {
  if (win.main) { if (hash) send(win.main, 'navigate', hash); win.main.show(); win.main.focus(); return; }
  win.main = new BrowserWindow({ width: 1180, height: 780, minWidth: 980, minHeight: 640, title: '바른생활', backgroundColor: '#f7f5f0', show: !DEV.shots, webPreferences: webPrefs() });
  win.main.loadURL(pageURL('index.html', hash || (store.settings.mode ? 'home' : 'onboard-mode')));
  win.main.on('closed', () => { win.main = null; });
}

const WIDGET_PX = { small: 90, medium: 120, large: 160 };
function createWidget() {
  if (win.widget || !store.settings.mode || store.settings.display === 'menubar') return;
  const px = WIDGET_PX[store.settings.widgetSize] || 120;
  const W = Math.round(px * 1.25), H = Math.round(px * 1.2);
  const wa = screen.getPrimaryDisplay().workArea;
  const pos = store.settings.widgetPos || { x: wa.x + wa.width - W - 24, y: wa.y + wa.height - H - 24 };
  win.widget = new BrowserWindow({
    width: W, height: H, x: pos.x, y: pos.y, frame: false, transparent: true, resizable: false, hasShadow: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false, backgroundColor: '#00000000', webPreferences: webPrefs(),
  });
  win.widget.setAlwaysOnTop(true, 'screen-saver');
  if (store.settings.allSpaces) win.widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 평소에는 마우스를 뒤 창으로 통과시키고(forward: 움직임만 받음), 캐릭터 그림 위에 있을 때만 widget.js가 'widget-ignore'로 잡는다
  win.widget.setIgnoreMouseEvents(true, { forward: true });
  win.widget.loadURL(pageURL('widget.html'));
  win.widget.once('ready-to-show', () => { if (SHOW) win.widget.showInactive(); });
  win.widget.webContents.on('did-finish-load', () => updateWidget());
  win.widget.on('closed', () => { win.widget = null; });
}
function rebuildWidget() { if (win.widget) { win.widget.destroy(); win.widget = null; } createWidget(); }

function primaryBounds() { return screen.getPrimaryDisplay().bounds; }
function createDim() {
  if (win.dim) return;
  const b = primaryBounds();
  win.dim = new BrowserWindow({ ...b, frame: false, transparent: true, focusable: false, skipTaskbar: true, hasShadow: false, resizable: false, show: false, backgroundColor: '#00000000', webPreferences: webPrefs() });
  win.dim.setIgnoreMouseEvents(true);
  win.dim.setAlwaysOnTop(true, 'screen-saver');
  win.dim.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.dim.loadURL(pageURL('overlay.html'));
  win.dim.once('ready-to-show', () => { if (SHOW) win.dim.showInactive(); if (win.widget) win.widget.moveTop(); });
  win.dim.on('closed', () => { win.dim = null; });
}
function setDim(opacity) {
  if (opacity <= 0) { if (win.dim) { win.dim.destroy(); win.dim = null; } return; }
  createDim();
  send(win.dim, 'dim', opacity);
}

function openLock(issue) {
  if (win.lock) return;
  const b = primaryBounds();
  live.lockedAt = Date.now();
  store.count('locks');
  win.lock = new BrowserWindow({ ...b, frame: false, skipTaskbar: true, resizable: false, movable: false, minimizable: false, show: false, backgroundColor: '#1c1a17', webPreferences: webPrefs() });
  win.lock.setAlwaysOnTop(true, 'screen-saver');
  win.lock.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.lock.loadURL(pageURL('lock.html'));
  win.lock.once('ready-to-show', () => { if (SHOW) { win.lock.show(); win.lock.focus(); } send(win.lock, 'lock-info', { issue, mode: store.settings.mode, emergencyLeft: store.emergencyLeft(), minutes: Math.max(1, Math.round((issue && issue.dur || 0) / 60)) }); });
  win.lock.on('closed', () => { win.lock = null; });
  setDim(0);
}
function closeLock(reason) {
  if (!win.lock) return;
  store.count('lockReleaseSec', (Date.now() - live.lockedAt) / 1000);
  win.lock.destroy(); win.lock = null;
  live.episode = null;
  if (reason === 'fixed') live.praiseUntil = Date.now() + 3000;
}

function openSelfcheck() {
  if (win.selfcheck) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 600, H = 250;
  win.selfcheck = new BrowserWindow({ width: W, height: H, x: wa.x + wa.width - W - 24, y: wa.y + wa.height - H - 24, frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: '#00000000', webPreferences: webPrefs() });
  win.selfcheck.setAlwaysOnTop(true, 'floating');
  win.selfcheck.loadURL(pageURL('selfcheck.html'));
  win.selfcheck.once('ready-to-show', () => { if (SHOW) win.selfcheck.showInactive(); send(win.selfcheck, 'selfcheck-info', { minutes: Math.round((Date.now() - (live.basicUseStart || Date.now())) / 60000), animal: store.settings.animal }); });
  win.selfcheck.on('closed', () => { win.selfcheck = null; });
}

// ---------- 트레이(메뉴바) S9 ----------
function createTray() {
  if (tray || DEV.shots || !store.settings.mode || store.settings.display === 'desktop') return;
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('바른생활');
  tray.on('click', () => tray.popUpContextMenu(trayMenu()));
  updateTray();
}
function destroyTray() { if (tray) { tray.destroy(); tray = null; } clearInterval(trayAnim); trayAnim = null; }
function trayMenu() {
  const score = todayScore();
  const st = live.posture;
  const status = paused() ? '일시정지 중' : !st || !st.present ? '자리 비움' : st.level === 'good' ? '바른 자세 유지 중' : (st.issues[0] && st.issues[0].ko) || '자세 확인 중';
  const rec = Stretches.recommend(store.day().issues, 1)[0];
  return Menu.buildFromTemplate([
    { label: `${status}${score !== null ? `   ${score}점` : ''}`, enabled: false },
    { type: 'separator' },
    { label: `스트레칭 추천 · ${rec.name}`, click: () => createMain(`stretch/${rec.id}`) },
    { label: Date.now() < live.snoozeUntil ? '일시정지 해제' : '30분 일시정지', click: () => toggleSnooze() },
    { label: live.meeting ? '회의 끝남 (다시 분석)' : '회의 중 (분석 멈춤)', click: () => { live.meeting = !live.meeting; applyPause(); } },
    { label: win.widget ? '위젯 숨기기' : '위젯 보이기', click: () => { if (win.widget) { win.widget.destroy(); win.widget = null; } else { createWidget(); } } },
    { type: 'separator' },
    { label: '리포트 열기', click: () => createMain('report') },
    { label: '설정...', click: () => createMain('settings') },
    { label: '종료', click: () => app.quit() },
  ]);
}
function trayState() {
  if (paused() || (live.posture && !live.posture.present)) return 'away';
  const lv = live.posture && live.posture.level;
  return lv === 'warning' ? 'warn' : lv === 'caution' ? 'caution' : 'good';
}
function updateTray() {
  if (!tray) return;
  const score = todayScore();
  if (process.platform === 'darwin') tray.setTitle(score !== null ? ` ${score}` : '');
  const state = trayState();
  const frames = trayFrames[state];
  clearInterval(trayAnim); trayAnim = null;
  if (!frames || !frames.length) return;
  // 좋으면 빠르게 달리고, 주의면 느려지고, 경고면 주저앉아 멈춤
  const speed = { good: 160, caution: 420 }[state];
  let i = 0;
  tray.setImage(frames[0]);
  if (speed && frames.length > 1) trayAnim = setInterval(() => { i = (i + 1) % frames.length; if (tray) tray.setImage(frames[i]); }, speed);
}

// ---------- 일시정지 ----------
function toggleSnooze(min = 30) {
  live.snoozeUntil = Date.now() < live.snoozeUntil ? 0 : Date.now() + min * 60000;
  applyPause();
}
function applyPause() {
  send(win.analyzer, 'cmd', { type: paused() ? 'pause' : 'resume' });
  if (paused()) { setDim(0); live.episode = null; }
  updateWidget(); updateTray(); pushLive();
}

// ---------- 판정 수신 → 위젯·개입·기록 ----------
const POSE_OF = { turtle: 'turtle', close: 'turtle', head_down: 'slouch', slouch: 'slouch', roll: 'tilt', tilt: 'tilt', lean: 'tilt', shrug: 'shrug', chin: 'chin' };
let lastTick = Date.now();
function onPosture(p) {
  const now = Date.now();
  const dt = Math.min(2, (now - lastTick) / 1000); lastTick = now;
  live.posture = p;
  if (p.calibrated) live.lastCalibrated = { ...p.calibrated, t: now };   // 한 번만 오는 결과라 화면이 놓치지 않게 보관
  if (p.calibrating) { pushLive(); return; }

  // 기록
  const state = paused() ? 'paused' : !p.present ? 'away' : p.level === 'warning' ? 'warning' : p.level === 'caution' ? 'caution' : p.level === 'good' ? 'good' : null;
  if (state && dt > 0) store.record(state, dt, p.issues[0] && p.issues[0].key);

  // 오래 앉음: 화면에 계속 있으면 시간을 재고, 2분 이상 자리를 비우면 초기화
  if (p.present) {
    live.lastSeen = now;
    if (!live.sitStart) live.sitStart = now;
  } else if (live.sitStart && now - live.lastSeen > 120000) {
    live.sitStart = null; live.restDue = false; live.restNotified = false;
  }
  const sitMin = live.sitStart ? (now - live.sitStart) / 60000 : 0;
  if (sitMin >= store.settings.sitReminderMin && !live.restDue) {
    live.restDue = true;
    if (!live.restNotified) { live.restNotified = true; notify(`${Math.round(sitMin)}분째 앉아 있어요`, '잠깐 일어나거나 스트레칭 해볼까요?', 'stretch'); store.count('stretchRec'); }
  }

  // 단계적 개입
  const top = p.issues[0];
  if (!paused() && p.present && top) {
    if (!live.episode) live.episode = { start: now, key: top.key, notified: false, maxDur: 0 };
    const ep = live.episode;
    ep.maxDur = Math.max(ep.maxDur, top.dur);
    if (top.dur >= Rules.WARN_SEC && !ep.notified && store.settings.notify) {
      ep.notified = true; store.count('notifies'); store.count('stretchRec');
      notify(top.ko, `${guidance(top.key)} · ${Math.round(top.dur)}초째`, 'home');
    }
    if (store.settings.dimEnabled && top.dur >= store.settings.dimAfterSec) {
      setDim(Math.min(0.55, ((top.dur - store.settings.dimAfterSec) / 60) * 0.55 + 0.08));
    }
    const maxSev = Math.max(...p.issues.map((i) => i.sev || 0));
    if (store.settings.focusMode && top.dur >= store.settings.lockAfterSec && maxSev >= store.settings.lockMinSev) openLock(top);
  } else {
    if (live.episode && live.episode.maxDur >= Rules.WARN_SEC && p.present) live.praiseUntil = now + 2500;   // 자세 고침 칭찬
    live.episode = null;
    setDim(0);
  }
  updateWidget(); pushLive();
}
function guidance(key) {
  return {
    turtle: '턱을 살짝 당기고 화면에서 한 뼘 떨어져 보세요', close: '화면에서 조금 떨어져 앉아 보세요', head_down: '화면을 눈높이로 올리고 고개를 들어 보세요',
    roll: '고개를 똑바로 세워 보세요', tilt: '양 어깨 높이를 맞춰 보세요', shrug: '어깨에 힘을 빼고 툭 떨어뜨려 보세요',
    lean: '엉덩이를 의자 깊숙이 넣고 가운데로 앉아 보세요', chin: '손을 내리고 턱을 당겨 보세요', slouch: '허리를 펴고 등받이에 기대 보세요',
  }[key] || '자세를 바로 해 보세요';
}
function updateWidget() {
  const p = live.posture;
  let pose = 'good', tint = 'auto', dir = 0;
  if (paused() || (p && !p.present && store.settings.mode !== 'basic')) pose = 'away';
  else if (Date.now() < live.praiseUntil) pose = 'praise';
  else if (p && p.issues && p.issues[0]) {
    const top = p.issues[0];
    pose = POSE_OF[top.key] || 'tilt'; dir = top.dir || 0;
    tint = p.level === 'warning' ? 'warning' : 'caution';
  } else if (live.restDue) pose = 'rest';
  else if (live.basicPose && store.settings.mode === 'basic') { pose = live.basicPose.pose; tint = live.basicPose.tint; }
  live.widgetPose = pose; live.widgetTint = tint; live.widgetDir = dir;
  send(win.widget, 'widget', { pose, tint, dir, animal: store.settings.animal, analyzing: !paused() && store.settings.mode !== 'basic', size: WIDGET_PX[store.settings.widgetSize] || 120 });
  updateTrayThrottled();
}
let trayTimer = null, lastTrayState = '';
function updateTrayThrottled() {
  const s = trayState() + todayScore();
  if (s === lastTrayState || trayTimer) return;
  trayTimer = setTimeout(() => { trayTimer = null; lastTrayState = trayState() + todayScore(); updateTray(); }, 500);
}
function notify(title, body, page) {
  if (paused()) return;
  if (DEV.shots) { live.devNotifications = [...(live.devNotifications || []), { title, body }]; return; }
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: `바른생활 · ${title}`, body, silent: false });
  n.on('click', () => createMain(page));
  n.show();
}
function liveState() {
  return {
    posture: live.posture, widgetPose: live.widgetPose, widgetTint: live.widgetTint, widgetDir: live.widgetDir,
    paused: paused(), snoozeUntil: live.snoozeUntil, meeting: live.meeting, restDue: live.restDue,
    sitMin: live.sitStart ? (Date.now() - live.sitStart) / 60000 : 0, score: todayScore(), devices: live.devices, lastCalibrated: live.lastCalibrated || null,
  };
}
let liveTimer = null;
function pushLive() {
  if (liveTimer) return;
  liveTimer = setTimeout(() => { liveTimer = null; const s = liveState(); send(win.main, 'live', s); send(win.lock, 'live', s); }, 200);
}

// ---------- 기본 모드(카메라 끔): 키보드·마우스 연속 사용 → 셀프 체크 S12 ----------
setInterval(() => {
  if (!store || store.settings.mode !== 'basic' || paused()) return;
  const idle = powerMonitor.getSystemIdleTime();
  const now = Date.now();
  if (idle < 60) { if (!live.basicUseStart) live.basicUseStart = now; }
  else if (idle > 180) { live.basicUseStart = null; live.basicPose = null; }
  const useMin = live.basicUseStart ? (now - live.basicUseStart) / 60000 : 0;
  if (useMin >= store.settings.sitReminderMin && now - live.lastSelfcheck > store.settings.sitReminderMin * 60000) {
    live.lastSelfcheck = now; openSelfcheck();
  }
}, 5000);

// ---------- IPC ----------
function registerIpc() {
  ipcMain.on('posture', (e, p) => onPosture(p));
  ipcMain.on('devices', (e, list) => { live.devices = list; pushLive(); });
  ipcMain.handle('dev-info', () => ({ fakeImage: DEV.fakeImage ? 'app://bundle/__fake__' : null, shots: !!DEV.shots }));
  ipcMain.handle('get-all', () => ({ settings: store.settings, baseline: store.data.baseline, days: store.data.days, live: liveState(), unlocks: store.unlocks(), emergencyLeft: store.emergencyLeft(), today: today(), platform: process.platform }));
  ipcMain.handle('set-settings', (e, patch) => {
    const before = { ...store.settings };
    const s = store.setSettings(patch);
    if ('mode' in patch && patch.mode !== before.mode) {
      if (s.mode === 'basic') destroyAnalyzer(); else { destroyAnalyzer(); createAnalyzer(); }
      createWidget(); createTray();
    }
    if (['display', 'widgetSize', 'clickThrough', 'allSpaces', 'animal'].some((k) => k in patch)) {
      if (s.display === 'menubar') { if (win.widget) { win.widget.destroy(); win.widget = null; } } else rebuildWidget();
      if (s.display === 'desktop') destroyTray(); else createTray();
    }
    if ('schedule' in patch) applyPause();
    send(win.analyzer, 'cmd', { type: 'settings', settings: s, cautionSec: cautionSec() });
    updateWidget();
    return s;
  });
  ipcMain.handle('get-analyzer-config', () => ({ settings: store.settings, baseline: store.data.baseline, cautionSec: cautionSec(), paused: paused(), fakeImage: DEV.fakeImage ? 'app://bundle/__fake__' : null }));
  ipcMain.on('baseline', (e, b) => { store.data.baseline = b; store.save(); broadcast('baseline', b); });
  ipcMain.on('calibrate', () => { createAnalyzer(); send(win.analyzer, 'cmd', { type: 'calibrate' }); });
  ipcMain.on('cancel-calibrate', () => send(win.analyzer, 'cmd', { type: 'cancel-calibrate' }));
  ipcMain.on('onboarding-done', () => { createWidget(); createTray(); });
  ipcMain.on('snooze', (e, min) => toggleSnooze(min || 30));
  ipcMain.on('report-good', () => { store.count('falseReports'); send(win.analyzer, 'cmd', { type: 'report-good' }); live.episode = null; setDim(0); });
  ipcMain.on('stretch-done', (e, id) => { store.count('stretchDone'); live.restDue = false; live.sitStart = Date.now(); updateWidget(); });
  ipcMain.on('stretch-rec', () => store.count('stretchRec'));
  ipcMain.on('open-main', (e, hash) => createMain(hash));
  ipcMain.on('widget-move', (e, { x, y }) => { if (win.widget) win.widget.setPosition(Math.round(x), Math.round(y)); });
  ipcMain.handle('widget-pos', () => (win.widget ? win.widget.getPosition() : [0, 0]));
  ipcMain.on('widget-ignore', (e, ignore) => {
    if (!win.widget) return;
    win.widget.setIgnoreMouseEvents(store.settings.clickThrough ? true : !!ignore, { forward: true });   // 클릭 통과 옵션이 켜져 있으면 항상 통과
  });
  ipcMain.on('widget-moved', () => { if (win.widget) { const [x, y] = win.widget.getPosition(); store.setSettings({ widgetPos: { x, y } }); } });
  ipcMain.on('widget-click', () => {
    if (!win.widget) return;
    const score = todayScore();
    const rec = Stretches.recommend(store.day().issues, 1)[0];
    Menu.buildFromTemplate([
      { label: `오늘 자세 점수   ${score !== null ? score : '-'}`, enabled: false },
      { type: 'separator' },
      { label: `${rec.name} 스트레칭   ${Stretches.duration(rec)}초`, click: () => createMain(`stretch/${rec.id}`) },
      { label: Date.now() < live.snoozeUntil ? '일시정지 해제' : '30분 끄기', click: () => toggleSnooze() },
      { label: '지금 바른 자세인데요', enabled: !!(live.posture && live.posture.issues && live.posture.issues.length), click: () => { store.count('falseReports'); send(win.analyzer, 'cmd', { type: 'report-good' }); } },
      { type: 'separator' },
      { label: '바른생활 열기', click: () => createMain('home') },
    ]).popup({ window: win.widget });
  });
  ipcMain.on('tray-frames', (e, frames) => {
    trayFrames = {};
    for (const [state, list] of Object.entries(frames)) trayFrames[state] = list.map((d) => nativeImage.createFromBuffer(Buffer.from(d.split(',')[1], 'base64'), { scaleFactor: 2 }));
    lastTrayState = ''; updateTray();
  });
  ipcMain.on('lock-release', (e, how) => {
    if (how === 'emergency') { if (store.emergencyLeft() > 0) { store.useEmergency(); closeLock('emergency'); } }
    else if (how === 'report') { store.count('falseReports'); send(win.analyzer, 'cmd', { type: 'report-good' }); closeLock('report'); }
    else closeLock('fixed');
  });
  ipcMain.on('selfcheck-answer', (e, ans) => {
    const d = store.day(); d.selfchecks.push({ t: Date.now(), answer: ans }); store.save();
    // 기본 모드는 답변을 같은 리포트로 집계: 답한 자세를 직전 10분 동안의 상태로 기록(근사)
    const map = { good: ['good', null], turtle: ['warning', 'turtle'], slouch: ['warning', 'head_down'], tilt: ['caution', 'tilt'] };
    const [st, key] = map[ans] || ['good', null];
    store.record(st, 600, key);
    live.basicPose = ans === 'good' ? null : { pose: POSE_OF[key] || 'tilt', tint: st === 'warning' ? 'warning' : 'caution' };
    if (ans !== 'good') notify('자세를 바로 해 볼까요?', guidance(key), `stretch/${Stretches.recommend({ [key]: 1 }, 1)[0].id}`);
    updateWidget();
    if (win.selfcheck) win.selfcheck.destroy();
  });
  ipcMain.on('selfcheck-close', () => { if (win.selfcheck) win.selfcheck.destroy(); });
  ipcMain.on('dev-open-selfcheck', () => openSelfcheck());
  ipcMain.on('dev-open-lock', () => openLock((live.posture && live.posture.issues[0]) || { key: 'turtle', ko: '목이 앞으로 나와 있어요', dur: 360 }));
}

// ---------- 시작 ----------
app.whenReady().then(async () => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    if (u.host === 'models') return net.fetch(pathToFileURL(path.join(MODELS_DIR, decodeURIComponent(u.pathname))).toString());
    if (u.pathname === '/__fake__' && DEV.fakeImage) return net.fetch(pathToFileURL(path.resolve(DEV.fakeImage)).toString());   // 화면과 같은 출처여야 픽셀을 읽을 수 있다
    const p = path.normalize(path.join(__dirname, decodeURIComponent(u.pathname)));
    if (!p.startsWith(__dirname)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(p).toString());
  });
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'notifications'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ['media', 'notifications'].includes(perm));
  if (process.platform === 'darwin' && !DEV.fakeImage) { try { await systemPreferences.askForMediaAccess('camera'); } catch { /* 권한 창 실패 무시 */ } }

  store = new Store(app.getPath('userData'));
  if (DEV.seed) require('./dev/seed')(store);
  registerIpc();
  createMain();
  createAnalyzer();
  createWidget();
  createTray();
  if (DEV.shots) require('./dev/shots')({ app, win, store, live, onPosture, openLock, openSelfcheck, setDim, createMain, send, dir: DEV.shots });
});
app.on('window-all-closed', (e) => { /* 위젯·트레이 앱이라 창을 다 닫아도 계속 실행 */ });
app.on('activate', () => createMain());
app.on('before-quit', () => store && store.save(true));
