// 시험용 시나리오: 사진을 카메라 대신 넣고 S1~S12 화면을 차례로 띄워 PNG로 저장한 뒤 종료한다.
// 실행: JASAI_FAKE_IMAGE=사진 JASAI_SHOTS=저장폴더 JASAI_USERDATA=임시폴더 JASAI_SEED=1 npx electron .
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

module.exports = async function shots({ app, win, store, live, openLock, openSelfcheck, send, dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const log = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(200); } return false; };
  const note = (msg) => { const p = live.posture || {}; log.push({ t: new Date().toISOString().slice(11, 19), msg, level: p.level, issues: (p.issues || []).map((i) => `${i.key}:${i.dur.toFixed(1)}s:sev${(i.sev || 0).toFixed(2)}`), widget: `${live.widgetPose}/${live.widgetTint}`, calibrated: p.calibrated }); console.log('[shots]', msg, JSON.stringify(log[log.length - 1])); };
  const shot = async (w, name) => {
    if (!w || w.isDestroyed()) { note(`캡처 실패(창 없음): ${name}`); return; }
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
    note(`캡처 ${name} ${img.getSize().width}x${img.getSize().height}`);
  };
  const js = (code) => win.main.webContents.executeJavaScript(code);
  const rotate = (angle) => send(win.analyzer, 'cmd', { type: 'dev-rotate', angle });
  ipcMain.on('tray-frames', (e, frames) => {
    for (const [st, list] of Object.entries(frames)) list.forEach((d, i) => fs.writeFileSync(path.join(dir, `S9-tray-${st}-${i}.png`), Buffer.from(d.split(',')[1], 'base64')));
  });
  try {
    store.setSettings({ dimAfterSec: 15 });   // 시험 시간을 줄이려고 화면 흐림을 15초로
    await waitFor(() => win.main && !win.main.webContents.isLoading());
    await wait(1500);
    await shot(win.main, 'S1-mode');
    await js("document.querySelector('[data-m=webcam]').click(); document.querySelector('#next').click();");
    const calibStarted = await waitFor(() => live.posture && live.posture.calibrating, 30000);
    note(`기준 측정 시작: ${calibStarted}`);
    await wait(4000);
    await shot(win.main, 'S2-calibrating');
    const calibrated = await waitFor(() => live.lastCalibrated, 20000);
    note(`기준 측정 끝: ${calibrated}`);
    await wait(800);
    await shot(win.main, 'S2-done');
    await js("document.querySelector('#cal-done').click()");
    await wait(1000);
    await shot(win.main, 'S2b-character');
    await js("document.querySelector('#go').click()");
    await wait(3000);
    note('바른 자세');
    await shot(win.main, 'S3-home-good');
    await shot(win.widget, 'S8-widget-good');

    rotate(14); note('사진 14도 기울임');
    await wait(5000);
    await shot(win.main, 'S3-home-caution');
    await shot(win.widget, 'S8-widget-caution');
    await wait(7000);
    await shot(win.main, 'S3-home-warning');
    await shot(win.widget, 'S8-widget-warning');
    await waitFor(() => win.dim, 10000);
    await wait(2500);
    await shot(win.dim, 'S10-dim');
    note(`알림: ${JSON.stringify(live.devNotifications || [])}`);

    openLock((live.posture && live.posture.issues[0]) || { key: 'roll', ko: '고개가 기울어져 있어요', dur: 360 });
    await wait(2000);
    await shot(win.lock, 'S11-lock');
    await win.lock.webContents.executeJavaScript("document.querySelector('#emg').click()");
    await wait(500);
    note(`교정 유도 화면 비상 해제 후 열림: ${!!win.lock}`);

    rotate(0); note('사진 원래대로');
    await wait(1800);
    await shot(win.widget, 'S8-widget-praise-1');
    await wait(1200);
    await shot(win.widget, 'S8-widget-praise-2');

    await js("location.hash='report'"); await wait(1500);
    await shot(win.main, 'S4-report-week');
    await js("document.querySelector('[data-u=day]').click()"); await wait(800);
    await shot(win.main, 'S4-report-day');
    await js("location.hash='stretch'"); await wait(1200);
    await shot(win.main, 'S5-list');
    await js("location.hash='stretch/neck_side'"); rotate(-22); await wait(4000);
    await shot(win.main, 'S5-follow');
    rotate(0);
    for (const t of ['widget', 'detect', 'focus', 'notify', 'privacy']) { await js(`location.hash='settings/${t}'`); await wait(900); await shot(win.main, `S6-settings-${t}`); }
    openSelfcheck(); await wait(1500);
    await shot(win.selfcheck, 'S12-selfcheck');
    await win.selfcheck.webContents.executeJavaScript("document.querySelector('[data-a=turtle]').click()");
    await wait(800);
    note(`셀프 체크 답 후 위젯: ${live.widgetPose}`);
  } catch (e) {
    note(`오류: ${e.stack || e}`);
  }
  fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ log, notifications: live.devNotifications || [], days: store.data.days }, null, 1));
  app.exit(0);
};
