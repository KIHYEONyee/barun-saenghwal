// 관절 좌표 → 자세 특징값
// 방향(오른쪽/왼쪽)은 모두 "사용자 기준"이다. 카메라가 사용자를 마주 보므로 사용자의 오른쪽 = 이미지의 왼쪽.

// MediaPipe Pose 관절 번호
export const LM = {
  NOSE: 0,
  L_EAR: 7, R_EAR: 8,
  MOUTH_L: 9, MOUTH_R: 10,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
};

export const FEATURE_NAMES = [
  "shoulderWidth", // 어깨 너비 (화면 기준, 가까워지면 커짐)
  "earDistance",   // 양 귀 사이 거리 (화면 기준, 가까워지면 커짐)
  "faceRatio",     // 귀 거리 ÷ 어깨 너비 — 머리만 앞으로 나오면 커짐 (거북목 신호)
  "neckHeight",    // 귀-어깨 세로 거리 ÷ 어깨 너비 — 어깨 으쓱·거북목·구부정이면 작아짐
  "headPitch",     // 코가 귀보다 얼마나 아래인가 — 고개를 숙이면 커짐
  "headRoll",      // 고개 좌우 기울기(도), + = 오른쪽으로 기울임
  "shoulderTilt",  // 어깨선 기울기(도), + = 오른쪽 어깨가 낮음
  "headShift",     // 코의 좌우 위치 ÷ 어깨 너비, + = 오른쪽으로 치우침
  "chinRest",      // 손목-입 최소 거리 ÷ 어깨 너비 — 작으면 턱 괴기
];

const VISIBLE = 0.5;
const visible = (p) => p && (p.visibility ?? 1) > VISIBLE;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const deg = (rad) => (rad * 180) / Math.PI;

// aspect = 영상 가로/세로. MediaPipe 좌표는 가로·세로를 각각 0~1로 맞춘 값이라 각도 계산 전에 보정한다.
export function computeFeatures(landmarks, aspect = 4 / 3) {
  if (!landmarks) return null;
  const p = landmarks.map((l) => ({ x: l.x * aspect, y: l.y, visibility: l.visibility }));
  const need = [LM.NOSE, LM.L_EAR, LM.R_EAR, LM.L_SHOULDER, LM.R_SHOULDER];
  if (!need.every((i) => visible(p[i]))) return null;

  const lS = p[LM.L_SHOULDER], rS = p[LM.R_SHOULDER];
  const lE = p[LM.L_EAR], rE = p[LM.R_EAR];
  const nose = p[LM.NOSE];
  const sMid = mid(lS, rS);
  const eMid = mid(lE, rE);
  const mouth = mid(p[LM.MOUTH_L], p[LM.MOUTH_R]);

  const shoulderWidth = dist(lS, rS);
  const earDistance = dist(lE, rE);

  const wrists = [p[LM.L_WRIST], p[LM.R_WRIST]].filter(visible);
  const chinRest = wrists.length
    ? Math.min(...wrists.map((w) => dist(w, mouth))) / shoulderWidth
    : 9; // 손이 안 보이면 "멀리 있음"

  return {
    shoulderWidth,
    earDistance,
    faceRatio: earDistance / shoulderWidth,
    neckHeight: (sMid.y - eMid.y) / shoulderWidth,
    headPitch: (nose.y - eMid.y) / earDistance,
    headRoll: deg(Math.atan2(rE.y - lE.y, Math.abs(lE.x - rE.x))),
    shoulderTilt: deg(Math.atan2(rS.y - lS.y, Math.abs(lS.x - rS.x))),
    headShift: (sMid.x - nose.x) / shoulderWidth,
    chinRest,
  };
}
