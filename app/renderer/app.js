// 메인 창: 온보딩(S1·S2) · 홈(S3) · 리포트(S4) · 스트레칭(S5) · 설정(S6)
const B = window.barun, R = window.Rules, S = window.Stretches, C = window.Critter;
document.head.insertAdjacentHTML('beforeend', `<style>${C.CRITTER_CSS}</style>`);

let D = await B.invoke('get-all');
let LIVE = D.live;
const DEV = await B.invoke('dev-info');
const WEB = D.platform === 'web';   // 웹 버전(webapp/)에서는 메뉴바·클릭 통과 같은 데스크톱 전용 설정을 숨긴다
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const critter = (pose, opts = {}) => `<div>${C.critterSVG(opts.animal || D.settings.animal, pose, opts)}</div>`;
const pct = (v) => (v === null || v === undefined || Number.isNaN(v) ? '-' : `${Math.round(v * 100)}%`);

// ---------- 기록 계산 ----------
const ISSUE_NAME = { turtle: '거북목', close: '화면에 가까움', head_down: '고개 숙임', slouch: '구부정', roll: '고개 기울어짐', tilt: '어깨 기울어짐', shrug: '어깨 으쓱', lean: '몸 기울어짐', chin: '턱 괴기' };
const PART_OF = { turtle: 'neck', head_down: 'neck', close: 'head', roll: 'head', tilt: 'shoulder', shrug: 'shoulder', lean: 'torso', slouch: 'torso', chin: 'arm' };
const PARTS = [['head', '머리'], ['neck', '목'], ['shoulder', '어깨'], ['torso', '상체'], ['arm', '팔']];
const GUIDE = {
  turtle: '턱을 살짝 당기고 화면에서 한 뼘 떨어져 보세요.', close: '화면에서 조금 떨어져 앉아 보세요.', head_down: '화면을 눈높이로 올리고 고개를 들어 보세요.',
  roll: '고개를 똑바로 세워 보세요.', tilt: '양 어깨 높이를 맞춰 보세요.', shrug: '어깨에 힘을 빼고 툭 떨어뜨려 보세요.',
  lean: '엉덩이를 의자 깊숙이 넣고 가운데로 앉아 보세요.', chin: '손을 내리고 턱을 당겨 보세요.', slouch: '허리를 펴고 등받이에 기대 보세요.',
};
const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const EMPTY = () => ({ sec: { good: 0, caution: 0, warning: 0, away: 0, paused: 0 }, issues: {}, hours: {}, tl: {}, locks: 0, lockReleaseSec: 0, notifies: 0, stretchDone: 0, stretchRec: 0, selfchecks: [] });
const dayOf = (d) => D.days[keyOf(d)] || EMPTY();
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function sumDays(dates) {
  const o = EMPTY();
  for (const dt of dates) {
    const d = dayOf(dt);
    for (const k of Object.keys(o.sec)) o.sec[k] += d.sec[k] || 0;
    for (const [k, v] of Object.entries(d.issues || {})) o.issues[k] = (o.issues[k] || 0) + v;
    for (const k of ['locks', 'lockReleaseSec', 'notifies', 'stretchDone', 'stretchRec']) o[k] += d[k] || 0;
  }
  return o;
}
const goodRate = (d) => { const t = d.sec.good + d.sec.caution + d.sec.warning; return t > 0 ? d.sec.good / t : null; };
const usedSec = (d) => d.sec.good + d.sec.caution + d.sec.warning;
function fmtDur(sec) {
  sec = Math.round(sec || 0);
  if (sec >= 3600) return `${Math.floor(sec / 3600)}시간 ${Math.floor((sec % 3600) / 60)}분`;
  if (sec >= 60) return `${Math.floor(sec / 60)}분`;
  return `${sec}초`;
}
const WD = ['일', '월', '화', '수', '목', '금', '토'];
// 받침에 따라 조사 고르기: josa('거북목', '이', '가') → '거북목이'
const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c >= 0 && c <= 11171 && c % 28 ? a : b); };
const monday = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

// ---------- 카메라 미리보기(기준 측정·스트레칭) ----------
let previewStream = null;
async function mountPreview(el) {
  stopPreview();
  if (DEV.fakeImage) { el.insertAdjacentHTML('afterbegin', `<img class="fake" src="${DEV.fakeImage}">`); return; }
  const want = (LIVE.devices || []).find((d) => d.label === (LIVE.posture && LIVE.posture.device)) || (LIVE.devices || [])[0];
  try {
    previewStream = await navigator.mediaDevices.getUserMedia({ video: want ? { deviceId: { exact: want.id } } : true });
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = previewStream;
    el.prepend(v); await v.play();
  } catch { el.insertAdjacentHTML('afterbegin', '<div class="toast">카메라를 열 수 없어요</div>'); }
}
function stopPreview() { if (previewStream) previewStream.getTracks().forEach((t) => t.stop()); previewStream = null; }
function drawLandmarks(canvas) {
  const lm = LIVE.posture && LIVE.posture.landmarks;
  const ctx = canvas.getContext('2d');
  const W = (canvas.width = canvas.clientWidth), H = (canvas.height = canvas.clientHeight);
  ctx.clearRect(0, 0, W, H);
  if (!lm) return;
  // 미리보기는 object-fit: cover 로 잘려 보이므로, 원본 크기 기준 좌표를 잘린 화면 좌표로 바꾼다
  const media = canvas.parentElement.querySelector('video, img');
  const sw = media && (media.videoWidth || media.naturalWidth), sh = media && (media.videoHeight || media.naturalHeight);
  if (!sw || !sh) return;
  const k = Math.max(W / sw, H / sh), ox = (W - sw * k) / 2, oy = (H - sh * k) / 2;
  const X = (p) => ox + p[0] * sw * k, Y = (p) => oy + p[1] * sh * k;
  ctx.strokeStyle = 'rgba(140,230,180,.9)'; ctx.lineWidth = 3;
  for (const [a, b] of [[11, 12], [7, 11], [8, 12], [0, 7], [0, 8], [11, 13], [12, 14]]) {
    if (!lm[a] || !lm[b] || lm[a][2] < 0.5 || lm[b][2] < 0.5) continue;
    ctx.beginPath(); ctx.moveTo(X(lm[a]), Y(lm[a])); ctx.lineTo(X(lm[b]), Y(lm[b])); ctx.stroke();
  }
}

