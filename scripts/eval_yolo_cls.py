"""YOLO 형식 폴더(라벨 첫 숫자=클래스)에서 CVA 규칙의 클래스별 분포를 잰다. 사용: eval_yolo_cls.py <폴더> <출력이름>"""
import csv, sys
from pathlib import Path
import cv2, numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision
sys.path.insert(0, str(Path(__file__).parent))
from posture_rules import cva

ROOT = Path(__file__).resolve().parent.parent
SRC, NAME = Path(sys.argv[1]), sys.argv[2]
det = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
    base_options=mpt.BaseOptions(model_asset_buffer=(ROOT / "models/pose_landmarker_full.task").read_bytes()),
    running_mode=vision.RunningMode.IMAGE))
rows = []
for split in ("train", "valid", "test"):
    for f in sorted((SRC / split / "images").glob("*.*")):
        lab = SRC / split / "labels" / (f.stem + ".txt")
        t = lab.read_text().split() if lab.exists() else []
        if not t: continue
        img = cv2.imdecode(np.fromfile(str(f), "uint8"), cv2.IMREAD_COLOR)
        h, w = img.shape[:2]
        res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))
        a = label = None
        if res.pose_landmarks:
            a, label = cva([(p.x, p.y, p.visibility) for p in res.pose_landmarks[0]], w, h)
        rows.append((split, f.name, int(t[0]), a, label if a is not None else (label or "검출실패")))
out = ROOT / "data/out"
csv.writer(open(out / f"{NAME}.csv", "w", newline="", encoding="utf-8")).writerows([("split", "image", "class", "cva", "label")] + rows)
for name, sub in (("valid+test", [r for r in rows if r[0] != "train"]), ("전체", rows)):
    print(f"[{name}]")
    for c in sorted({r[2] for r in sub}):
        v = np.array([r[3] for r in sub if r[2] == c and r[3] is not None])
        n = sum(r[2] == c for r in sub)
        print(f"  class {c}: 전체 {n}, 판정됨 {len(v)}, CVA 중앙값 {np.median(v):.1f}, 평균 {v.mean():.1f}, <45 {np.mean(v<45):.0%}, <52 {np.mean(v<52):.0%}")
