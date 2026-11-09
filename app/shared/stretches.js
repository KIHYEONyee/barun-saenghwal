// 스트레칭 목록(S5)과 카메라로 동작을 확인하는 규칙.
// rel: 분석기가 보내는 '기준 자세 대비 지금 값' { roll(°), tilt(°), faceRel, neckRel, pitch, wristsUp, present }
// 기본 모드(카메라 끔)에서는 확인 없이 타이머만 흐른다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Stretches = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LIST = [
    {
      id: 'chin_tuck', name: '턱 당기기', targets: ['turtle', 'head_down', 'close'], forText: '거북목 완화',
      pose: 'good',
      steps: [
        { text: '손가락으로 턱을 뒤로 밀어요', hold: 5, check: (r) => r.faceRel <= 0.96 || r.neckRel >= 1.05, hint: '머리를 뒤로 당겨 주세요' },
        { text: '한 번 더, 턱을 뒤로 밀어요', hold: 5, check: (r) => r.faceRel <= 0.96 || r.neckRel >= 1.05, hint: '머리를 뒤로 당겨 주세요' },
        { text: '마지막으로 5초 유지해요', hold: 5, check: (r) => r.faceRel <= 0.96 || r.neckRel >= 1.05, hint: '머리를 뒤로 당겨 주세요' },
      ],
    },
    {
      id: 'neck_side', name: '목 옆 스트레칭', targets: ['roll', 'tilt', 'shrug'], forText: '목·어깨 긴장 완화',
      pose: 'tilt',
      steps: [
        { text: '고개를 오른쪽으로 천천히 기울여요', hold: 5, check: (r) => r.roll >= 15, hint: '오른쪽으로 더 기울여 주세요' },
        { text: '이번엔 왼쪽으로 기울여요', hold: 5, check: (r) => r.roll <= -15, hint: '왼쪽으로 더 기울여 주세요' },
      ],
    },
    {
      id: 'shoulder_shrug', name: '어깨 으쓱 풀기', targets: ['shrug', 'tilt', 'chin'], forText: '어깨 긴장 풀기',
      pose: 'shrug',
      steps: [
        { text: '어깨를 귀까지 끌어올려요', hold: 3, check: (r) => r.neckRel <= 0.8, hint: '어깨를 더 올려 주세요' },
        { text: '툭 떨어뜨리고, 다시 올려요', hold: 3, check: (r) => r.neckRel <= 0.8, hint: '어깨를 더 올려 주세요' },
        { text: '한 번 더 올렸다 내려요', hold: 3, check: (r) => r.neckRel <= 0.8, hint: '어깨를 더 올려 주세요' },
      ],
    },
    {
      id: 'overhead', name: '기지개 켜기', targets: ['head_down', 'slouch', 'lean', 'rest'], forText: '구부정한 등 펴기',
      pose: 'praise',
      steps: [
        { text: '두 팔을 머리 위로 쭉 뻗어요', hold: 5, check: (r) => r.wristsUp, hint: '양손을 머리보다 높이 올려 주세요' },
        { text: '한 번 더 쭉 뻗어요', hold: 5, check: (r) => r.wristsUp, hint: '양손을 머리보다 높이 올려 주세요' },
      ],
    },
    {
      id: 'wrist', name: '손목·팔 풀기', targets: ['chin'], forText: '턱 괴는 습관 끊기',
      pose: 'good',
      steps: [
        { text: '손을 깍지 끼고 앞으로 쭉 밀어요', hold: 10, check: null },
        { text: '손목을 천천히 돌려요', hold: 10, check: null },
      ],
    },
    {
      id: 'neck_back', name: '목 뒤 늘리기', targets: ['turtle', 'shrug', 'close'], forText: '뻣뻣한 목 뒤 풀기',
      pose: 'rest',
      steps: [
        { text: '두 손을 뒤통수에 대고 고개를 천천히 숙여요', hold: 8, check: (r) => r.pitch >= 0.2, hint: '고개를 더 숙여 주세요' },
        { text: '숨을 내쉬며 한 번 더 숙여요', hold: 8, check: (r) => r.pitch >= 0.2, hint: '고개를 더 숙여 주세요' },
      ],
    },
    {
      id: 'neck_turn', name: '고개 돌리기', targets: ['roll', 'tilt', 'turtle'], forText: '목 옆·뒤 근육 풀기',
      pose: 'tilt',
      steps: [
        { text: '고개를 한쪽으로 천천히 돌려 어깨 너머를 봐요', hold: 5, check: (r) => Math.abs(r.shift) >= 0.12, hint: '고개를 옆으로 더 돌려 주세요' },
        { text: '반대쪽으로 돌려요', hold: 5, check: (r) => Math.abs(r.shift) >= 0.12, hint: '고개를 옆으로 더 돌려 주세요' },
      ],
    },
    {
      id: 'chest_open', name: '가슴 펴기', targets: ['slouch', 'turtle', 'head_down', 'lean'], forText: '말린 어깨 펴기',
      pose: 'praise',
      steps: [
        { text: '등 뒤에서 깍지를 끼고 팔을 뒤로 쭉 펴요', hold: 10, check: null },
        { text: '가슴을 앞으로 내밀고 천장을 봐요', hold: 10, check: null },
      ],
    },
    {
      id: 'twist', name: '앉아서 몸 비틀기', targets: ['slouch', 'lean', 'rest'], forText: '굳은 허리·등 풀기',
      pose: 'good',
      steps: [
        { text: '의자 등받이를 잡고 상체를 한쪽으로 돌려요', hold: 10, check: null },
        { text: '반대쪽으로 돌려요', hold: 10, check: null },
      ],
    },
    {
      id: 'eye_rest', name: '눈 쉬기 (20-20-20)', targets: ['close', 'rest'], forText: '화면에 가까이 붙는 습관 끊기',
      pose: 'rest',
      steps: [
        { text: '화면에서 눈을 떼고 6m 넘게 먼 곳을 봐요', hold: 20, check: null },
      ],
    },
  ];

  const byId = (id) => LIST.find((s) => s.id === id);
  // 문제 키(예: 'turtle')에 맞는 스트레칭 추천. counts: {문제키: 초}
  function recommend(counts, n = 3) {
    const score = (s) => s.targets.reduce((a, k) => a + (counts[k] || 0), 0);
    return [...LIST].sort((a, b) => score(b) - score(a)).slice(0, n);
  }
  const duration = (s) => s.steps.reduce((a, st) => a + st.hold, 0);
  return { LIST, byId, recommend, duration };
});