// ---------- 라우팅 ----------
let page = null;   // { update() } 현재 화면의 실시간 갱신 함수
window.addEventListener('hashchange', render);
B.on('navigate', (h) => { location.hash = h; });
B.on('live', (s) => { LIVE = s; if (page && page.update) page.update(); });
B.on('baseline', (b) => { D.baseline = b; });
setInterval(async () => { if (['home', 'report'].includes(route()[0])) { D = await B.invoke('get-all'); if (page && page.refresh) page.refresh(); } }, 10000);
const route = () => (location.hash.slice(1) || (D.settings.mode ? 'home' : 'onboard-mode')).split('/');

async function render() {
  stopPreview(); page = null;
  D = await B.invoke('get-all');
  const [r, arg] = route();
  if (r === 'onboard-mode') return pageOnboardMode();
  if (r === 'onboard-calib') return pageCalib();
  if (r === 'onboard-done') return pageOnboardDone();
  app.innerHTML = `<div class="shell">${sidebar(r)}<main class="content" id="main"></main></div>`;
  bindSidebar();
  const main = $('#main');
  if (r === 'report') pageReport(main, arg);
  else if (r === 'stretch') pageStretch(main, arg);
  else if (r === 'settings') pageSettings(main, arg);
  else pageHome(main);
}

function sidebar(r) {
  const link = (h, t) => `<a href="#${h}" class="${r === h ? 'on' : ''}">${t}</a>`;
  return `<aside class="side"><div class="brand">바른생활</div>${link('home', '홈')}${link('report', '리포트')}${link('stretch', '스트레칭')}${link('settings', '설정')}
    <div class="status" id="side-status"></div></aside>`;
}
function bindSidebar() {
  const box = $('#side-status');
  const draw = () => {
    const modeName = { basic: '기본 모드', webcam: '웹캠 모드', precise: '정밀 모드' }[D.settings.mode] || '';
    const left = LIVE.snoozeUntil > Date.now() ? Math.ceil((LIVE.snoozeUntil - Date.now()) / 60000) : 0;
    box.innerHTML = LIVE.paused
      ? `<b><span class="dot away"></span> 일시정지 중</b><span class="small muted">${left ? `${left}분 남음` : LIVE.meeting ? '회의 중' : '예약 시간 밖'}</span><button id="snz">다시 시작</button>`
      : `<b><span class="dot"></span> ${D.settings.mode === 'basic' ? '셀프 체크 중' : '분석 중'}</b><span class="small muted">${modeName}${D.settings.mode !== 'basic' ? ' · 초당 8회' : ''}</span><button id="snz">30분 일시정지</button>`;
    $('#snz').onclick = () => B.send('snooze', 30);
  };
  draw();
  const prev = page;
  page = { ...(prev || {}), side: draw };
}
function setPage(p) { const side = page && page.side; page = { ...p, update: () => { if (side) side(); if (p.update) p.update(); } }; }

