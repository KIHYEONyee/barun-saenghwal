"""파이썬 판정(front_rules)과 앱 JS 판정(app/shared/rules.js)이 같은지 비교할 기준 데이터를 만든다.
사용: python scripts/export_parity.py  →  data/out/parity.json  →  cd app && npm test
MultiPosture(있으면) 프레임과 일부러 만든 프레임을 섞어 지표·문제 목록을 저장한다."""
import json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent))
import front_rules as fr

ROOT = Path(__file__).resolve().parent.parent
rng = np.random.default_rng(0)
cases = []

def add(lm, w, h, base):
    lm = lm.round(6)   # 저장하는 좌표와 같은 값으로 계산
    m = fr.metrics(lm, w, h)
    cases.append({"lm": lm.tolist(), "w": w, "h": h, "base": base, "metrics": m,
                  "issues": [list(i) for i in fr.detect_issues(m, base)] if (m and base) else None})

# 1) 일부러 만든 정면 웹캠 배치 + 변형
lm0 = np.zeros((33, 4)); lm0[:, 3] = 0.1
for i, (x, y) in {0: (.50, .42), 7: (.41, .40), 8: (.59, .40), 9: (.47, .48), 10: (.53, .48), 11: (.68, .72), 12: (.32, .72)}.items():
    lm0[i, :2] = (x, y); lm0[i, 3] = .99
samples = [fr.metrics(lm0 + np.c_[rng.normal(0, .0015, (33, 2)), np.zeros((33, 2))], 640, 480) for _ in range(30)]
base, _ = fr.make_baseline(samples)
base = {k: (float(v) if k != "_std" else {kk: float(vv) for kk, vv in v.items()}) for k, v in base.items()}
for _ in range(150):
    lm = lm0.copy()
    lm[:, :2] += rng.normal(0, .03, (33, 2)) * rng.random()
    if rng.random() < .3: lm[16, :2] = (.52, .52); lm[16, 3] = .9     # 손을 턱 근처로
    add(lm, 640, 480, base)
# 2) MultiPosture (있으면)
mp = ROOT / "data/multiposture/data.csv"
if mp.exists():
    import eval_front_rules as ev
    import pandas as pd
    d = pd.read_csv(mp).sample(400, random_state=0)
    for _, r in d.iterrows():
        lm = np.ones((33, 4)); lm[:, 0] = [-r[f"{j}_x"] * 1 + 1 for j in ev.J]; lm[:, 1] = [r[f"{j}_y"] + 1 for j in ev.J]
        lm[list(fr.HAND), 3] = 0.0
        add(lm, 1000, 1000, base | {"shoulder_w": 320.0, "ear_d": 150.0, "face_ratio": .47, "neck_h": .55, "shoulder_y": 600.0, "nose_y": 480.0})
out = ROOT / "data/out/parity.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"TH": {k: v for k, v in fr.TH.items()}, "cases": cases}))
print(f"{len(cases)}개 저장 → {out}")
