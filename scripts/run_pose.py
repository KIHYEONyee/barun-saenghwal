"""MediaPipe Pose Landmarker를 자세 데이터셋 이미지에 돌려 랜드마크를 CSV로 저장하고, 라벨 키포인트와 함께 그려 확인한다."""
import csv, sys
from pathlib import Path
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Desktop" / "자세 데이터" / "archive"
OUT = ROOT / "data" / "out"
(OUT / "vis").mkdir(parents=True, exist_ok=True)

opts = vision.PoseLandmarkerOptions(
    base_options=mpt.BaseOptions(model_asset_buffer=(ROOT / "models" / "pose_landmarker_full.task").read_bytes()),
    running_mode=vision.RunningMode.IMAGE)
det = vision.PoseLandmarker.create_from_options(opts)

def read_label(p):
    if not p.exists(): return []
    v = p.read_text().split()
    if len(v) < 17: return []
    k = list(map(float, v[5:17]))
    return [(k[i], k[i+1], int(k[i+2])) for i in range(0, 12, 3)]

rows, found, total = [], 0, 0
for split in ("train", "val"):
    for img in sorted((SRC / "images" / split).iterdir()):
        data = cv2.imdecode(__import__("numpy").fromfile(str(img), dtype="uint8"), cv2.IMREAD_COLOR)
        if data is None: continue
        total += 1
        h, w = data.shape[:2]
        res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(data, cv2.COLOR_BGR2RGB)))
        ok = bool(res.pose_landmarks)
        found += ok
        if ok:
            lm = res.pose_landmarks[0]
            rows.append([split, img.name] + [round(v, 5) for p in lm for v in (p.x, p.y, p.z, p.visibility)])
            for p in lm:
                cv2.circle(data, (int(p.x * w), int(p.y * h)), 4, (0, 255, 0), -1)
        for i, (x, y, v) in enumerate(read_label(SRC / "labels" / split / (img.stem + ".txt"))):
            c = (int(x * w), int(y * h))
            cv2.circle(data, c, 7, (0, 0, 255), 2)
            cv2.putText(data, str(i), c, cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
        if total <= 12 or not ok:
            cv2.imencode(".jpg", data)[1].tofile(str(OUT / "vis" / f"{split}_{img.stem}.jpg"))

with open(OUT / "landmarks.csv", "w", newline="", encoding="utf-8") as f:
    wr = csv.writer(f)
    wr.writerow(["split", "image"] + [f"{n}{i}" for i in range(33) for n in ("x", "y", "z", "v")])
    wr.writerows(rows)
print(f"검출 성공 {found}/{total} ({found/total:.1%})")
