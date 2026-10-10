// 시험용: 리포트(S4)를 미리 볼 수 있게 지난 1주 가짜 기록을 만든다. JASAI_SEED=1 일 때만 쓰인다.
const { today, emptyDay } = require('../store');

module.exports = function seed(store) {
  let r = 7;
  const rand = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const now = new Date();
  for (let back = 13; back >= 1; back--) {
    const d = new Date(now); d.setDate(d.getDate() - back);
    const day = emptyDay();
    const wd = d.getDay();
    if (wd === 0 && rand() < 0.6) continue;   // 일요일은 쉬는 날이 많음
    const lastWeek = back > 6;
    for (let h = 9; h <= 18; h++) {
      if (h === 12) continue;
      // 수요일 오후·늦은 오후에 자세가 무너지는 패턴, 지난주가 조금 더 나쁨
      const badRate = Math.min(0.85, 0.15 + (h >= 14 ? 0.15 : 0) + (wd === 3 && h >= 13 ? 0.3 : 0) + (lastWeek ? 0.08 : 0) + rand() * 0.12);
      const used = 3000 + rand() * 500;
      const bad = used * badRate, good = used - bad;
      const warn = bad * 0.35, caut = bad - warn;
      day.sec.good += good; day.sec.caution += caut; day.sec.warning += warn; day.sec.away += 600 - (used - 3000);
      day.hours[h] = { good, bad, away: 300 };
      for (const [k, w] of [['turtle', lastWeek ? 0.5 : 0.4], ['head_down', 0.2], ['tilt', 0.15], ['chin', 0.1], ['lean', 0.08], ['shrug', 0.07]]) day.issues[k] = (day.issues[k] || 0) + bad * w;
      for (let m = 0; m < 60; m += 10) {
        const s = rand() < badRate ? (rand() < 0.35 ? 'warning' : 'caution') : 'good';
        day.tl[`${String(h).padStart(2, '0')}:${m / 10}0`] = { good: 0, caution: 0, warning: 0, away: 0, [s]: 600 };
      }
    }
    day.locks = rand() < 0.3 ? 1 : 0; day.lockReleaseSec = day.locks * (30 + rand() * 30);
    day.stretchRec = 2 + Math.floor(rand() * 2); day.stretchDone = Math.floor(day.stretchRec * (0.4 + rand() * 0.5));
    store.data.days[today(d)] = day;
  }
  store.save(true);
};
