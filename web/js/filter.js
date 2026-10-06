// One Euro Filter: 가만히 있을 땐 떨림을 강하게 줄이고, 빠르게 움직일 땐 지연을 줄인다.
// https://gery.casiez.net/1euro/
class LowPass {
  constructor() {
    this.y = null;
  }
  filter(x, alpha) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
}

const alphaOf = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuroFilter {
  constructor(minCutoff = 1.0, beta = 0.3, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastTime = null;
    this.lastRaw = null;
  }
  filter(value, timeMs) {
    if (this.lastTime === null) {
      this.lastTime = timeMs;
      this.lastRaw = value;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }
    const dt = Math.max((timeMs - this.lastTime) / 1000, 1e-3);
    this.lastTime = timeMs;
    const dValue = (value - this.lastRaw) / dt;
    this.lastRaw = value;
    const edx = this.dx.filter(dValue, alphaOf(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, alphaOf(cutoff, dt));
  }
}

// 관절 33개 × (x, y)에 각각 필터 적용
export class LandmarkSmoother {
  constructor() {
    this.filters = [];
  }
  smooth(landmarks, timeMs) {
    return landmarks.map((p, i) => {
      if (!this.filters[i]) this.filters[i] = [new OneEuroFilter(), new OneEuroFilter()];
      const [fx, fy] = this.filters[i];
      return { ...p, x: fx.filter(p.x, timeMs), y: fy.filter(p.y, timeMs) };
    });
  }
  reset() {
    this.filters = [];
  }
}
