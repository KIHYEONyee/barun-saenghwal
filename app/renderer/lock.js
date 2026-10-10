// S11 교정 유도 화면: ① 카메라로 바른 자세 3초 확인 → ② "바른 자세로 앉자" 입력. 운영체제를 잠그지 않고 앱 창이 화면을 덮을 뿐이다.
const B = window.barun, C = window.Critter;
document.head.insertAdjacentHTML('beforeend', `<style>${C.CRITTER_CSS}</style>`);
const $ = (s) => document.querySelector(s);
const PHRASE = '바른 자세로 앉자';
let info = null, goodSince = 0, step1 = false, LIVE = null, stream = null;

B.on('lock-info', async (i) => {
  info = i;
  const D = await B.invoke('get-all');
  $('#art').innerHTML = C.critterSVG(D.settings.animal, 'turtle', { tint: 'warning' });
  const NOUN = { turtle: '목이 앞으로 나온 자세', close: '화면에 가까이 붙은 자세', head_down: '고개를 숙인 자세', roll: '고개가 기운 자세', tilt: '어깨가 기운 자세', shrug: '어깨가 올라간 자세', lean: '몸이 한쪽으로 기운 자세', chin: '턱을 괸 자세', slouch: '구부정한 자세' };
  $('#sub').textContent = `${NOUN[i.issue && i.issue.key] || '바르지 않은 자세'}가 ${i.minutes}분째 이어지고 있어요.`;
  $('#emg').textContent = `비상 해제 · 오늘 ${i.emergencyLeft}회 남음`;
  $('#emg').disabled = i.emergencyLeft <= 0;
  if (i.mode === 'basic') { step1 = true; $('#p1').style.display = 'none'; openStep2(); }
  else {
    const dev = await B.invoke('dev-info');
    if (dev.fakeImage) $('#cam').insertAdjacentHTML('afterbegin', `<img class="fake" src="${dev.fakeImage}">`);
    else {
      try {
        const live = D.live, want = (live.devices || []).find((d) => d.label === (live.posture && live.posture.device));
        stream = await navigator.mediaDevices.getUserMedia({ video: want ? { deviceId: { exact: want.id } } : true });
        const v = document.createElement('video'); v.muted = true; v.srcObject = stream; $('#cam').prepend(v); await v.play();
      } catch { /* 미리보기 실패해도 판정은 분석 창이 한다 */ }
    }
  }
  setTimeout(() => $('#in').focus(), 300);
});
B.on('live', (s) => {
  LIVE = s;
  if (step1 || !info) return;
  const p = s.posture || {};
  const good = p.present && p.level === 'good' && !(p.issues || []).length;
  if (good) { goodSince ||= Date.now(); } else goodSince = 0;
  const sec = goodSince ? Math.min(3, (Date.now() - goodSince) / 1000) : 0;
  $('#p1n').textContent = `${Math.floor(sec)} / 3초`;
  $('#p1b').style.width = `${(sec / 3) * 100}%`;
  if (sec >= 3) { step1 = true; openStep2(); }
});
function openStep2() {
  $('#p2').classList.remove('off');
  $('#p2n').textContent = '';
  $('#in').disabled = false; $('#in').focus();
}
$('#in').addEventListener('input', (e) => {
  if (e.target.value.replace(/\s+/g, ' ').trim() === PHRASE) { if (stream) stream.getTracks().forEach((t) => t.stop()); B.send('lock-release', 'fixed'); }
});
$('#emg').onclick = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); B.send('lock-release', 'emergency'); };
$('#rep').onclick = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); B.send('lock-release', 'report'); };
