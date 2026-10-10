// 데스크톱 위젯(S7·S8): 배경 없는 캐릭터 + 분석 중 점. 끌어서 옮기고(위치는 다음 실행 때도 기억), 클릭하면 메뉴
const C = window.Critter, B = window.barun;
document.head.insertAdjacentHTML('beforeend', `<style>${C.CRITTER_CSS}</style>`);
const art = document.getElementById('art'), dot = document.getElementById('dot'), w = document.getElementById('w');
let cur = '';
B.on('widget', (s) => {
  document.documentElement.style.setProperty('--px', `${s.size}px`);
  dot.className = s.analyzing ? '' : 'off';
  const key = `${s.animal}|${s.pose}|${s.tint}|${s.dir}`;
  if (key === cur) return;
  cur = key;
  art.innerHTML = C.critterSVG(s.animal, s.pose, { tint: s.tint, dir: s.dir });
  makeTrayFrames(s.animal);
});

// 창은 캐릭터보다 크고 투명하므로, 캐릭터 그림(또는 점) 위에서만 마우스를 받는다. 빈 곳은 뒤에 있는 창으로 통과
let ignoring = true;   // main.js가 만들 때 통과 상태로 시작
const setIgnore = (v) => { if (v !== ignoring) { ignoring = v; B.send('widget-ignore', v); } };
const onCharacter = (e) => {
  const t = document.elementFromPoint(e.clientX, e.clientY);
  return !!t && t.id !== 'w' && t.id !== 'box' && t.id !== 'art' && t !== document.body && t !== document.documentElement && t.tagName.toLowerCase() !== 'svg';
};
document.addEventListener('mousemove', (e) => { if (!drag) setIgnore(!onCharacter(e)); });   // 끄는 중에는 계속 잡고 있는다
document.addEventListener('mouseleave', () => { if (!drag) setIgnore(true); });

// 끌기: 4px 이상 움직이면 이동, 아니면 클릭(메뉴)
let drag = null;
w.addEventListener('mousedown', async (e) => {
  const [x, y] = await B.invoke('widget-pos');
  drag = { sx: e.screenX, sy: e.screenY, x, y, moved: false };
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.sx, dy = e.screenY - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  if (drag.moved) B.send('widget-move', { x: drag.x + dx, y: drag.y + dy });
});
window.addEventListener('mouseup', () => {
  if (!drag) return;
  if (drag.moved) B.send('widget-moved'); else B.send('widget-click');
  drag = null;
});

// 메뉴바 아이콘(S9) 프레임: 좋음=달림(2장), 주의=느려짐, 경고=주저앉음, 쉼=잠듦. 44px(@2x)
let trayAnimal = '';
async function makeTrayFrames(animal) {
  if (animal === trayAnimal) return;
  trayAnimal = animal;
  const render = (pose, tint) => new Promise((res) => {
    const svg = C.critterSVG(animal, pose, { tint, still: true }).replace('width="100%" height="100%"', 'width="44" height="44"');
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = 44; c.height = 44; c.getContext('2d').drawImage(img, 0, 0, 44, 44); res(c.toDataURL('image/png')); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  B.send('tray-frames', {
    good: [await render('good', 'none'), await render('praise', 'none')],
    caution: [await render('tilt', 'caution'), await render('turtle', 'caution')],
    warn: [await render('slouch', 'warning')],
    away: [await render('away', 'auto')],
  });
}
