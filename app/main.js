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
const Core = require('./shared/core');

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
let core;   // shared/core.js: 판정 후처리(앱·웹 공용). 시작할 때 store 와 함께 만든다
const live = new Proxy({}, { get: (t, k) => core.live[k], set: (t, k, v) => { core.live[k] = v; return true; } });   // dev/shots.js 등에서 쓰던 live 그대로

// ---------- 공통 ----------
const send = (w, ch, data) => { if (w && typeof w.isDestroyed === 'function' && !w.isDestroyed()) w.webContents.send(ch, data); };
const broadcast = (ch, data) => Object.values(win).forEach((w) => send(w, ch, data));
const pageURL = (file, hash = '') => `app://bundle/renderer/${file}${hash ? '#' + hash : ''}`;
const cautionSec = () => core.cautionSec();
const paused = () => core.paused();
const todayScore = () => core.todayScore();
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
let widgetSize = null;   // 이동할 때 크기를 고정하려고 기억(win 에 넣으면 창 목록으로 오인돼 broadcast 가 깨짐)
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
  widgetSize = { width: W, height: H };   // 이동할 때 크기를 고정하기 위해 기억
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
  core.lockOpened(issue);
  win.lock = new BrowserWindow({ ...b, frame: false, skipTaskbar: true, resizable: false, movable: false, minimizable: false, show: false, backgroundColor: '#1c1a17', webPreferences: webPrefs() });
  win.lock.setAlwaysOnTop(true, 'screen-saver');
  win.lock.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.lock.loadURL(pageURL('lock.html'));
  win.lock.once('ready-to-show', () => { if (SHOW) { win.lock.show(); win.lock.focus(); } send(win.lock, 'lock-info', { issue, mode: store.settings.mode, emergencyLeft: store.emergencyLeft(), minutes: Math.max(1, Math.round((issue && issue.dur || 0) / 60)) }); });
  win.lock.on('closed', () => { win.lock = null; });
}
function closeLock() { if (win.lock) { win.lock.destroy(); win.lock = null; } }

function openSelfcheck() {
  if (win.selfcheck) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 600, H = 250;
  win.selfcheck = new BrowserWindow({ width: W, height: H, x: wa.x + wa.width - W - 24, y: wa.y + wa.height - H - 24, frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: '#00000000', webPreferences: webPrefs() });
  win.selfcheck.setAlwaysOnTop(true, 'floating');
  win.selfcheck.loadURL(pageURL('selfcheck.html'));
  win.selfcheck.once('ready-to-show', () => { if (SHOW) win.selfcheck.showInactive(); send(win.selfcheck, 'selfcheck-info', { minutes: core.basicMinutes(), animal: store.settings.animal }); });
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
    { label: live.meeting ? '회의 끝남 (다시 분석)' : '회의 중 (분석 멈춤)', click: () => core.setMeeting(!live.meeting) },
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

// ---------- 판정 후처리는 shared/core.js. 여기서는 앱 전용 처리(창·메뉴바·알림)만 ----------
const toggleSnooze = (min) => core.toggleSnooze(min);
const onPosture = (p) => core.onPosture(p);
const updateWidget = () => core.updateWidget();
function sendWidget(state) {
  send(win.widget, 'widget', { ...state, size: WIDGET_PX[store.settings.widgetSize] || 120 });
  updateTrayThrottled();
}
let trayTimer = null, lastTrayState = '';
function updateTrayThrottled() {
  const s = trayState() + todayScore();
  if (s === lastTrayState || trayTimer) return;
  trayTimer = setTimeout(() => { trayTimer = null; lastTrayState = trayState() + todayScore(); updateTray(); }, 500);
}
function notify(title, body, page) {
  if (DEV.shots) { live.devNotifications = [...(live.devNotifications || []), { title, body }]; return; }
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: `바른생활 · ${title}`, body, silent: false });
  n.on('click', () => createMain(page));
  n.show();
}
const liveState = () => core.liveState();
let liveTimer = null;
function pushLive() {
  if (liveTimer) return;
  liveTimer = setTimeout(() => { liveTimer = null; const s = liveState(); send(win.main, 'live', s); send(win.lock, 'live', s); }, 200);
}
function createCore() {
  core = Core.createCore({
    store, Rules, Stretches,
    hooks: {
      notify, setDim, openLock, openSelfcheck, widgetChanged: sendWidget, liveChanged: pushLive,
      analyzerCmd: (cmd) => send(win.analyzer, 'cmd', cmd),
    },
  });
}

