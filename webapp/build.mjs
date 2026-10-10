// 웹 버전 빌드: 앱의 화면·판정 코드(app/renderer, app/shared)와 웹 전용 파일을 dist/ 에 모은다.
// 화면 코드를 복사해 쓰므로, 앱을 고치면 웹도 다시 빌드하면 같이 바뀐다. 사용: node build.mjs
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '../app');
const out = join(here, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'renderer'), { recursive: true });
for (const f of ['style.css', 'app.css', 'app.js', 'critter.js', 'analyzer.js', 'lock.html', 'lock.js', 'selfcheck.html']) cpSync(join(app, 'renderer', f), join(out, 'renderer', f));
cpSync(join(app, 'shared'), join(out, 'shared'), { recursive: true });
for (const f of ['index.html', 'web.css', 'bridge.js']) cpSync(join(here, f), join(out, f));
cpSync(join(app, 'build/icon.png'), join(out, 'icon.png'));
console.log('웹 빌드 완료 →', out);
