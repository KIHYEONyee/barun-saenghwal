// 위젯 캐릭터. 기현 디자인(design/barun-ui-standalone.html 의 Critter 컴포넌트)을 그대로 옮긴 것.
// critterSVG(animal, pose, { tint, dir }) → SVG 문자열. 애니메이션 keyframes 는 CRITTER_CSS 를 페이지에 한 번 넣는다.
// animal: meerkat | turtle | cat | penguin | dog
// pose: good | turtle | tilt | shrug | slouch | chin | rest | away | praise
// tint: auto | caution | warning | none,  dir: 기울어짐 방향(+1 = 사용자 오른쪽, -1 = 왼쪽)
(function (root) {
  const CRITTER_CSS = `
@keyframes crBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes crJump{0%,100%{transform:translateY(0)}40%{transform:translateY(-12px)}}
@keyframes crSway{0%,100%{transform:rotate(-2.5deg)}50%{transform:rotate(2.5deg)}}
@keyframes crBreath{0%,100%{transform:scale(1,1)}50%{transform:scale(1.025,0.97)}}
@keyframes crShiver{0%,100%{transform:translateX(0)}25%{transform:translateX(-1px)}75%{transform:translateX(1px)}}
@keyframes crBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(0.1)}}
@keyframes crZ{0%{transform:translate(0,0);opacity:0}30%{opacity:1}100%{transform:translate(8px,-18px);opacity:0}}
@keyframes crSpark{0%,100%{transform:scale(.3);opacity:0}50%{transform:scale(1);opacity:1}}
@keyframes crWag{0%,100%{transform:rotate(-14deg)}50%{transform:rotate(16deg)}}`;

  const PAL = {
    meerkat: { body: 'oklch(0.79 0.075 68)', face: 'oklch(0.83 0.07 72)', mask: 'oklch(0.94 0.03 80)', belly: 'oklch(0.92 0.04 80)', dark: 'oklch(0.42 0.04 55)', feet: 'oklch(0.68 0.07 60)' },
    turtle: { body: 'oklch(0.58 0.11 150)', face: 'oklch(0.8 0.1 135)', mask: 'oklch(0.88 0.08 125)', belly: 'oklch(0.72 0.1 145)', dark: 'oklch(0.45 0.09 150)', feet: 'oklch(0.76 0.1 135)' },
    cat: { body: 'oklch(0.78 0.12 62)', face: 'oklch(0.8 0.12 62)', mask: 'oklch(0.95 0.025 80)', belly: 'oklch(0.94 0.03 80)', dark: 'oklch(0.6 0.13 50)', feet: 'oklch(0.94 0.03 80)' },
    penguin: { body: 'oklch(0.34 0.035 250)', face: 'oklch(0.34 0.035 250)', mask: 'oklch(0.97 0.005 250)', belly: 'oklch(0.97 0.005 250)', dark: 'oklch(0.25 0.03 250)', feet: 'oklch(0.76 0.15 60)' },
    dog: { body: 'oklch(0.89 0.045 78)', face: 'oklch(0.92 0.035 80)', mask: 'oklch(0.97 0.015 80)', belly: 'oklch(0.97 0.015 80)', dark: 'oklch(0.6 0.08 55)', feet: 'oklch(0.84 0.05 75)' },
  };
  const POSE = {
    good: { anim: 'crBounce 0.9s ease-in-out infinite' },
    turtle: { head: 'translate(17px,8px) rotate(6deg)', body: 'rotate(4deg)', neck: 'rotate(53deg)', anim: 'crSway 2.6s ease-in-out infinite', mouth: 'flat' },
    tilt: { root: 'rotate(-12deg)', head: 'rotate(-10deg)', anim: 'crSway 3s ease-in-out infinite', mouth: 'flat' },
    shrug: { head: 'translate(0px,7px)', paws: 'translate(0px,-11px)', anim: 'crShiver 0.25s linear infinite', mouth: 'flat' },
    slouch: { body: 'rotate(9deg) scale(1,0.9)', head: 'translate(11px,16px) rotate(14deg)', neck: 'rotate(53deg)', paws: 'translate(5px,8px)', anim: 'crSway 3.4s ease-in-out infinite', eyes: 'half', mouth: 'sad' },
    chin: { head: 'translate(2px,3px) rotate(9deg)', pawR: 'translate(-8px,-24px) rotate(-25deg)', anim: 'crBreath 3s ease-in-out infinite', eyes: 'half', mouth: 'flat' },
    rest: { head: 'rotate(-6deg)', anim: 'crBreath 2.6s ease-in-out infinite', eyes: 'half', mouth: 'yawn', bubble: true },
    away: { head: 'translate(0px,6px) rotate(14deg)', anim: 'crBreath 4s ease-in-out infinite', eyes: 'closed', mouth: 'none', zz: true, op: 0.6 },
    praise: { paws: 'translate(0px,-16px)', anim: 'crJump 0.7s ease-in-out infinite', eyes: 'happy', mouth: 'big', spark: true },
  };
  const AUTO = { turtle: 'warn', slouch: 'warn', tilt: 'caution', shrug: 'caution', chin: 'caution', rest: 'rest' };
  const INK = 'oklch(0.22 0.02 60)';
  const TR = 'transform .6s cubic-bezier(.3,1.4,.5,1), fill .5s, stroke .5s';
  const ANIMALS = [['meerkat', '미어캣'], ['turtle', '거북이'], ['cat', '고양이'], ['penguin', '펭귄'], ['dog', '강아지']];

  const style = (o) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}:${v}`).join(';');
  const vb = (origin, t) => style({ transform: t || 'none', 'transform-box': 'view-box', 'transform-origin': origin, transition: TR });
  const attrs = (o) => Object.entries(o || {}).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${v}"`).join('');
  const E = (cx, cy, rx, ry, fill, extra) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" style="transition:fill .5s"${attrs(extra)}/>`;
  const S = (d, stroke, w) => `<path d="${d}" stroke="${stroke}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
  const F = (d, fill) => `<path d="${d}" fill="${fill}" style="transition:fill .5s"/>`;
  const G = (st, inner) => `<g style="${st}">${inner}</g>`;

  function critterSVG(animalIn, poseIn, opts = {}) {
    const animal = PAL[animalIn] ? animalIn : 'meerkat';
    const pose = POSE[poseIn] ? poseIn : 'good';
    const tint = opts.tint || 'auto';
    const c = PAL[animal];
    const P = { ...POSE[pose] };
    if (pose === 'tilt' && (opts.dir || 0) > 0) { P.root = 'rotate(12deg)'; P.head = 'rotate(10deg)'; }   // 사용자 오른쪽으로 기울임
    const level = tint === 'auto' ? (AUTO[pose] || 'base') : tint === 'caution' ? 'caution' : tint === 'warning' ? 'warn' : 'base';
    const face = level === 'warn' ? 'oklch(0.64 0.2 28)' : level === 'caution' ? 'oklch(0.86 0.14 88)' : level === 'rest' ? 'oklch(0.8 0.012 80)' : c.face;
    const mask = level === 'warn' ? 'oklch(0.84 0.1 25)' : level === 'caution' ? 'oklch(0.95 0.07 92)' : c.mask;
    const tinted = level === 'warn' || level === 'caution';
    const neckCol = tinted ? face : animal === 'turtle' ? c.face : c.body;

    let body = '';
    if (animal === 'meerkat') body = S('M74 100 Q92 98 90 80', c.dark, 5) + E(60, 82, 18, 27, c.body) + E(60, 88, 11, 18, c.belly) + E(51, 109, 7, 3.5, c.feet) + E(69, 109, 7, 3.5, c.feet);
    if (animal === 'turtle') body = E(40, 106, 7, 5, c.face) + E(80, 106, 7, 5, c.face) + E(60, 90, 30, 21, c.body) + E(60, 85, 13, 9, c.belly) + E(44, 93, 5.5, 5, c.belly) + E(76, 93, 5.5, 5, c.belly) + E(60, 104, 31, 5, c.dark);
    if (animal === 'cat') body = S('M78 104 Q100 100 96 76', c.body, 7) + E(60, 86, 21, 24, c.body) + E(60, 92, 12, 15, c.belly) + E(51, 108, 7, 4, c.feet) + E(69, 108, 7, 4, c.feet);
    if (animal === 'penguin') body = E(51, 110, 8, 3.5, c.feet) + E(69, 110, 8, 3.5, c.feet) + E(60, 82, 23, 29, c.body) + E(60, 88, 16, 22, c.belly);
    if (animal === 'dog') body = G(style({ 'transform-box': 'view-box', 'transform-origin': '78px 98px', animation: 'crWag 0.5s ease-in-out infinite' }), S('M78 98 Q92 92 90 80', c.dark, 6)) + E(60, 86, 20, 24, c.body) + E(60, 92, 12, 15, c.belly) + E(70, 80, 6, 7, c.dark, { opacity: 0.45 }) + E(51, 108, 7, 4, c.feet) + E(69, 108, 7, 4, c.feet);
    body += G(vb('60px 66px', P.neck), `<line x1="60" y1="66" x2="60" y2="44" stroke="${neckCol}" stroke-width="12" stroke-linecap="round" style="transition:stroke .5s"/>`);

    let head = '';
    if (animal === 'meerkat') head += E(41, 40, 5, 5, face) + E(41, 40, 2.4, 2.4, c.dark) + E(79, 40, 5, 5, face) + E(79, 40, 2.4, 2.4, c.dark);
    if (animal === 'cat') head += F('M42 36 L45 18 L57 29 Z', face) + F('M45 32 L46.5 23 L53 29 Z', 'oklch(0.82 0.08 10)') + F('M78 36 L75 18 L63 29 Z', face) + F('M75 32 L73.5 23 L67 29 Z', 'oklch(0.82 0.08 10)');
    head += animal === 'turtle' ? E(60, 44, 17, 16, face) : E(60, 44, 20, 17, face);
    if (animal === 'dog') head += E(41, 48, 7, 13, c.dark, { transform: 'rotate(18 41 48)' }) + E(79, 48, 7, 13, c.dark, { transform: 'rotate(-18 79 48)' });
    if (animal === 'meerkat') head += E(52, 44, 5, 5.5, c.dark, { opacity: 0.3 }) + E(68, 44, 5, 5.5, c.dark, { opacity: 0.3 }) + E(60, 51, 8, 5.5, mask);
    if (animal === 'cat') head += E(60, 51, 8, 5, mask) + S('M45 50 L35 48', c.dark, 1) + S('M45 53 L35 54', c.dark, 1) + S('M75 50 L85 48', c.dark, 1) + S('M75 53 L85 54', c.dark, 1);
    if (animal === 'penguin') head += E(53, 45, 9, 9, mask) + E(67, 45, 9, 9, mask);
    if (animal === 'dog') head += E(60, 51, 10, 7, mask);
    if (level === 'base' || level === 'rest') head += E(47, 50, 3, 3, 'oklch(0.8 0.1 15)', { opacity: 0.45 }) + E(73, 50, 3, 3, 'oklch(0.8 0.1 15)', { opacity: 0.45 });

    const eyes = P.eyes || 'open';
    let eyeEls = '';
    if (eyes === 'open') eyeEls = E(53, 44, 2.8, 2.8, INK) + E(67, 44, 2.8, 2.8, INK) + E(54, 43, 0.9, 0.9, '#fff') + E(68, 43, 0.9, 0.9, '#fff');
    if (eyes === 'half') eyeEls = F('M50 43.5 A3 3 0 0 0 56 43.5 Z', INK) + F('M64 43.5 A3 3 0 0 0 70 43.5 Z', INK);
    if (eyes === 'closed') eyeEls = S('M50 44 Q53 47 56 44', INK, 1.8) + S('M64 44 Q67 47 70 44', INK, 1.8);
    if (eyes === 'happy') eyeEls = S('M50 45 Q53 41 56 45', INK, 2) + S('M64 45 Q67 41 70 45', INK, 2);
    head += G(style({ 'transform-box': 'view-box', 'transform-origin': '60px 44px', animation: eyes === 'open' ? 'crBlink 4s infinite' : 'none' }), eyeEls);

    if (animal === 'penguin') head += F(P.mouth === 'yawn' || P.mouth === 'big' ? 'M55 51 L65 51 L60 56 Z M56 57 L64 57 L60 60 Z' : 'M55 51 L65 51 L60 57 Z', c.feet);
    else {
      if (animal !== 'turtle') head += E(60, 48.5, animal === 'dog' ? 3.2 : 2.4, animal === 'dog' ? 2.4 : 1.8, INK);
      const m = P.mouth || 'smile';
      if (m === 'smile') head += S('M56 53 Q60 56 64 53', INK, 1.6);
      if (m === 'flat') head += S('M56.5 54 L63.5 54', INK, 1.6);
      if (m === 'sad') head += S('M56 55 Q60 52 64 55', INK, 1.6);
      if (m === 'yawn') head += E(60, 54.5, 3, 4, 'oklch(0.45 0.12 20)');
      if (m === 'big') head += F('M55 52 Q60 59 65 52 Z', 'oklch(0.5 0.14 20)');
    }
    if (level === 'warn') head += F('M81 28 Q84.5 34 81 36.5 Q77.5 34 81 28 Z', 'oklch(0.82 0.08 230)');

    const pawCol = animal === 'turtle' ? c.face : c.body;
    const paw = (cx, t) => G(vb(`${cx}px 76px`, t), E(cx, 76, 5, 8, pawCol, { transform: animal === 'penguin' ? `rotate(${cx < 60 ? 20 : -20} ${cx} 76)` : undefined }));

    let extras = '';
    if (P.bubble) extras += `<g><rect x="74" y="4" width="40" height="20" rx="10" fill="#fff" stroke="oklch(0.85 0.005 85)"/><circle cx="78" cy="29" r="2.5" fill="#fff" stroke="oklch(0.85 0.005 85)"/><text x="94" y="18" font-size="10" font-weight="700" text-anchor="middle" fill="${INK}" font-family="Pretendard, -apple-system, sans-serif">쉬자</text></g>`;
    if (P.zz) extras += `<text x="80" y="30" font-size="12" font-weight="700" fill="oklch(0.55 0.02 250)" style="animation:crZ 2.4s ease-out infinite">z</text><text x="86" y="22" font-size="9" font-weight="700" fill="oklch(0.55 0.02 250)" style="animation:crZ 2.4s ease-out 1.2s infinite;opacity:0">z</text>`;
    if (P.spark) [[26, 30, 0], [96, 22, 0.4], [100, 62, 0.8]].forEach(([x, y, d]) => {
      extras += `<g transform="translate(${x} ${y})"><path d="M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6 Z" fill="oklch(0.84 0.15 95)" style="transform-box:fill-box;transform-origin:center;animation:crSpark 1.2s ease-in-out ${d}s infinite"/></g>`;
    });

    return `<svg viewBox="0 0 120 120" width="100%" height="100%" style="overflow:visible;display:block" xmlns="http://www.w3.org/2000/svg">`
      + `<ellipse cx="60" cy="112" rx="26" ry="3.5" fill="rgba(0,0,0,.08)"/>`
      + G(style({ opacity: P.op ?? 1, transition: 'opacity .5s' }),
        G(vb('60px 112px', P.root),
          G(style({ 'transform-box': 'view-box', 'transform-origin': '60px 112px', animation: opts.still ? 'none' : (P.anim || 'none') }),
            G(vb('60px 112px', P.body), body) + G(vb('60px 62px', P.head), head) + paw(47, P.paws || P.pawL) + paw(73, P.pawR || P.paws) + extras)))
      + `</svg>`;
  }

  root.Critter = { critterSVG, CRITTER_CSS, ANIMALS, POSES: Object.keys(POSE) };
})(typeof window !== 'undefined' ? window : globalThis);