// ---------- S3 홈 ----------
function pageHome(main) {
  const draw = () => {
    const now = new Date();
    const d = dayOf(now), y = dayOf(addDays(now, -1));
    const rate = goodRate(d), yrate = goodRate(y);
    const p = LIVE.posture || {};
    const top = (p.issues || [])[0];
    const recs = S.recommend(d.issues, 3);
    // 알림 카드
    let cls = 'neutral', eyebrow = '', title = '', body = '', actions = '', pose = 'good', tint = 'auto', dir = 0;
    if (LIVE.paused) { eyebrow = '일시정지'; title = '잠시 쉬고 있어요'; body = '분석과 기록을 멈췄어요. 카메라도 꺼져 있어요.'; pose = 'away'; actions = '<button id="resume" class="dark">다시 시작</button>'; }
    else if (D.settings.mode === 'basic') { cls = 'good'; eyebrow = '기본 모드'; title = '카메라 없이 지켜보고 있어요'; body = `키보드·마우스를 ${D.settings.sitReminderMin}분 넘게 계속 쓰면 지금 자세를 물어볼게요.`; }
    else if (p.level === 'nobase') { eyebrow = '준비'; title = '기준 자세가 필요해요'; body = `바르게 앉은 자세를 ${R.CAL_SEC}초 재면 그 자세와 비교해 판정해요.`; actions = '<button id="calib" class="primary">기준 자세 측정</button>'; }
    else if (p.level === 'nocamera') { eyebrow = '카메라'; title = '카메라를 열 수 없어요'; body = '시스템 설정에서 카메라 권한을 확인하거나 설정에서 다른 카메라를 골라 주세요.'; }
    else if (!p.present) { eyebrow = '자리 비움'; title = '자리를 비웠어요'; body = '돌아오면 자동으로 다시 지켜볼게요.'; pose = 'away'; }
    else if (p.level === 'cantsee') { eyebrow = '확인 중'; title = '얼굴과 양 어깨가 잘 보이게 앉아 주세요'; body = '판정할 수 없을 때는 바른 자세로 치지 않아요.'; }
    else if (top) {
      cls = p.level === 'warning' ? 'warning' : 'caution';
      eyebrow = `${p.level === 'warning' ? '경고' : '주의'} · ${Math.round(top.dur)}초째`;
      title = top.ko; body = GUIDE[top.key] || '';
      pose = { turtle: 'turtle', close: 'turtle', head_down: 'slouch', slouch: 'slouch', shrug: 'shrug', chin: 'chin' }[top.key] || 'tilt';
      tint = p.level === 'warning' ? 'warning' : 'caution'; dir = top.dir;
      const st = S.recommend({ [top.key]: 1 }, 1)[0];
      actions = `<button class="dark" data-go="stretch/${st.id}">${st.name} ${S.duration(st)}초</button><button id="good">지금 바른 자세인데요</button>`;
    } else if (LIVE.restDue) { cls = 'caution'; eyebrow = '휴식'; title = `${Math.round(LIVE.sitMin)}분째 앉아 있어요`; body = '잠깐 일어나거나 스트레칭 해볼까요?'; pose = 'rest'; const st = S.recommend(d.issues, 1)[0]; actions = `<button class="dark" data-go="stretch/${st.id}">${st.name} 시작</button>`; }
    else { cls = 'good'; eyebrow = '바른 자세'; title = '바른 자세를 유지하고 있어요'; body = LIVE.sitMin >= 1 ? `${Math.round(LIVE.sitMin)}분째 앉아 있어요. ${D.settings.sitReminderMin}분이 되면 쉬자고 알려 드릴게요.` : '좋아요, 이대로 계속해요.'; }
    // 타임라인(10분 단위, 첫 기록 ~ 지금)
    const slots = Object.keys(d.tl).sort();
    let tl = '', tlRange = '기록 없음';
    if (slots.length) {
      const [h0, m0] = slots[0].split(':').map(Number);
      const start = h0 * 60 + m0, end = now.getHours() * 60 + now.getMinutes();
      for (let m = start; m <= end; m += 10) {
        const k = `${String(Math.floor(m / 60)).padStart(2, '0')}:${Math.floor((m % 60) / 10)}0`;
        const b = d.tl[k];
        const st = !b ? 'none' : Object.entries(b).sort((a, c) => c[1] - a[1])[0][0];
        tl += `<i class="tl-${st}" title="${k}"></i>`;
      }
      tlRange = `${slots[0]} – 지금`;
    }
    // 부위별 상태
    const live = {}; (p.issues || []).forEach((i) => { live[i.part] ||= i; });
    const cnt = {}; Object.entries(d.issues).forEach(([k, v]) => { const pt = PART_OF[k]; cnt[pt] = (cnt[pt] || 0) + v; });
    const parts = PARTS.map(([k, n]) => {
      const it = live[k];
      const dot = it ? (p.level === 'warning' ? 'warning' : 'caution') : '';
      return `<div><span class="dot ${dot}"></span><b>${n}</b><span>${it ? esc(it.ko) : '정상'}</span><span class="small muted">${it ? `${Math.round(it.dur)}초` : cnt[k] ? `오늘 ${fmtDur(cnt[k])}` : ''}</span></div>`;
    }).join('');
    const delta = rate !== null && yrate !== null ? Math.round((rate - yrate) * 100) : null;
    main.innerHTML = `
      <div class="home-top">
        <div class="alert ${cls}"><div class="art">${critter(pose, { tint, dir })}</div>
          <div><div class="eyebrow">${eyebrow}</div><h2>${esc(title)}</h2><div class="muted">${esc(body)}</div><div class="actions">${actions}</div></div></div>
        <div class="card"><div class="muted">오늘 바른 자세</div><div class="big">${rate === null ? '-' : Math.round(rate * 100) + '%'}</div>
          <div class="${delta === null ? 'muted' : delta >= 0 ? 'delta-up' : 'delta-down'}" style="margin:4px 0 10px">${delta === null ? '어제 기록 없음' : `어제보다 ${delta >= 0 ? '+' : ''}${delta}%p`}</div>
          <div class="small muted">사용 ${fmtDur(usedSec(d))} · 스트레칭 ${d.stretchDone || 0}회</div></div>
      </div>
      <div class="card"><div class="row"><h3>오늘 타임라인</h3><span class="muted small" style="margin-left:auto">${tlRange}</span></div>
        <div class="timeline">${tl || '<i class="tl-none"></i>'}</div>
        <div class="legend"><span><span class="dot"></span>바른 자세</span><span><span class="dot caution"></span>주의</span><span><span class="dot warning"></span>경고</span><span><span class="dot away"></span>자리 비움</span></div></div>
      <div class="grid" style="grid-template-columns:1fr 1fr">
        <div class="card"><h3 style="margin-bottom:6px">부위별 상태</h3><div class="parts">${parts}</div></div>
        <div class="card"><div class="row"><h3>추천 스트레칭</h3><span class="muted small" style="margin-left:auto">오늘 많았던 문제 기준</span></div>
          ${recs.map((s) => `<div class="stretch-row"><div class="thumb">${critter(s.pose, { tint: 'none', still: true })}</div><div><b>${s.name}</b><div class="small muted">${s.forText} · ${S.duration(s)}초</div></div><button data-go="stretch/${s.id}">시작</button></div>`).join('')}</div>
      </div>`;
    main.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { location.hash = b.dataset.go; }));
    const g = $('#good', main); if (g) g.onclick = () => B.send('report-good');
    const c = $('#calib', main); if (c) c.onclick = () => { location.hash = 'onboard-calib'; };
    const rs = $('#resume', main); if (rs) rs.onclick = () => B.send('snooze', 30);
  };
  draw();
  let last = 0;
  setPage({ update: () => { if (Date.now() - last > 900) { last = Date.now(); draw(); } }, refresh: draw });
}