// ---------- 기본 모드(카메라 끔): 키보드·마우스 연속 사용 → 셀프 체크 S12 ----------
setInterval(() => { if (core) core.basicTick(powerMonitor.getSystemIdleTime()); }, 5000);

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
    if ('schedule' in patch) core.applyPause();
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
  ipcMain.on('report-good', () => core.reportGood());
  ipcMain.on('stretch-done', () => core.stretchDone());
  ipcMain.on('stretch-rec', () => store.count('stretchRec'));
  ipcMain.on('open-main', (e, hash) => createMain(hash));
  ipcMain.on('widget-move', (e, { x, y }) => {
    // setPosition만 쓰면 Windows(배율 100% 아님)에서 이동할 때마다 창이 조금씩 커진다 -> 크기까지 함께 지정
    if (win.widget && widgetSize) win.widget.setBounds({ x: Math.round(x), y: Math.round(y), ...widgetSize });
  });
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
      { label: '지금 바른 자세인데요', enabled: !!(live.posture && live.posture.issues && live.posture.issues.length), click: () => core.reportGood() },
      { type: 'separator' },
      { label: '바른생활 열기', click: () => createMain('home') },
    ]).popup({ window: win.widget });
  });
  ipcMain.on('tray-frames', (e, frames) => {
    trayFrames = {};
    for (const [state, list] of Object.entries(frames)) trayFrames[state] = list.map((d) => nativeImage.createFromBuffer(Buffer.from(d.split(',')[1], 'base64'), { scaleFactor: 2 }));
    lastTrayState = ''; updateTray();
  });
  ipcMain.on('lock-release', (e, how) => { if (core.lockRelease(how)) closeLock(); });
  ipcMain.on('selfcheck-answer', (e, ans) => { core.selfcheckAnswer(ans); if (win.selfcheck) win.selfcheck.destroy(); });
  ipcMain.on('selfcheck-close', () => { if (win.selfcheck) win.selfcheck.destroy(); });
  ipcMain.on('dev-open-selfcheck', () => openSelfcheck());
  ipcMain.on('dev-open-lock', () => openLock((live.posture && live.posture.issues[0]) || { key: 'turtle', ko: '목이 앞으로 나와 있어요', dur: 360 }));
}

// ---------- 시작 ----------
const trace = (m) => { if (process.env.JASAI_TRACE) process.stderr.write(`[trace] ${m}\n`); };
trace('main.js 로드');
app.whenReady().then(async () => {
  trace('ready');
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    if (u.host === 'models') return net.fetch(pathToFileURL(path.join(MODELS_DIR, decodeURIComponent(u.pathname))).toString());
    if (u.pathname === '/__fake__' && DEV.fakeImage) return net.fetch(pathToFileURL(path.resolve(DEV.fakeImage)).toString());   // 화면과 같은 출처여야 픽셀을 읽을 수 있다
    const p = path.normalize(path.join(__dirname, decodeURIComponent(u.pathname)));
    if (!p.startsWith(__dirname)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(p).toString());
  });
  trace('protocol 등록');
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'notifications'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ['media', 'notifications'].includes(perm));
  if (process.platform === 'darwin' && !DEV.fakeImage) { try { await systemPreferences.askForMediaAccess('camera'); } catch { /* 권한 창 실패 무시 */ } }

  trace('권한 처리');
  store = new Store(app.getPath('userData'));
  createCore();
  trace('store');
  if (DEV.seed) require('./dev/seed')(store);
  registerIpc();
  createMain(); trace('main 창');
  createAnalyzer(); trace('분석 창');
  createWidget(); trace('위젯');
  createTray(); trace('트레이');
  if (DEV.shots) require('./dev/shots')({ app, win, store, live, onPosture, openLock, openSelfcheck, setDim, createMain, send, dir: DEV.shots });
});
app.on('window-all-closed', (e) => { /* 위젯·트레이 앱이라 창을 다 닫아도 계속 실행 */ });
app.on('activate', () => createMain());
app.on('before-quit', () => store && store.save(true));
