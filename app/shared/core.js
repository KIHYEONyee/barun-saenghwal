// 판정 결과 후처리(앱·웹 공용): 기록, 단계적 개입(S10), 오래 앉음, 자세 고침 칭찬, 위젯 상태, 기본 모드 셀프 체크
// 창·알림·화면 흐림처럼 앱과 웹이 다르게 처리하는 일은 hooks 로 받는다.
//   hooks.notify(title, body, page)   hooks.setDim(opacity)   hooks.openLock(issue)   hooks.openSelfcheck()
//   hooks.widgetChanged(state)        hooks.liveChanged()      hooks.analyzerCmd(cmd)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const POSE_OF = { turtle: 'turtle', close: 'turtle', head_down: 'slouch', slouch: 'slouch', roll: 'tilt', tilt: 'tilt', lean: 'tilt', shrug: 'shrug', chin: 'chin' };
  const GUIDE = {
    turtle: '턱을 살짝 당기고 화면에서 한 뼘 떨어져 보세요', close: '화면에서 조금 떨어져 앉아 보세요', head_down: '화면을 눈높이로 올리고 고개를 들어 보세요',
    roll: '고개를 똑바로 세워 보세요', tilt: '양 어깨 높이를 맞춰 보세요', shrug: '어깨에 힘을 빼고 툭 떨어뜨려 보세요',
    lean: '엉덩이를 의자 깊숙이 넣고 가운데로 앉아 보세요', chin: '손을 내리고 턱을 당겨 보세요', slouch: '허리를 펴고 등받이에 기대 보세요',
  };
  const guidance = (key) => GUIDE[key] || '자세를 바로 해 보세요';

  function createCore({ store, Rules, Stretches, hooks }) {
    const h = { notify() {}, setDim() {}, openLock() {}, openSelfcheck() {}, widgetChanged() {}, liveChanged() {}, analyzerCmd() {}, ...hooks };
    const live = {
      posture: null,          // 분석기가 보낸 마지막 판정
      widgetPose: 'good', widgetTint: 'auto', widgetDir: 0,
      snoozeUntil: 0, meeting: false,
      sitStart: null, lastSeen: 0, restDue: false, restNotified: false,
      episode: null,          // { start, key, notified, maxDur }
      praiseUntil: 0, lockedAt: 0, devices: [],
      basicUseStart: null, lastSelfcheck: 0, basicPose: null, lastCalibrated: null,
    };
    let lastTick = Date.now();

    const cautionSec = () => ({ fast: 2, normal: 3, relaxed: 5 }[store.settings.sensitivity] || 3);
    function outOfSchedule() {
      const s = store.settings.schedule;
      if (!s || !s.enabled) return false;
      const now = new Date(); const m = now.getHours() * 60 + now.getMinutes();
      const [sh, sm] = s.start.split(':').map(Number), [eh, em] = s.end.split(':').map(Number);
      return m < sh * 60 + sm || m >= eh * 60 + em;
    }
    const paused = () => Date.now() < live.snoozeUntil || live.meeting || outOfSchedule();
    function todayScore() {
      const d = store.day();
      const tot = d.sec.good + d.sec.caution + d.sec.warning;
      return tot > 0 ? Math.round((d.sec.good / tot) * 100) : null;
    }

    function notify(title, body, page) { if (!paused()) h.notify(title, body, page); }

    function onPosture(p) {
      const now = Date.now();
      const dt = Math.min(2, (now - lastTick) / 1000); lastTick = now;
      live.posture = p;
      if (p.calibrated) live.lastCalibrated = { ...p.calibrated, t: now };   // 한 번만 오는 결과라 화면이 놓치지 않게 보관
      if (p.calibrating) { h.liveChanged(); return; }

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

      // 단계적 개입: 3초 노랑(분석기) → 10초 빨강 + 알림 → 화면 흐림 → (집중 교정 모드) 교정 유도 화면
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
          h.setDim(Math.min(0.55, ((top.dur - store.settings.dimAfterSec) / 60) * 0.55 + 0.08));
        }
        const maxSev = Math.max(...p.issues.map((i) => i.sev || 0));
        if (store.settings.focusMode && top.dur >= store.settings.lockAfterSec && maxSev >= store.settings.lockMinSev) h.openLock(top);
      } else {
        if (live.episode && live.episode.maxDur >= Rules.WARN_SEC && p.present) live.praiseUntil = now + 2500;   // 자세 고침 칭찬
        live.episode = null;
        h.setDim(0);
      }
      updateWidget(); h.liveChanged();
    }

    function widgetState() {
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
      return { pose, tint, dir, animal: store.settings.animal, analyzing: !paused() && store.settings.mode !== 'basic' };
    }
    function updateWidget() { h.widgetChanged(widgetState()); }

    function liveState() {
      return {
        posture: live.posture, widgetPose: live.widgetPose, widgetTint: live.widgetTint, widgetDir: live.widgetDir,
        paused: paused(), snoozeUntil: live.snoozeUntil, meeting: live.meeting, restDue: live.restDue,
        sitMin: live.sitStart ? (Date.now() - live.sitStart) / 60000 : 0, score: todayScore(), devices: live.devices, lastCalibrated: live.lastCalibrated || null,
      };
    }

    function applyPause() {
      h.analyzerCmd({ type: paused() ? 'pause' : 'resume' });
      if (paused()) { h.setDim(0); live.episode = null; }
      updateWidget(); h.liveChanged();
    }
    function toggleSnooze(min = 30) { live.snoozeUntil = Date.now() < live.snoozeUntil ? 0 : Date.now() + min * 60000; applyPause(); }
    function setMeeting(v) { live.meeting = v; applyPause(); }

    // 교정 유도 화면(S11)이 열리고 닫힐 때
    function lockOpened() { live.lockedAt = Date.now(); store.count('locks'); h.setDim(0); }
    function lockClosed(reason) {
      store.count('lockReleaseSec', (Date.now() - live.lockedAt) / 1000);
      live.episode = null;
      if (reason === 'fixed') live.praiseUntil = Date.now() + 3000;
    }
    function lockRelease(how) {   // 반환: 화면을 닫아야 하면 true
      if (how === 'emergency') { if (store.emergencyLeft() <= 0) return false; store.useEmergency(); lockClosed('emergency'); return true; }
      if (how === 'report') { store.count('falseReports'); h.analyzerCmd({ type: 'report-good' }); lockClosed('report'); return true; }
      lockClosed('fixed'); return true;
    }

    function reportGood() { store.count('falseReports'); h.analyzerCmd({ type: 'report-good' }); live.episode = null; h.setDim(0); }
    function stretchDone() { store.count('stretchDone'); live.restDue = false; live.sitStart = Date.now(); updateWidget(); }

    // 기본 모드(카메라 끔): 키보드·마우스를 쉬지 않고 쓴 시간을 재다가 셀프 체크(S12). idleSec = 마지막 입력 후 지난 초
    function basicTick(idleSec) {
      if (store.settings.mode !== 'basic' || paused()) return;
      const now = Date.now();
      if (idleSec < 60) { if (!live.basicUseStart) live.basicUseStart = now; }
      else if (idleSec > 180) { live.basicUseStart = null; live.basicPose = null; }
      const useMin = live.basicUseStart ? (now - live.basicUseStart) / 60000 : 0;
      if (useMin >= store.settings.sitReminderMin && now - live.lastSelfcheck > store.settings.sitReminderMin * 60000) {
        live.lastSelfcheck = now; h.openSelfcheck();
      }
    }
    const basicMinutes = () => Math.round((Date.now() - (live.basicUseStart || Date.now())) / 60000);
    function selfcheckAnswer(ans) {
      const d = store.day(); d.selfchecks.push({ t: Date.now(), answer: ans }); store.save();
      // 기본 모드는 답변을 같은 리포트로 집계: 답한 자세를 직전 10분 동안의 상태로 기록(근사)
      const map = { good: ['good', null], turtle: ['warning', 'turtle'], slouch: ['warning', 'head_down'], tilt: ['caution', 'tilt'] };
      const [st, key] = map[ans] || ['good', null];
      store.record(st, 600, key);
      live.basicPose = ans === 'good' ? null : { pose: POSE_OF[key] || 'tilt', tint: st === 'warning' ? 'warning' : 'caution' };
      if (ans !== 'good') notify('자세를 바로 해 볼까요?', guidance(key), `stretch/${Stretches.recommend({ [key]: 1 }, 1)[0].id}`);
      updateWidget();
    }

    return {
      live, paused, todayScore, cautionSec, onPosture, widgetState, updateWidget, liveState, applyPause, toggleSnooze, setMeeting,
      lockOpened, lockClosed, lockRelease, reportGood, stretchDone, basicTick, basicMinutes, selfcheckAnswer, guidance,
    };
  }

  return { createCore, POSE_OF, guidance };
});