// ---------- S4 리포트 ----------
function pageReport(main, arg) {
  let unit = arg === 'day' ? 'day' : 'week', offset = 0;
  const draw = () => {
    const base = new Date();
    let dates, prevDates, title;
    if (unit === 'week') {
      const m = addDays(monday(base), offset * 7);
      dates = [...Array(7)].map((_, i) => addDays(m, i)); prevDates = dates.map((d) => addDays(d, -7));
      title = `${m.getMonth() + 1}월 ${m.getDate()}일 – ${addDays(m, 6).getMonth() + 1 !== m.getMonth() + 1 ? `${addDays(m, 6).getMonth() + 1}월 ` : ''}${addDays(m, 6).getDate()}일`;
    } else {
      const d = addDays(base, offset); dates = [d]; prevDates = [addDays(d, -1)];
      title = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
    }
    const cur = sumDays(dates), prev = sumDays(prevDates);
    const rate = goodRate(cur), prate = goodRate(prev);
    const enough = usedSec(cur) >= 600 && usedSec(prev) >= 600;   // 10분 미만 기록끼리는 비교하지 않는다
    const delta = enough && rate !== null && prate !== null ? Math.round((rate - prate) * 100) : null;
    const issues = Object.entries(cur.issues).sort((a, b) => b[1] - a[1]);
    const maxI = issues.length ? issues[0][1] : 1;
    // 한 줄 코멘트: 지난 기간 대비 가장 많이 준 문제, 없으면 가장 잦은 문제
    let comment = '기록이 쌓이면 변화를 알려 드릴게요.';
    const changes = issues.map(([k, v]) => [k, prev.issues[k] ? (v - prev.issues[k]) / prev.issues[k] : null]).filter(([, c]) => c !== null);
    const best = changes.sort((a, b) => a[1] - b[1])[0];
    if (enough && best && best[1] < -0.05) comment = `${unit === 'week' ? '이번 주는' : '이날은'} ${josa(ISSUE_NAME[best[0]], '이', '가')} ${unit === 'week' ? '지난주보다' : '전날보다'} ${Math.round(-best[1] * 100)}% 줄었어요.`;
    else if (issues.length) comment = `${josa(ISSUE_NAME[issues[0][0]], '이', '가')} 가장 많았어요. ${josa(S.recommend({ [issues[0][0]]: 1 }, 1)[0].name, '을', '를')} 해 보세요.`;
    // 요일×시간 히트맵(9~20시)
    const hrs = [...Array(12)].map((_, i) => 9 + i);
    let worst = null;
    const heatRows = (unit === 'week' ? dates : dates).map((dt) => {
      const d = dayOf(dt);
      const cells = hrs.map((h) => {
        const b = d.hours[h] || { good: 0, bad: 0 };
        const t = b.good + b.bad;
        const v = t > 60 ? b.bad / t : null;
        if (v !== null && (!worst || v > worst.v)) worst = { v, wd: dt.getDay(), h };
        const bg = v === null ? 'oklch(0.97 0.003 85)' : `oklch(${0.93 - v * 0.33} ${0.04 + v * 0.13} 40)`;
        return `<i style="background:${bg}" title="${h}시 ${v === null ? '기록 없음' : Math.round(v * 100) + '% 나쁜 자세'}"></i>`;
      }).join('');
      return `<span>${WD[dt.getDay()]}</span>${cells}`;
    }).join('');
    const ampm = (h) => (h < 12 ? '오전' : h < 18 ? '오후' : '저녁');
    const heatTitle = worst && worst.v > 0.2 ? `${WD[worst.wd]}요일 ${ampm(worst.h)}에 자세가 무너져요` : '';
    main.innerHTML = `
      <div class="rep-head"><h1>${title}</h1><div class="seg"><button data-u="day" class="${unit === 'day' ? 'on' : ''}">일</button><button data-u="week" class="${unit === 'week' ? 'on' : ''}">주</button></div>
        <div class="nav"><button class="ghost" id="prev">‹</button><button class="ghost" id="next" ${offset >= 0 ? 'disabled' : ''}>›</button></div></div>
      <div class="rep-cards">
        <div class="card hl"><div class="small" style="color:var(--green)">바른 자세 유지</div><div class="row" style="align-items:baseline"><div class="big">${rate === null ? '-' : Math.round(rate * 100) + '%'}</div>
          <span class="${delta === null ? 'muted' : delta >= 0 ? 'delta-up' : 'delta-down'}">${delta === null ? '' : `${delta >= 0 ? '+' : ''}${delta}%p`}</span></div><b style="display:block;margin-top:8px">${esc(comment)}</b></div>
        <div class="card"><div class="muted small">교정 유도 화면</div><div class="big" style="font-size:40px">${cur.locks}회</div><div class="small muted">${cur.locks ? `해제까지 평균 ${Math.round(cur.lockReleaseSec / cur.locks)}초` : '집중 교정 모드에서만 떠요'}</div></div>
        <div class="card"><div class="muted small">스트레칭 수행</div><div class="big" style="font-size:40px">${cur.stretchDone}<span class="muted" style="font-size:22px"> / ${Math.max(cur.stretchRec, cur.stretchDone)}</span></div><div class="small muted">추천 대비 ${cur.stretchRec ? Math.round((cur.stretchDone / Math.max(cur.stretchRec, cur.stretchDone)) * 100) : 0}%</div></div>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1.25fr">
        <div class="card issue-bars"><h3 style="margin-bottom:14px">부위별 문제 시간</h3>
          ${issues.length ? issues.map(([k, v], i) => `<div><div class="row"><span>${ISSUE_NAME[k] || k}</span><span style="margin-left:auto" class="muted">${fmtDur(v)}</span></div><div class="bar"><i class="${i === 0 ? 'w' : 'c'}" style="width:${Math.max(3, (v / maxI) * 100)}%"></i></div></div>`).join('') : '<div class="muted">아직 기록이 없어요</div>'}</div>
        <div class="card"><div class="row" style="margin-bottom:12px"><h3>${unit === 'week' ? '요일 · 시간대' : '시간대'}</h3><b style="margin-left:auto;color:var(--warn);font-size:13.5px">${heatTitle}</b></div>
          <div class="heat">${heatRows}<span></span>${hrs.map((h) => `<span style="text-align:center">${h % 3 === 0 ? h + '시' : ''}</span>`).join('')}</div></div>
      </div>`;
    main.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => { unit = b.dataset.u; offset = 0; draw(); }));
    $('#prev', main).onclick = () => { offset--; draw(); };
    $('#next', main).onclick = () => { if (offset < 0) { offset++; draw(); } };
  };
  draw();
  setPage({ refresh: draw });
}

