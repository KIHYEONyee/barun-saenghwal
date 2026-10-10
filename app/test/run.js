// 파이썬 판정과 JS 판정 비교. 먼저 루트에서 `python scripts/export_parity.py` 실행
const fs = require('fs');
const path = require('path');
const R = require('../shared/rules');

const file = path.join(__dirname, '../../data/out/parity.json');
if (!fs.existsSync(file)) { console.error('data/out/parity.json 이 없습니다. python scripts/export_parity.py 를 먼저 실행하세요.'); process.exit(1); }
const { cases } = JSON.parse(fs.readFileSync(file, 'utf8'));
let bad = 0, issueCases = 0, chinCases = 0;
const close = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
for (const [n, c] of cases.entries()) {
  const m = R.metrics(c.lm, c.w, c.h);
  if ((m === null) !== (c.metrics === null)) { bad++; console.log(n, '지표 None 여부 다름'); continue; }
  if (!m) continue;
  for (const k of R.METRICS) if (!close(m[k], c.metrics[k])) { bad++; console.log(n, '지표 다름', k, m[k], c.metrics[k]); }
  if (!c.issues) continue;
  const js = R.detectIssues(m, c.base);
  const py = c.issues;
  if (py.length) issueCases++;
  if (py.some((i) => i[1] === 'chin')) chinCases++;
  const same = js.length === py.length && js.every((i, j) => i.key === py[j][1] && i.ko === py[j][2] && close(i.sev, py[j][4]));
  if (!same) { bad++; console.log(n, '문제 목록 다름', js.map((i) => i.key), py.map((i) => i[1])); }
}
console.log(`비교 ${cases.length}개 (문제가 있는 경우 ${issueCases}개, 턱 괴기 ${chinCases}개) → 불일치 ${bad}개`);
process.exit(bad ? 1 : 0);
