"""landmarks.csv(MediaPipe)와 라벨 키포인트(귀·어깨·팔꿈치·손목)의 오차를 계산한다. 오차는 이미지 높이 대비 비율."""
import csv, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Desktop" / "자세 데이터" / "archive"
PAIRS = [("귀", 7, 8), ("어깨", 11, 12), ("팔꿈치", 13, 14), ("손목", 15, 16)]
err = {n: [] for n, _, _ in PAIRS}
for r in csv.DictReader(open(ROOT / "data/out/landmarks.csv", encoding="utf-8")):
    lab = SRC / "labels" / r["split"] / (Path(r["image"]).stem + ".txt")
    v = lab.read_text().split() if lab.exists() else []
    if len(v) < 17: continue
    k = np.array(v[5:17], float).reshape(4, 3)[:, :2]
    for i, (n, a, b) in enumerate(PAIRS):
        c = [np.array([float(r[f"x{j}"]), float(r[f"y{j}"])]) for j in (a, b)]
        err[n].append(min(np.linalg.norm(p - k[i]) for p in c))  # 가까운 쪽 좌/우 선택
for n, e in err.items():
    e = np.array(e)
    print(f"{n}: n={len(e)} 평균오차={e.mean():.3f} 중앙값={np.median(e):.3f} 5%이하={np.mean(e<0.05):.0%}")