// ---------- S5 스트레칭 ----------
function pageStretch(main, id) {
  const st = id && S.byId(id);
  if (!st) {
    const recs = S.recommend(dayOf(new Date()).issues, 5);
    main.innerHTML = `<h1>스트레칭</h1><div class="muted">오늘 많았던 자세 문제 순서로 보여 드려요. ${D.settings.mode === 'basic' ? '기본 모드에서는 타이머만 흘러요.' : '카메라가 동작을 확인해야 타이머가 흘러요.'}</div>
      <div class="st-list">${recs.map((s) => `<div class="card st-card"><div class="pic">${critter(s.pose, { tint: 'none' })}</div><b>${s.name}</b><div class="small muted">${s.forText} · ${s.steps.length}동작 · ${S.duration(s)}초</div><button class="primary" data-go="stretch/${s.id}">시작</button></div>`).join('')}</div>`;
    main.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { location.hash = b.dataset.go; }));
    return;
  }
  const useCam = D.settings.mode !== 'basic';
  let stepI = 0, held = 0, lastT = Date.now(), done = false;
  main.innerHTML = `
    <div class="row"><a href="#home" class="muted" style="text-decoration:none">← 홈</a><div style="margin:0 auto;text-align:center"><h2>${st.name}</h2><div class="muted small" id="st-sub"></div></div><button class="ghost" id="skip">건너뛰기</button></div>
    <div class="follow">
      <div class="demo"><div class="art" id="st-art">${critter(st.pose, { tint: 'none' })}</div><div class="pill" id="st-text"></div></div>
      <div class="cam" id="st-cam" style="height:430px"><span class="tag">내 카메라</span><span class="ok-badge no" id="st-ok">${useCam ? '동작을 보여 주세요' : '타이머'}</span>
        <div class="ring"><svg viewBox="0 0 100 100" width="100%" height="100%"><circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="7"/><circle id="st-ring" cx="50" cy="50" r="44" fill="none" stroke="oklch(0.8 0.15 155)" stroke-width="7" stroke-linecap="round" stroke-dasharray="276.5" stroke-dashoffset="276.5" transform="rotate(-90 50 50)"/></svg><div class="num"><span id="st-num">0</span><small id="st-hold"></small></div></div></div>
    </div>
    <div class="steps" id="st-steps"></div>`;
  if (useCam) mountPreview($('#st-cam'));
  const draw = () => {
    if (done) return;
    const s = st.steps[stepI];
    const now = Date.now(), dt = (now - lastT) / 1000; lastT = now;
    const rel = LIVE.posture && LIVE.posture.rel;
    const ok = !useCam || !s.check || (rel && s.check(rel));
    if (ok) held += dt;
    $('#st-sub').textContent = `${st.forText} · ${stepI + 1} / ${st.steps.length} 동작`;
    $('#st-text').textContent = s.text;
    $('#st-num').textContent = Math.min(s.hold, Math.floor(held));
    $('#st-hold').textContent = `/ ${s.hold}초 유지`;
    $('#st-ring').setAttribute('stroke-dashoffset', 276.5 * (1 - Math.min(1, held / s.hold)));
    const badge = $('#st-ok');
    if (useCam && s.check) { badge.className = `ok-badge ${ok ? '' : 'no'}`; badge.textContent = ok ? '✓ 동작 인식됨' : (rel ? s.hint : '기준 자세가 필요해요'); }
    $('#st-steps').innerHTML = st.steps.map((_, i) => `<i class="${i <= stepI ? 'on' : ''}"></i>`).join('');
    if (held >= s.hold) {
      stepI++; held = 0;
      if (stepI >= st.steps.length) {
        done = true; B.send('stretch-done', st.id); stopPreview();
        main.innerHTML = `<div class="card" style="text-align:center;padding:50px"><div style="width:180px;height:180px;margin:0 auto">${critter('praise')}</div><h2 style="margin-top:12px">${st.name} 완료!</h2><div class="muted" style="margin:8px 0 18px">잘했어요. 자세가 한결 가벼워졌을 거예요.</div><button class="primary" onclick="location.hash='home'">홈으로</button></div>`;
      }
    }
  };
  $('#skip').onclick = () => { held = st.steps[stepI].hold; draw(); };
  const timer = setInterval(() => { if (!document.getElementById('st-num') && !done) return clearInterval(timer); draw(); }, 200);
  draw();
  setPage({});
}

