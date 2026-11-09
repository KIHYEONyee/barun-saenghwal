// 자세 판정 규칙. scripts/front_rules.py, scripts/posture_rules.py 를 그대로 옮긴 것.
// 파이썬과 결과가 같아야 한다: 고치면 양쪽을 같이 고치고 `npm test`(test/parity)로 확인한다.
// 방향(오른쪽/왼쪽)은 거울 모드 화면 기준. 거울처럼 화면 오른쪽 = 사용자 오른쪽.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN_VIS = 0.5;
  const EAR_VIS = 0.3;
  const NEED = [0, 11, 12];
  const HAND = [15, 16, 17, 18, 19, 20, 21, 22];
  const METRICS = ['shoulder_w', 'ear_d', 'face_ratio', 'neck_h', 'head_pitch', 'head_roll', 'shoulder_tilt',
    'head_shift', 'chin_rest', 'shoulder_y', 'nose_y'];
  const BASELINE_VERSION = 2;

  const TH = {
    turtle: 1.10, close: 1.25, close_body: 1.15, head_down: 0.15,
    roll: 10.0, tilt: 6.0, shrug: 0.82, shift: 0.20, chin: 0.35,
    slouch: null,   // 파이썬과 같이 꺼둠(MultiPosture에서 오탐만 늘어남)
  };
  const CAUTION_SEC = 3.0;   // 팀 결정: 3초 이상 계속되면 경고
  const WARN_SEC = 10.0;     // 10초 이상이면 빨강 + 알림
  const K_STD = 3.0;
  const CAL_SEC = 10.0;     // 기준 자세 측정 시간(팀 결정: 10초)

  const deg = (r) => (r * 180) / Math.PI;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  // lm: [[x, y, z, visibility] x 33] 정규화 좌표
  function metrics(lm, w, h) {
    if (Math.min(...NEED.map((i) => lm[i][3])) < MIN_VIS || Math.min(lm[7][3], lm[8][3]) < EAR_VIS) return null;
    const P = lm.map((p) => [p[0] * w, p[1] * h]);
    const byX = (i, j) => (P[i][0] <= P[j][0] ? [P[i], P[j]] : [P[j], P[i]]);
    const [sL, sR] = byX(11, 12);
    const [eL, eR] = byX(7, 8);
    const sw = dist(sL, sR), ed = dist(eL, eR);
    if (sw < 1 || ed < 1) return null;
    const smid = mid(sL, sR), emid = mid(eL, eR), nose = P[0], mouth = mid(P[9], P[10]);
    const chin = [mouth[0] + 0.6 * (mouth[0] - nose[0]), mouth[1] + 0.6 * (mouth[1] - nose[1])];
    const hands = HAND.filter((i) => lm[i][3] > MIN_VIS).map((i) => P[i]);
    return {
      shoulder_w: sw,
      ear_d: ed,
      face_ratio: ed / sw,
      neck_h: (smid[1] - emid[1]) / sw,
      head_pitch: (nose[1] - emid[1]) / ed,
      head_roll: deg(Math.atan2(eR[1] - eL[1], eR[0] - eL[0])),
      shoulder_tilt: deg(Math.atan2(sR[1] - sL[1], sR[0] - sL[0])),
      head_shift: (nose[0] - smid[0]) / sw,
      chin_rest: hands.length ? Math.min(...hands.map((p) => dist(p, chin))) / sw : 9.0,
      shoulder_y: smid[1],
      nose_y: nose[1],
    };
  }

  function makeBaseline(samples) {
    if (samples.length < 15) {
      return { base: null, msg: `측정된 프레임이 ${samples.length}개뿐이에요. 얼굴과 어깨가 화면에 보이게 앉아 다시 측정해 주세요.`, reason: 'few' };
    }
    const mean = {}, std = {};
    for (const k of METRICS) {
      const xs = samples.map((s) => s[k]);
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      mean[k] = m;
      std[k] = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    }
    const base = { ...mean, _std: std };
    if (base.face_ratio < 0.25) return { base: null, msg: '몸이 옆으로 돌아가 있어요. 카메라 정면을 보고 다시 측정해 주세요.', reason: 'turned' };
    if (std.head_roll > 3 || std.shoulder_w / mean.shoulder_w > 0.06) {
      return { base: null, msg: '측정 중에 많이 움직였어요. 가만히 바르게 앉아 다시 측정해 주세요.', reason: 'moved' };
    }
    return { base, msg: `기준 자세 저장 (${samples.length}프레임)`, reason: 'ok' };
  }

  // 반환: [{part, key, ko, en, sev, dir}]. sev = 문턱값 대비 몇 배(1.0 = 딱 문턱값)
  function detectIssues(m, base, t = TH, kStd = K_STD) {
    const sd = base._std || {};
    const lim = (name, thr) => Math.max(thr, kStd * (sd[name] || 0));
    const rlim = (name, thr) => Math.max(thr, (kStd * (sd[name] || 0)) / Math.abs(base[name] || 1.0));
    const side = (v) => (v > 0 ? '오른쪽' : '왼쪽');
    const eng = (v) => (v > 0 ? 'R' : 'L');
    const sev = (v, l) => (l > 0 ? Math.abs(v) / l : 1.0);
    const out = [];
    const add = (part, key, ko, en, s, dir = 0) => out.push({ part, key, ko, en, sev: s, dir });

    const faceRel = m.face_ratio / base.face_ratio;
    const closeRel = m.ear_d / base.ear_d;
    const bodyRel = m.shoulder_w / base.shoulder_w;
    const neckRel = base.neck_h > 0 ? m.neck_h / base.neck_h : 1.0;
    const roll = m.head_roll - base.head_roll;
    const tilt = m.shoulder_tilt - base.shoulder_tilt;
    const shift = m.head_shift - base.head_shift;
    const sw0 = base.shoulder_w || 1.0;
    const dropSh = (m.shoulder_y - base.shoulder_y) / sw0;
    const dropNose = (m.nose_y - base.nose_y) / sw0;

    const lTurtle = rlim('face_ratio', t.turtle - 1);
    const turtle = faceRel - 1 > lTurtle;
    if (turtle) add('neck', 'turtle', '목이 앞으로 나와 있어요', 'TURTLE NECK', sev(faceRel - 1, lTurtle));
    else if (closeRel - 1 > rlim('ear_d', t.close - 1) && bodyRel - 1 > rlim('shoulder_w', t.close_body - 1)) {
      add('head', 'close', '화면에 너무 가까워요', 'TOO CLOSE', sev(closeRel - 1, rlim('ear_d', t.close - 1)));
    }
    let slouch = false;
    if (t.slouch !== null && t.slouch !== undefined) {
      const lSlouch = lim('shoulder_y', t.slouch * sw0) / sw0;
      slouch = dropSh > lSlouch && dropNose > lSlouch;
      if (slouch) add('torso', 'slouch', '등이 구부정해요. 허리를 펴 보세요', 'SLOUCH', sev(Math.min(dropSh, dropNose), lSlouch));
    }
    const lDown = lim('head_pitch', t.head_down);
    const headDown = m.head_pitch - base.head_pitch > lDown;
    if (headDown) add('neck', 'head_down', '고개를 숙이고 있어요', 'HEAD DOWN', sev(m.head_pitch - base.head_pitch, lDown));
    const lRoll = lim('head_roll', t.roll);
    if (Math.abs(roll) > lRoll) add('head', 'roll', `고개가 ${side(roll)}으로 기울어져 있어요`, `HEAD TILT ${eng(roll)}`, sev(roll, lRoll), Math.sign(roll));
    const lTilt = lim('shoulder_tilt', t.tilt), lShrug = rlim('neck_h', 1 - t.shrug);
    if (Math.abs(tilt) > lTilt) add('shoulder', 'tilt', `${side(tilt)} 어깨가 내려가 있어요`, `SHOULDER ${eng(tilt)} DOWN`, sev(tilt, lTilt), Math.sign(tilt));
    else if (1 - neckRel > lShrug && !turtle && !headDown && !slouch) add('shoulder', 'shrug', '어깨가 올라가 있어요. 힘을 빼 보세요', 'SHRUG', sev(1 - neckRel, lShrug));
    const lShift = lim('head_shift', t.shift);
    if (Math.abs(shift) > lShift) add('torso', 'lean', `몸이 ${side(shift)}으로 기울어져 있어요`, `LEAN ${eng(shift)}`, sev(shift, lShift), Math.sign(shift));
    if (m.chin_rest < t.chin) add('arm', 'chin', '턱을 괴고 있어요', 'CHIN REST', t.chin / Math.max(m.chin_rest, 1e-6));
    return out;
  }

  function smooth(prev, m, alpha = 0.3) {
    if (!prev) return m;
    const o = {};
    for (const k of Object.keys(m)) o[k] = (1 - alpha) * prev[k] + alpha * m[k];
    return o;
  }

  // 문제가 잠깐 나타났다 사라지는 건 무시하고 계속된 시간을 잰다
  class IssueTracker {
    constructor(cautionSec = CAUTION_SEC) { this.since = new Map(); this.cautionSec = cautionSec; }
    update(issues, now) {
      const keys = new Set(issues.map((i) => i.key));
      for (const k of [...this.since.keys()]) if (!keys.has(k)) this.since.delete(k);
      for (const k of keys) if (!this.since.has(k)) this.since.set(k, now);
      return issues
        .map((i) => ({ ...i, dur: (now - this.since.get(i.key)) / 1000 }))
        .filter((i) => i.dur >= this.cautionSec)
        .sort((a, b) => b.dur - a.dur);
    }
    reset() { this.since.clear(); }
  }

  // 측면(정밀 모드) CVA 판정. scripts/posture_rules.py cva() 와 같음
  // ref: 기준 측정 때 잰 내 바른 자세 각도. 없으면 고정 50°. 단계 간격 5°는 고정 기준 50/45/40의 간격과 같다
  const CVA_NORMAL = 50.0, CVA_MILD = 45.0, CVA_SEVERE = 40.0, CVA_STEP = 5.0;
  function cva(lm, w, h, ref) {
    const normal = ref || CVA_NORMAL;
    // 카메라 쪽 귀 고르기: 비스듬히 앉으면 반대쪽 귀는 코 근처에 겹쳐 보이므로, 코에서 가로로 더 먼 귀가 카메라 쪽이다
    // (예전엔 가시성으로 골랐는데, 가려진 귀도 가시성이 높게 나와 엉뚱한 쪽을 고르는 일이 있었다)
    const nose = lm[0];
    const side = Math.abs(lm[7][0] - nose[0]) * w >= Math.abs(lm[8][0] - nose[0]) * w ? 0 : 1;
    const ear = lm[7 + side], sh = lm[11 + side];
    if (Math.min(ear[3], sh[3]) < MIN_VIS) return { angle: null, label: '귀/어깨가 안 보임' };
    const ex = ear[0] * w, ey = ear[1] * h, sx = sh[0] * w, sy = sh[1] * h;
    const facing = nose[0] * w >= ex ? 1 : -1;
    const forward = (ex - sx) * facing;
    const up = sy - ey;
    if (up <= 0) return { angle: null, label: '귀가 어깨보다 아래(정면/고개 숙임)' };
    const angle = deg(Math.atan2(up, forward));
    if (Math.abs(ex - sx) < 0.25 * up && Math.abs(nose[0] * w - ex) < 0.25 * up) return { angle: null, label: '정면에 가까워 측면 판정 불가' };
    const label = angle >= normal ? '정상' : angle >= normal - CVA_STEP ? '경계' : angle >= normal - 2 * CVA_STEP ? '거북목' : '심한 거북목';
    return { angle, label };
  }
  // 측면 모드 문제 목록(정면과 같은 형식)
  function sideIssues(lm, w, h, ref) {
    const r = cva(lm, w, h, ref);
    const mild = (ref || CVA_NORMAL) - CVA_STEP;
    if (r.angle === null || r.angle >= mild) return [];
    return [{ part: 'neck', key: 'turtle', ko: '목이 앞으로 나와 있어요', en: 'TURTLE NECK', sev: mild / Math.max(r.angle, 1), dir: 0 }];
  }

  // 기준 측정 화면(S2) 체크리스트: 어깨 보임, 화면과 거리
  function frameChecks(lm, w, h) {
    if (!lm) return { shoulders: false, distance: 'none', swFrac: 0 };
    const shoulders = lm[11][3] > MIN_VIS && lm[12][3] > MIN_VIS && lm[0][3] > MIN_VIS;
    const swFrac = shoulders ? Math.hypot((lm[11][0] - lm[12][0]) * w, (lm[11][1] - lm[12][1]) * h) / w : 0;
    // 노트북 웹캠에서 어깨가 화면 너비의 25~60%를 차지하면 적당
    const distance = !shoulders ? 'none' : swFrac > 0.6 ? 'near' : swFrac < 0.25 ? 'far' : 'ok';
    return { shoulders, distance, swFrac };
  }

  return { MIN_VIS, HAND, METRICS, BASELINE_VERSION, TH, CAUTION_SEC, WARN_SEC, K_STD, CAL_SEC,
    metrics, makeBaseline, detectIssues, smooth, IssueTracker, cva, sideIssues, frameChecks };
});
