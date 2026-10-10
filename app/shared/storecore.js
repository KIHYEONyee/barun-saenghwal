// 설정·기준 자세·자세 기록 저장 로직(앱·웹 공용). 영상은 저장하지 않고 숫자(초 단위 집계)만 남긴다.
// 실제로 어디에 쓰는지는 persist 가 정한다: 앱 = JSON 파일(app/store.js), 웹 = 브라우저 localStorage(webapp)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StoreCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_SETTINGS = {
    mode: null,              // null(첫 실행) | 'basic' | 'webcam' | 'precise'
    animal: 'meerkat',
    display: 'both',         // 'desktop' | 'menubar' | 'both'
    widgetSize: 'medium',    // 'small' | 'medium' | 'large'
    clickThrough: false,
    hideInMeetings: true,    // TODO: 화상회의 감지(초안은 트레이의 '회의 중' 수동 전환만)
    allSpaces: true,
    cameraId: '',
    cameraLabel: '',
    sensitivity: 'normal',   // 'fast'(2초) | 'normal'(3초, 팀 결정) | 'relaxed'(5초)
    sitReminderMin: 50,      // 이만큼 계속 앉아 있으면 쉬자 + 스트레칭 안내
    notify: true,
    dimEnabled: true,        // ③ 화면 흐려짐
    dimAfterSec: 60,
    focusMode: false,        // ④ 교정 유도 화면(집중 교정 모드). 기본 꺼짐
    lockAfterSec: 300,
    lockMinSev: 1.3,         // 판정 심각도가 이 이상일 때만 화면을 덮는다
    emergencyPerDay: 2,
    schedule: { enabled: false, start: '09:00', end: '18:00' },
    widgetPos: null,
  };

  const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function emptyDay() {
    return {
      sec: { good: 0, caution: 0, warning: 0, away: 0, paused: 0 },
      issues: {},      // 문제 키별 초 (caution+warning 동안 가장 오래된 문제 하나만 센다)
      hours: {},       // '9': { good, bad } 요일×시간 히트맵용
      tl: {},          // '09:10': { good, caution, warning, away } 10분 단위 타임라인
      locks: 0, lockReleaseSec: 0, notifies: 0,
      stretchDone: 0, stretchRec: 0, falseReports: 0, selfchecks: [],
    };
  }

  // persist: { load() → 저장된 객체 또는 null, save(obj, now) }
  class StoreCore {
    constructor(persist) {
      this.persist = persist;
      this.data = { settings: { ...DEFAULT_SETTINGS }, baseline: null, days: {}, emergency: { date: '', used: 0 } };
      try {
        const d = persist.load();
        if (d) this.data = { ...this.data, ...d, settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } };
      } catch { /* 처음 실행이거나 저장 파일이 깨짐 */ }
      this.timer = null;
    }
    get settings() { return this.data.settings; }
    setSettings(patch) { Object.assign(this.data.settings, patch); this.save(); return this.data.settings; }
    day(key = today()) { return (this.data.days[key] ||= emptyDay()); }
    save(now = false) {
      clearTimeout(this.timer);
      const write = () => this.persist.save(this.data);
      if (now) write(); else this.timer = setTimeout(write, 3000);
    }

    // 자세 상태를 dt초만큼 기록. state: good|caution|warning|away|paused, issueKey: 가장 오래된 문제
    record(state, dt, issueKey, when = new Date()) {
      const d = this.day(today(when));
      d.sec[state] = (d.sec[state] || 0) + dt;
      if (issueKey && (state === 'caution' || state === 'warning')) d.issues[issueKey] = (d.issues[issueKey] || 0) + dt;
      if (state !== 'paused') {
        const hr = String(when.getHours());
        const hb = (d.hours[hr] ||= { good: 0, bad: 0, away: 0 });
        if (state === 'good') hb.good += dt; else if (state === 'away') hb.away += dt; else hb.bad += dt;
        const slot = `${String(when.getHours()).padStart(2, '0')}:${Math.floor(when.getMinutes() / 10)}0`;
        const tb = (d.tl[slot] ||= { good: 0, caution: 0, warning: 0, away: 0 });
        tb[state] = (tb[state] || 0) + dt;
      }
      this.save();
    }
    count(field, n = 1) { const d = this.day(); d[field] = (d[field] || 0) + n; this.save(); }

    emergencyLeft() {
      const e = this.data.emergency;
      if (e.date !== today()) { e.date = today(); e.used = 0; }
      return Math.max(0, this.settings.emergencyPerDay - e.used);
    }
    useEmergency() { this.emergencyLeft(); this.data.emergency.used += 1; this.save(); }

    // 캐릭터 해금(S6): 미어캣·거북이·고양이 기본 보유, 펭귄 = 바른 자세 누적 20시간, 강아지 = 7일 연속 사용
    unlocks() {
      const days = Object.entries(this.data.days).sort();
      const goodH = days.reduce((a, [, d]) => a + (d.sec.good || 0), 0) / 3600;
      let streak = 0;
      for (let i = 0; ; i++) {
        const dt = new Date(); dt.setDate(dt.getDate() - i);
        const d = this.data.days[today(dt)];
        const used = d && (d.sec.good + d.sec.caution + d.sec.warning) > 600;
        if (!used) { if (i === 0) continue; break; }
        streak++;
        if (i > 60) break;
      }
      return {
        meerkat: { owned: true }, turtle: { owned: true }, cat: { owned: true },
        penguin: { owned: goodH >= 20, progress: Math.min(1, goodH / 20), text: `바른 자세 20시간 · ${Math.floor(goodH)}/20` },
        dog: { owned: streak >= 7, progress: Math.min(1, streak / 7), text: `7일 연속 사용 · ${Math.min(streak, 7)}/7` },
      };
    }
  }

  return { StoreCore, DEFAULT_SETTINGS, today, emptyDay };
});