// ---------- S6 설정 ----------
function pageSettings(main, tab = 'widget') {
  const s = D.settings;
  const set = async (patch) => { D.settings = await B.invoke('set-settings', patch); pageSettings(main, tab); };
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, t]) => `<button data-k="${key}" data-v="${v}" class="${String(s[key]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const tog = (key) => `<button class="toggle ${s[key] ? 'on' : ''}" data-t="${key}"></button>`;
  const item = (label, sub, ctl) => `<div class="item"><div class="label"><b>${label}</b>${sub ? `<span>${sub}</span>` : ''}</div>${ctl}</div>`;
  const tabs = [['widget', '위젯·캐릭터'], ['detect', '감지·모드'], ['focus', '집중 교정 모드'], ['notify', '알림·예약'], ['privacy', '프라이버시']];
  let pane = '';
  if (tab === 'widget') {
    pane = `<h3>캐릭터</h3><div class="animals">${C.ANIMALS.map(([k, n]) => {
      const u = D.unlocks[k];
      const sel = s.animal === k;
      return `<button class="animal ${sel ? 'sel' : ''} ${u.owned ? '' : 'locked'}" data-animal="${k}" ${u.owned ? '' : 'disabled'}><div class="pic">${C.critterSVG(k, 'good', { still: !sel })}</div><b>${n}</b><span class="small muted">${sel ? '사용 중' : u.owned ? '보유' : u.text}</span><div class="bar"><i style="width:${(u.owned ? 1 : u.progress) * 100}%"></i></div></button>`;
    }).join('')}</div><h3>표시</h3>
      ${WEB ? item('작은 위젯 창', '크롬·엣지에서는 다른 앱 위에 항상 떠 있는 작은 창으로 캐릭터를 띄울 수 있어요', `<button id="pip">${'documentPictureInPicture' in window ? '위젯 창 띄우기' : '이 브라우저는 지원 안 함'}</button>`) : `
      ${item('표시 방식', '', seg('display', [['desktop', '데스크톱 위젯'], ['menubar', D.platform === 'darwin' ? '메뉴바' : '트레이'], ['both', '둘 다']]))}
      ${item('위젯 크기', '', seg('widgetSize', [['small', '작게'], ['medium', '보통'], ['large', '크게']]))}
      ${item('클릭 통과', '위젯 뒤의 창을 클릭할 수 있어요. 켜면 위젯을 옮길 수 없어요', tog('clickThrough'))}
      ${item('전체 화면·화상회의 중 숨기기', '초안: 메뉴바의 "회의 중"으로 직접 멈춰요. 자동 감지는 다음 버전', tog('hideInMeetings'))}
      ${item('모든 데스크톱에서 보이기', '항상 위에 표시돼요', tog('allSpaces'))}`}`;
  } else if (tab === 'detect') {
    const devs = LIVE.devices || [];
    pane = `${item('모드', '', seg('mode', [['basic', '기본'], ['webcam', '웹캠'], ['precise', '정밀']]))}
      ${item('카메라', '맥에서는 아이폰 연속성 카메라보다 내장 카메라를 먼저 골라요', `<select id="cam"><option value="">자동 선택</option>${devs.map((d) => `<option value="${esc(d.id)}" ${d.id === s.cameraId ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select>`)}
      ${item('경고 민감도', '나쁜 자세가 이 시간 이상 계속되면 위젯이 노랗게 바뀌어요', seg('sensitivity', [['fast', '빠르게 2초'], ['normal', '보통 3초'], ['relaxed', '느긋하게 5초']]))}
      ${item('오래 앉음 알림', '이 시간 넘게 계속 앉아 있으면 쉬자고 알려요', `<select id="sit">${[30, 40, 50, 60, 90].map((m) => `<option ${m === s.sitReminderMin ? 'selected' : ''} value="${m}">${m}분</option>`).join('')}</select>`)}
      ${item('기준 자세', D.baseline ? `저장됨 · ${new Date(D.baseline.saved).toLocaleString('ko-KR')} · ${esc(D.baseline.camera)}` : '아직 없어요', `<button id="recal">다시 측정</button>`)}`;
  } else if (tab === 'focus') {
    pane = `<div class="card" style="background:var(--caution-soft);border:0;margin-bottom:8px"><b>집중 교정 모드란?</b><div class="small" style="margin-top:6px;line-height:1.6">나쁜 자세가 오래 계속되면 화면 전체를 덮어 바르게 앉도록 해요. 카메라로 바른 자세 3초를 확인한 뒤 "바른 자세로 앉자"를 입력하면 풀려요. 판정 확신도가 높을 때만 뜨고, 하루 ${s.emergencyPerDay}번은 바로 넘길 수 있어요(오늘 ${D.emergencyLeft}번 남음).</div></div>
      ${item('집중 교정 모드', '기본은 꺼져 있어요', tog('focusMode'))}
      ${item('교정 유도 화면까지', '나쁜 자세가 이만큼 계속되면', `<select id="lockAfter">${[[180, '3분'], [300, '5분'], [600, '10분']].map(([v, t]) => `<option value="${v}" ${v === s.lockAfterSec ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
      ${item('화면 흐려짐', '알림 뒤에도 계속되면 화면이 서서히 어두워져요. 고치면 바로 돌아와요', tog('dimEnabled'))}
      ${item('흐려지기 시작', '', `<select id="dimAfter">${[[30, '30초'], [60, '1분'], [120, '2분']].map(([v, t]) => `<option value="${v}" ${v === s.dimAfterSec ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}`;
  } else if (tab === 'notify') {
    const sc = s.schedule || {};
    pane = `${item('부위별 알림', `나쁜 자세가 ${R.WARN_SEC}초 이상 계속되면 한 문장으로 알려요`, tog('notify'))}
      ${item('업무 시간에만 켜기', '이 시간 밖에서는 분석을 멈춰요', `<button class="toggle ${sc.enabled ? 'on' : ''}" id="sch"></button>`)}
      ${item('시작 · 끝', '', `<div class="row"><input type="time" id="sch-s" value="${sc.start || '09:00'}"><span>~</span><input type="time" id="sch-e" value="${sc.end || '18:00'}"></div>`)}`;
  } else if (tab === 'privacy') {
    pane = `<div class="card" style="background:var(--green-soft);border:0"><b>영상은 저장·전송되지 않아요</b><div class="small" style="margin-top:6px;line-height:1.6">카메라 영상은 이 컴퓨터 안에서만 분석하고, 각도와 상태 같은 숫자만 기록해요. 일시정지하면 카메라도 꺼져요.</div></div>
      ${item('카메라 미리보기', '앱이 무엇을 보는지 확인해요', '<button id="pv">미리보기 켜기</button>')}
      <div class="cam" id="pv-cam" style="height:300px;display:none;margin:10px 0"><span class="tag">미리보기 (좌우 반전)</span></div>
      ${item('기록 위치', WEB ? '이 브라우저에만 저장돼요. 브라우저 데이터를 지우면 기록도 지워져요' : '이 컴퓨터에만 저장돼요', `<span class="small muted">${WEB ? '브라우저 저장소' : '앱 데이터 폴더 · barun-data.json'}</span>`)}`;
  }
  main.innerHTML = `<h1>설정</h1><div class="set"><nav class="tabs">${tabs.map(([k, n]) => `<a href="#settings/${k}" class="${k === tab ? 'on' : ''}">${n}</a>`).join('')}</nav><section class="pane">${pane}</section></div>`;
  main.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => set({ [b.dataset.k]: b.dataset.v })));
  main.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => set({ [b.dataset.t]: !s[b.dataset.t] })));
  main.querySelectorAll('[data-animal]').forEach((b) => (b.onclick = () => set({ animal: b.dataset.animal })));
  const on = (sel, ev, fn) => { const el = $(sel, main); if (el) el[ev] = fn; };
  on('#cam', 'onchange', (e) => { const d = (LIVE.devices || []).find((x) => x.id === e.target.value); set({ cameraId: e.target.value, cameraLabel: d ? d.label : '' }); });
  on('#sit', 'onchange', (e) => set({ sitReminderMin: Number(e.target.value) }));
  on('#recal', 'onclick', () => { location.hash = 'onboard-calib'; });
  on('#lockAfter', 'onchange', (e) => set({ lockAfterSec: Number(e.target.value) }));
  on('#dimAfter', 'onchange', (e) => set({ dimAfterSec: Number(e.target.value) }));
  on('#sch', 'onclick', () => set({ schedule: { ...(s.schedule || {}), enabled: !(s.schedule || {}).enabled } }));
  on('#sch-s', 'onchange', (e) => set({ schedule: { ...(s.schedule || {}), start: e.target.value } }));
  on('#sch-e', 'onchange', (e) => set({ schedule: { ...(s.schedule || {}), end: e.target.value } }));
  on('#pip', 'onclick', () => B.send('web-pip'));
  on('#pv', 'onclick', () => { const c = $('#pv-cam', main); c.style.display = 'block'; mountPreview(c); });
  setPage({});
}

// ---------- S1 온보딩: 모드 선택 ----------
function pageOnboardMode() {
  let sel = D.settings.mode || 'webcam';
  const modes = [
    ['basic', '기본 모드', '카메라 없이, 오래 작업할 때 자세 그림을 골라 스스로 체크해요.', ['카메라 끔', '설치 없음'], '셀프 체크'],
    ['webcam', '웹캠 모드', '노트북 내장·모니터 위 웹캠으로 실시간 분석해요.', ['고개 기울임', '어깨 불균형', '턱 괴기', '자리 비움', '거북목 (추정)'], '정면 웹캠'],
    ['precise', '정밀 모드', '측면에 휴대폰·USB 웹캠을 두면 거북목 각도를 직접 재요.', ['거북목 각도', '등 굽음', '고개 숙임', '거치대 필요'], '측면 45° 거치'],
  ];
  const draw = () => {
    app.innerHTML = `<div class="onb"><div><div class="step">1 / 3 단계</div><h1 style="font-size:34px;margin-top:6px">자세를 어떻게 볼까요?</h1><div class="muted" style="margin-top:6px">언제든 설정에서 바꿀 수 있어요.</div></div>
      <div class="modes">${modes.map(([k, n, d, chips, pic]) => `<button class="mode ${sel === k ? 'sel' : ''}" data-m="${k}"><div class="pic">${critter(k === 'basic' ? 'good' : k === 'webcam' ? 'tilt' : 'turtle', { tint: 'none', still: true })}<span>${pic}</span></div>
        <h3>${n}${k === 'webcam' ? '<span class="chip" style="background:var(--green);color:#fff">추천</span>' : ''}</h3><div class="muted">${d}</div><div class="chips">${chips.map((c) => `<span class="chip ${k === 'basic' || c.includes('필요') ? 'gray' : ''}">${c}</span>`).join('')}</div></button>`).join('')}</div>
      <div class="onb-foot"><span class="muted"><span class="dot"></span> 영상은 저장·전송되지 않아요. 기기 안에서 분석하고 각도와 상태만 기록해요.</span><button class="primary" id="next" style="padding:12px 26px">${modes.find((m) => m[0] === sel)[1]}로 계속</button></div></div>`;
    app.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { sel = b.dataset.m; draw(); }));
    $('#next').onclick = async () => {
      D.settings = await B.invoke('set-settings', { mode: sel });
      location.hash = sel === 'basic' ? 'onboard-done' : 'onboard-calib';
    };
  };
  draw();
}

