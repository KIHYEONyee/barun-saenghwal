"""Sitting Posture(폴더형 Roboflow 데이터)에서 CVA 규칙의 판정 성능을 잰다."""
import csv, sys
from pathlib import Path
import cv2, numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision
sys.path.insert(0, str(Path(__file__).parent))
from posture_rules import cva

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1])
det = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
    base_options=mpt.BaseOptions(model_asset_buffer=(ROOT / "models/pose_landmarker_full.task").read_bytes()),
    running_mode=vision.RunningMode.IMAGE))
rows = []
for split in ("train", "valid", "test"):
    for cls in ("goodposture", "forwardbadposture", "backwardbadposture"):
        for f in sorted((SRC / split / cls).glob("*.jpg")):
            img = cv2.imdecode(np.fromfile(str(f), "uint8"), cv2.IMREAD_COLOR)
            h, w = img.shape[:2]
            res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))
            if not res.pose_landmarks:
                rows.append((split, cls, None, "검출실패")); continue
            lm = [(p.x, p.y, p.visibility) for p in res.pose_landmarks[0]]
            a, label = cva(lm, w, h)
            rows.append((split, cls, a, label))
out = ROOT / "data/out"; out.mkdir(parents=True, exist_ok=True)
csv.writer(open(out / "sitting_cva.csv", "w", newline="", encoding="utf-8")).writerows([("split", "class", "cva", "label")] + rows)

def report(name, subset):
    print(f"[{name}]")
    for cls in ("goodposture", "forwardbadposture", "backwardbadposture"):
        r = [x for x in subset if x[1] == cls]
        v = np.array([x[2] for x in r if x[2] is not None])
        print(f"  {cls}: 전체 {len(r)}, 판정됨 {len(v)}, CVA 중앙값 {np.median(v):.1f}, 거북목(<45) 비율 {np.mean(v<45):.0%}")
    g = np.array([x[2] for x in subset if x[1] == "goodposture" and x[2] is not None])
    b = np.array([x[2] for x in subset if x[1] == "forwardbadposture" and x[2] is not None])
    # 좋은 자세 vs 앞으로 나쁜 자세: 임계값별 정확도(균형)
    best = max(((np.mean(g >= t) + np.mean(b < t)) / 2, t) for t in range(30, 90))
    auc = np.mean([[bb < gg for gg in g] for bb in b])
    print(f"  good vs forward-bad: AUC {auc:.2f}, 현재 기준(45°) 균형정확도 {(np.mean(g>=45)+np.mean(b<45))/2:.0%}, 최적 임계 {best[1]}° ({best[0]:.0%})")

report("valid+test", [x for x in rows if x[0] != "train"])
report("전체", rows)
