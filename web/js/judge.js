// 개인 기준선(보정) + 자세 판정 + 지속 시간 상태 머신
import { FEATURE_NAMES } from "./features.js";

export const PARTS = ["head", "neck", "shoulder", "torso", "arm"];
export const PART_LABELS = { head: "머리", neck: "목", shoulder: "어깨", torso: "상체", arm: "팔" };

// 기준선 대비 얼마나 달라지면 "문제"로 볼지. 직접 모은 데이터로 튜닝할 값들이다.
export const THRESHOLDS = {
  turtleFaceRatio: 1.1,  // 어깨 대비 얼굴 크기가 기준보다 10% 이상 커짐
  tooClose: 1.25,        // 얼굴이 기준보다 25% 이상 커짐 (몸 전체가 다가옴)
  tooCloseBody: 1.15,
  headDown: 0.15,        // headPitch 증가량
  headRollDeg: 8,
  shoulderTiltDeg: 5,
  shrugRatio: 0.82,      // 귀-어깨 거리가 기준의 82% 미만
  headShift: 0.2,
  chinRest: 0.35,
};

const BASELINE_KEY = "barun.baseline";

export class Baseline {
  constructor(values = null) {
    this.values = values;
  }
  get ready() {
    return this.values !== null;
  }
  static fromSamples(samples) {
    const values = {};
    for (const name of FEATURE_NAMES) {
      const xs = samples.map((s) => s[name]);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      const std = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
      values[name] = { mean, std };
    }
    return new Baseline(values);
  }
  mean(name) {
    return this.values[name].mean;
  }
  save() {
    try {
      localStorage.setItem(BASELINE_KEY, JSON.stringify(this.values));
    } catch {}
  }
  static load() {
    try {
      const raw = localStorage.getItem(BASELINE_KEY);
      return raw ? new Baseline(JSON.parse(raw)) : new Baseline();
    } catch {
      return new Baseline();
    }
  }
}

const side = (v) => (v > 0 ? "오른쪽" : "왼쪽");

// 현재 프레임에서 발견된 문제 목록. key 는 지속 시간 추적용, part 는 캐릭터 색칠용.
export function detectIssues(f, base, t = THRESHOLDS) {
  const issues = [];
  const add = (part, key, message) => issues.push({ part, key, message });

  const faceRel = f.faceRatio / base.mean("faceRatio");
  const closeRel = f.earDistance / base.mean("earDistance");
  const bodyRel = f.shoulderWidth / base.mean("shoulderWidth");
  const pitchDiff = f.headPitch - base.mean("headPitch");
  const rollDiff = f.headRoll - base.mean("headRoll");
  const tiltDiff = f.shoulderTilt - base.mean("shoulderTilt");
  const shiftDiff = f.headShift - base.mean("headShift");
  const neckRel = f.neckHeight / base.mean("neckHeight");

  // 거북목: 얼굴만 커지고 어깨는 그대로 → 머리만 앞으로 나옴
  const turtle = faceRel > t.turtleFaceRatio;
  if (turtle) add("neck", "turtle", "목이 앞으로 나와 있어요");
  else if (closeRel > t.tooClose && bodyRel > t.tooCloseBody)
    add("head", "tooClose", "화면에 너무 가까워요");

  const headDown = pitchDiff > t.headDown;
  if (headDown) add("neck", "headDown", "고개를 많이 숙이고 있어요");

  if (Math.abs(rollDiff) > t.headRollDeg)
    add("head", "headRoll", `고개가 ${side(rollDiff)}으로 기울어져 있어요`);

  if (Math.abs(tiltDiff) > t.shoulderTiltDeg)
    add("shoulder", "shoulderTilt", `${side(tiltDiff)} 어깨가 내려가 있어요`);
  else if (neckRel < t.shrugRatio && !turtle && !headDown)
    add("shoulder", "shrug", "어깨가 올라가 있어요. 힘을 빼 보세요");

  if (Math.abs(shiftDiff) > t.headShift)
    add("torso", "lean", `몸이 ${side(shiftDiff)}으로 기울어져 있어요`);

  if (f.chinRest < t.chinRest) add("arm", "chinRest", "턱을 괴고 있어요");

  return issues;
}

// 문제가 잠깐 나타났다 사라지는 건 무시하고, 계속될 때만 주의 → 경고로 올린다.
export class PostureTracker {
  constructor({ cautionSec = 1.5, warningSec = 10 } = {}) {
    this.cautionSec = cautionSec;
    this.warningSec = warningSec;
    this.since = new Map(); // issue key → 시작 시각(ms)
  }
  update(issues, now) {
    const active = new Set(issues.map((i) => i.key));
    for (const key of [...this.since.keys()]) if (!active.has(key)) this.since.delete(key);
    for (const key of active) if (!this.since.has(key)) this.since.set(key, now);

    const parts = Object.fromEntries(PARTS.map((p) => [p, { state: "normal", message: null, duration: 0 }]));
    for (const issue of issues) {
      const duration = (now - this.since.get(issue.key)) / 1000;
      const state = duration >= this.warningSec ? "warning" : duration >= this.cautionSec ? "caution" : "normal";
      const cur = parts[issue.part];
      if (state !== "normal" && duration > cur.duration) {
        parts[issue.part] = { state, message: issue.message, duration, key: issue.key };
      }
    }
    return parts;
  }
  reset() {
    this.since.clear();
  }
}