// ---------- S2 온보딩: 개인 자세 채증 ----------
function pageCalib() {
  const side = D.settings.mode === 'precise';
  app.innerHTML = `<div class="onb"><div class="calib">
      <div class="cam" id="cal-cam"><span class="tag">웹캠 미리보기 (좌우 반전)</span><span class="badge" id="cal-badge">${side ? '측면' : '정면'}</span>
        <svg class="silhouette" viewBox="0 0 100 100" preserveAspectRatio="none"><ellipse cx="50" cy="42" rx="11" ry="15" fill="none" stroke="oklch(0.85 0.12 160)" stroke-width=".5" stroke-dasharray="1.5 1.2"/><path d="M18 100 Q20 62 50 60 Q80 62 82 100" fill="none" stroke="oklch(0.85 0.12 160)" stroke-width=".5" stroke-dasharray="1.5 1.2"/></svg>
        <canvas id="cal-lm"></canvas><div class="toast" id="cal-toast" style="display:none"></div></div>
      <div style="display:flex;flex-direction:column"><div class="step">2 / 3 단계</div><h1 style="margin:6px 0 8px">평소 바른 자세를<br>기억할게요</h1>
        <div class="muted" style="line-height:1.6">이 자세를 기준으로 얼마나 달라졌는지 판단해요. 체형이 달라도 정확해져요.${side ? ' 정밀 모드는 몸이 옆으로 보이게 앉아 주세요.' : ''}</div>
        <div style="margin-top:18px" id="cal-checks"></div>
        <div class="bar" style="margin-top:22px"><i id="cal-bar" style="width:0%"></i></div><div class="small muted" style="margin-top:8px" id="cal-left">준비되면 자동으로 시작해요 · 움직임이 크면 처음부터 다시 해요</div>
        <div class="row" style="margin-top:auto;padding-top:24px"><button id="cal-retry" style="flex:1">다시 하기</button><button id="cal-done" class="primary" style="flex:1" disabled>완료 후 계속</button></div></div>
    </div></div>`;
  mountPreview($('#cal-cam'));
  let started = false, startedAt = 0, readySince = 0, result = null;
  const start = () => { started = true; startedAt = Date.now(); result = null; B.send('calibrate'); };
  $('#cal-retry').onclick = start;
  $('#cal-done').onclick = () => { location.hash = D.settings.animal && localStorage.getItem('onboarded') ? 'home' : 'onboard-done'; };
  const ic = (state) => `<span class="ic ${state === true ? 'ok' : state === 'warn' ? 'warn' : ''}">${state === true ? '✓' : state === 'warn' ? '!' : ''}</span>`;
  const update = () => {
    const p = LIVE.posture || {};
    const c = p.checks || {};
    drawLandmarks($('#cal-lm'));
    const dist = c.distance === 'ok' ? true : c.distance === 'near' || c.distance === 'far' ? 'warn' : false;
    const steady = p.calibrating ? (p.calibrating.rewinds ? 'warn' : c.steady || false) : result && result.ok;
    $('#cal-checks').innerHTML = [
      [c.lightOk ?? false, '조명이 충분해요', c.lightOk === false ? '조금 어두워요' : ''],
      [c.shoulders || false, side ? '몸이 보여요' : '양쪽 어깨가 보여요', ''],
      [side ? true : dist, '화면과 거리', c.distance === 'near' ? '조금 가까워요' : c.distance === 'far' ? '조금 멀어요' : ''],
      [steady, '움직이지 않고 유지', p.calibrating && p.calibrating.rewinds ? '움직여서 다시 시작했어요' : ''],
    ].map(([st, t, v]) => `<div class="check">${ic(st)}<span>${t}</span><span class="val">${v}</span></div>`).join('');
    const toast = $('#cal-toast');
    const tip = c.distance === 'near' ? '조금 더 뒤로 앉아주세요' : c.distance === 'far' ? '조금 더 가까이 앉아주세요' : !c.shoulders && p.present !== undefined ? '얼굴과 양 어깨가 보이게 앉아주세요' : '';
    toast.style.display = tip && !result ? 'block' : 'none'; toast.textContent = tip;
    if (p.calibrating) {
      $('#cal-bar').style.width = `${p.calibrating.progress * 100}%`;
      $('#cal-left').textContent = `${Math.ceil(p.calibrating.left)}초 남음 · 움직임이 크면 처음부터 다시 해요`;
      $('#cal-badge').textContent = `${side ? '측면' : '정면'} · ${Math.min(R.CAL_SEC, Math.floor(R.CAL_SEC - p.calibrating.left))} / ${R.CAL_SEC}초`;
    }
    const cal = LIVE.lastCalibrated;
    if (cal && started && cal.t >= startedAt) {
      result = cal; started = false;
      $('#cal-left').textContent = result.msg;
      $('#cal-bar').style.width = result.ok ? '100%' : '0%';
      $('#cal-done').disabled = !result.ok;
    }
    // 준비(조명·어깨·거리)가 1초 이상 맞으면 자동 시작
    const ready = c.lightOk && c.shoulders && (side || c.distance === 'ok');
    if (!started && !result) { if (ready) { readySince ||= Date.now(); if (Date.now() - readySince > 1000) start(); } else readySince = 0; }
  };
  setPage({ update });
  update();
}

