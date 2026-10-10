// 웹 버전의 '앱 본체'. 데스크톱 앱(app/main.js)이 하던 일을 브라우저 안에서 대신한다.
// 화면 코드(app/renderer/*.js)는 window.barun 으로만 본체와 통신하므로, 같은 이름의 통로를 여기서 만들어 그대로 재사용한다.
// 판정 후처리는 앱과 같은 shared/core.js, 저장은 shared/storecore.js + localStorage.
(function () {
  const { StoreCore, today } = window.StoreCore;
  const Rules = window.Rules, Stretches = window.Stretches, Critter = window.Critter;
  const params = new URLSearchParams(location.search);
  const FAKE = params.get('fake') ? new URL(params.get('fake'), location.href).href : null;   // 시험용: ?fake=사진주소 면 카메라 대신 사진을 쓴다(iframe 에서도 쓰게 절대 주소로)

  // MediaPipe는 CDN에서 받는다(앱은 앱 안에 넣어 둠). 버전은 앱과 같게 고정
  window.BARUN_PATHS = {
    vision: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs',
    wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
    model: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  };

  // ---------- 페이지 안 이벤트 통로 ----------
  const listeners = {};
  const emit = (ch, data) => (listeners[ch] || []).slice().forEach((fn) => { try { fn(data); } catch (e) { console.warn(ch, e); } });
  const KEY = 'barun-data';
  const store = new StoreCore({
    load: () => JSON.parse(localStorage.getItem(KEY) || 'null'),
    save: (data) => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { console.warn('저장 실패', e); } },
  });
  window.addEventListener('pagehide', () => store.save(true));

  // ---------- 웹 전용 화면 요소: 캐릭터, 화면 흐림, 교정 유도 화면, 셀프 체크 ----------
  document.head.insertAdjacentHTML('beforeend', `<style>${Critter.CRITTER_CSS}</style>`);
  document.body.insertAdjacentHTML('beforeend', `
    <div id="web-dim"></div>
    <div id="web-widget" title="바른생활"><div id="web-art"></div><span id="web-dot"></span>
      <div id="web-tip">이 탭을 닫으면 분석이 멈춰요</div></div>
    <div id="web-banner">웹 체험판 · 다른 앱 위에 항상 떠 있는 위젯과 화면 흐림은 데스크톱 앱에서 돼요</div>`);
  const art = document.getElementById('web-art'), dot = document.getElementById('web-dot');
  let pip = null, lastWidget = null, lastKey = '';

  function renderWidget(s) {
    lastWidget = s;
    const key = `${s.animal}|${s.pose}|${s.tint}|${s.dir}`;
    dot.className = s.analyzing ? '' : 'off';
    if (key !== lastKey) {
      lastKey = key;
      const svg = Critter.critterSVG(s.animal, s.pose, { tint: s.tint, dir: s.dir });
      art.innerHTML = svg;
      if (pip) { const a = pip.document.getElementById('art'); if (a) a.innerHTML = svg; }
      setFavicon(s);
    }
    if (pip) { const d = pip.document.getElementById('dot'); if (d) d.className = s.analyzing ? '' : 'off'; }
  }
  // 탭 아이콘·제목으로 상태 표시(메뉴바 아이콘 대신)
  function setFavicon(s) {
    const svg = Critter.critterSVG(s.animal, s.pose, { tint: s.tint, dir: s.dir, still: true });
    let link = document.querySelector('link[rel=icon]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function setTitle(state) {
    const p = state.posture;
    const top = p && p.issues && p.issues[0];
    document.title = state.paused ? '일시정지 · 바른생활' : top ? `${p.level === 'warning' ? '🔴' : '🟡'} ${top.ko} · 바른생활` : '바른생활';
  }

  // 크롬·엣지: 다른 앱 위에 항상 떠 있는 작은 창(Document Picture-in-Picture)
  async function openPip() {
    if (!('documentPictureInPicture' in window)) { alert('이 브라우저는 작은 위젯 창을 지원하지 않아요. 크롬이나 엣지에서 열어 주세요.'); return; }
    if (pip) { pip.focus && pip.focus(); return; }
    pip = await documentPictureInPicture.requestWindow({ width: 180, height: 190 });
    pip.document.head.innerHTML = `<meta charset="utf-8"><title>바른생활</title><style>${Critter.CRITTER_CSS}
      html,body{margin:0;height:100%;background:oklch(0.975 0.004 85);overflow:hidden;cursor:pointer}
      #box{position:relative;width:150px;height:150px;margin:16px auto 0}#art{width:100%;height:100%}
      #dot{position:absolute;right:2%;bottom:10%;width:12px;height:12px;border-radius:50%;border:2px solid #fff;background:oklch(0.62 0.13 155)}#dot.off{background:oklch(0.75 0.005 85)}</style>`;
    pip.document.body.innerHTML = '<div id="box"><div id="art"></div><span id="dot"></span></div>';
    pip.document.body.onclick = () => window.focus();
    pip.addEventListener('pagehide', () => { pip = null; document.getElementById('web-widget').classList.remove('in-pip'); });
    document.getElementById('web-widget').classList.add('in-pip');
    lastKey = ''; if (lastWidget) renderWidget(lastWidget);
  }
  document.getElementById('web-widget').onclick = () => { location.hash = 'home'; };

  const dimEl = document.getElementById('web-dim');
  function setDim(o) { dimEl.style.opacity = o > 0 ? o : 0; }

  let lockFrame = null, selfFrame = null;
  function openLock(issue) {
    if (lockFrame) return;
    core.lockOpened(issue);
    lockFrame = document.createElement('iframe');
    lockFrame.id = 'web-lock'; lockFrame.src = 'renderer/lock.html';
    lockFrame.onload = () => emit('lock-info', { issue, mode: store.settings.mode, emergencyLeft: store.emergencyLeft(), minutes: Math.max(1, Math.round(((issue && issue.dur) || 0) / 60)) });
    document.body.appendChild(lockFrame);
  }
  function closeLock() { if (lockFrame) { lockFrame.remove(); lockFrame = null; listeners['lock-info'] = []; } }
  function openSelfcheck() {
    if (selfFrame) return;
    selfFrame = document.createElement('iframe');
    selfFrame.id = 'web-selfcheck'; selfFrame.src = 'renderer/selfcheck.html';
    selfFrame.onload = () => emit('selfcheck-info', { minutes: core.basicMinutes(), animal: store.settings.animal });
    document.body.appendChild(selfFrame);
  }
  function closeSelfcheck() { if (selfFrame) { selfFrame.remove(); selfFrame = null; listeners['selfcheck-info'] = []; } }

  // 브라우저 알림. 권한은 처음 알림을 보낼 때가 아니라 온보딩을 마칠 때 묻는다
  function notify(title, body, page) {
    window.__barunNotifications = [...(window.__barunNotifications || []), { title, body }];
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(`바른생활 · ${title}`, { body, icon: 'icon.png', tag: 'barun' });
    n.onclick = () => { window.focus(); location.hash = page; n.close(); };
  }
  const askNotify = () => { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); };

  // ---------- 판정 후처리: 앱과 같은 shared/core.js ----------
  let liveTimer = null;
  const pushLive = () => {
    if (liveTimer) return;
    liveTimer = setTimeout(() => { liveTimer = null; const s = core.liveState(); setTitle(s); emit('live', s); }, 200);
  };
  const core = window.Core.createCore({
    store, Rules, Stretches,
    hooks: { notify, setDim, openLock, openSelfcheck, widgetChanged: renderWidget, liveChanged: pushLive, analyzerCmd: (cmd) => emit('cmd', cmd) },
  });

  // 분석기(app/renderer/analyzer.js)는 카메라를 쓰는 모드일 때만 불러온다
  let analyzerLoaded = false;
  function startAnalyzer() {
    if (analyzerLoaded || !store.settings.mode || store.settings.mode === 'basic') return;
    analyzerLoaded = true;
    import('./renderer/analyzer.js').catch((e) => { console.error('분석기 시작 실패', e); analyzerLoaded = false; });
  }

  // 기본 모드: 이 페이지에서의 키보드·마우스 사용만 알 수 있다(브라우저 제한)
  let lastInput = Date.now();
  ['keydown', 'mousemove', 'mousedown', 'wheel'].forEach((ev) => window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true }));
  setInterval(() => core.basicTick((Date.now() - lastInput) / 1000), 5000);

  // ---------- window.barun: 화면 코드가 쓰는 통로 ----------
  const invoke = {
    'dev-info': () => ({ fakeImage: FAKE, shots: false }),
    'get-all': () => ({ settings: store.settings, baseline: store.data.baseline, days: store.data.days, live: core.liveState(), unlocks: store.unlocks(), emergencyLeft: store.emergencyLeft(), today: today(), platform: 'web' }),
    'set-settings': (patch) => {
      const before = store.settings.mode;
      const s = store.setSettings(patch);
      if ('mode' in patch && patch.mode !== before) {
        if (s.mode === 'basic' && analyzerLoaded) { store.save(true); location.reload(); }   // 카메라를 끄려면 다시 불러오는 게 가장 확실
        else startAnalyzer();
      }
      if ('schedule' in patch) core.applyPause();
      emit('cmd', { type: 'settings', settings: s, cautionSec: core.cautionSec() });
      core.updateWidget();
      return s;
    },
    'get-analyzer-config': () => ({ settings: store.settings, baseline: store.data.baseline, cautionSec: core.cautionSec(), paused: core.paused(), fakeImage: FAKE }),
    'widget-pos': () => [0, 0],
  };
  const on = {
    posture: (p) => core.onPosture(p),
    devices: (list) => { core.live.devices = list; pushLive(); },
    baseline: (b) => { store.data.baseline = b; store.save(); emit('baseline', b); },
    calibrate: () => { startAnalyzer(); const go = () => emit('cmd', { type: 'calibrate' }); if (listeners.cmd && listeners.cmd.length) go(); else setTimeout(function wait() { if (listeners.cmd && listeners.cmd.length) go(); else setTimeout(wait, 300); }, 300); },
    'cancel-calibrate': () => emit('cmd', { type: 'cancel-calibrate' }),
    'onboarding-done': () => { askNotify(); core.updateWidget(); },
    snooze: (min) => core.toggleSnooze(min || 30),
    'report-good': () => core.reportGood(),
    'stretch-done': () => core.stretchDone(),
    'stretch-rec': () => store.count('stretchRec'),
    'open-main': (hash) => { location.hash = hash; },
    'lock-release': (how) => { if (core.lockRelease(how)) closeLock(); },
    'selfcheck-answer': (ans) => { core.selfcheckAnswer(ans); closeSelfcheck(); },
    'selfcheck-close': () => closeSelfcheck(),
    'web-pip': () => openPip(),
  };
  window.barun = {
    invoke: async (ch, ...a) => (invoke[ch] ? invoke[ch](...a) : null),
    send: (ch, ...a) => { if (on[ch]) on[ch](...a); },
    on: (ch, fn) => { (listeners[ch] ||= []).push(fn); return () => { listeners[ch] = listeners[ch].filter((f) => f !== fn); }; },
  };
  window.barunDev = { emit, core, store, openLock, openSelfcheck };   // 시험용

  core.updateWidget();
  startAnalyzer();
})();