// ---------- 온보딩 3단계: 캐릭터·표시 방식 ----------
function pageOnboardDone() {
  let animal = D.settings.animal || 'meerkat', display = D.settings.display || 'both';
  const draw = () => {
    app.innerHTML = `<div class="onb"><div><div class="step">3 / 3 단계</div><h1 style="font-size:34px;margin-top:6px">함께할 친구를 골라 주세요</h1><div class="muted" style="margin-top:6px">화면 구석에서 내 자세를 따라 해요. 바르게 앉으면 신나게, 자세가 무너지면 같이 무너져요.</div></div>
      <div class="animals" style="grid-template-columns:repeat(3,1fr);max-width:620px">${C.ANIMALS.slice(0, 3).map(([k, n]) => `<button class="animal ${animal === k ? 'sel' : ''}" data-a="${k}"><div class="pic" style="width:110px;height:110px">${C.critterSVG(k, 'good')}</div><b>${n}</b></button>`).join('')}</div>
      <div class="muted small">펭귄·강아지는 바른 자세를 이어가면 열려요.</div>
      ${WEB ? '' : `<div class="row"><span>표시 방식</span><div class="seg">${[['desktop', '데스크톱 위젯'], ['menubar', D.platform === 'darwin' ? '메뉴바' : '트레이'], ['both', '둘 다']].map(([v, t]) => `<button data-d="${v}" class="${display === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>`}
      <div class="onb-foot"><span class="muted">${WEB ? '캐릭터는 화면 오른쪽 아래에 있어요. 크롬·엣지에서는 다른 앱 위에 띄울 수도 있어요.' : '위젯은 잡고 끌어서 원하는 곳에 둘 수 있어요. 클릭하면 메뉴가 열려요.'}</span><button class="primary" id="go" style="padding:12px 26px">시작하기</button></div></div>`;
    app.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => { animal = b.dataset.a; draw(); }));
    app.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { display = b.dataset.d; draw(); }));
    $('#go').onclick = async () => { D.settings = await B.invoke('set-settings', { animal, display }); localStorage.setItem('onboarded', '1'); B.send('onboarding-done'); location.hash = 'home'; };
  };
  draw();
}

render();
