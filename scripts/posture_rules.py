"""측면 사진용 거북목 규칙 판정. CVA(귀–어깨 선과 수평선이 이루는 각도)가 작을수록 머리가 앞으로 나온 상태."""
import csv, sys
from math import atan2, degrees
from pathlib import Path
import numpy as np
import cv2

# MediaPipe 인덱스: 코 0, 왼귀 7, 오른귀 8, 왼어깨 11, 오른어깨 12
NOSE, EAR, SHOULDER = 0, (7, 8), (11, 12)
# 기준 각도(CVA). 정상 50° 이상, 경계 45~50°, 거북목 45° 미만, 심함 40° 미만.
# 개인 기준(ref, 기준 측정 때 잰 바른 자세 각도)이 있으면 ref, ref-5, ref-10으로 바꿔 쓴다. app/shared/rules.js 와 같음
NORMAL, MILD, SEVERE = 50.0, 45.0, 40.0
STEP = 5.0
MIN_VIS = 0.5  # 귀·어깨 가시성이 이보다 낮으면 판정하지 않음

def cva(lm, w, h, ref=None):
    """lm: 랜드마크 33개의 (x, y, visibility) 정규화 좌표. 반환: (CVA°, 판정) 또는 판정 불가면 (None, 사유)."""
    normal = ref or NORMAL
    nose = lm[NOSE]
    side = max((0, 1), key=lambda i: abs(lm[EAR[i]][0] - nose[0]))  # 카메라 쪽 귀: 코에서 가로로 더 먼 귀 (rules.js 와 같음)
    ear, sh = lm[EAR[side]], lm[SHOULDER[side]]
    if min(ear[2], sh[2]) < MIN_VIS:
        return None, "귀/어깨가 안 보임"
    ex, ey, sx, sy = ear[0] * w, ear[1] * h, sh[0] * w, sh[1] * h
    facing = 1 if nose[0] * w >= ex else -1        # 얼굴이 향한 방향(좌우)
    forward = (ex - sx) * facing                    # 어깨보다 귀가 앞으로 나온 거리
    up = sy - ey                                    # 어깨보다 귀가 위로 올라온 거리
    if up <= 0:
        return None, "귀가 어깨보다 아래(정면/고개 숙임)"
    angle = degrees(atan2(up, forward))
    if abs(ex - sx) < 0.25 * up and abs(nose[0] * w - ex) < 0.25 * up:
        return None, "정면에 가까워 측면 판정 불가"
    label = "정상" if angle >= normal else "경계" if angle >= normal - STEP else "거북목" if angle >= normal - 2 * STEP else "심한 거북목"
    return angle, label

if __name__ == "__main__":
    ROOT = Path(__file__).resolve().parent.parent
    SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Desktop" / "자세 데이터" / "archive"
    out, counts = [], {}
    for r in csv.DictReader(open(ROOT / "data/out/landmarks.csv", encoding="utf-8")):
        img = cv2.imdecode(np.fromfile(str(SRC / "images" / r["split"] / r["image"]), "uint8"), cv2.IMREAD_COLOR)
        h, w = img.shape[:2]
        lm = [(float(r[f"x{i}"]), float(r[f"y{i}"]), float(r[f"v{i}"])) for i in range(33)]
        a, label = cva(lm, w, h)
        counts[label if a is not None else "판정불가"] = counts.get(label if a is not None else "판정불가", 0) + 1
        out.append([r["split"], r["image"], "" if a is None else round(a, 1), label])
        if a is not None:
            side = max((0, 1), key=lambda i: lm[EAR[i]][2] + lm[SHOULDER[i]][2])
            e, s = lm[EAR[side]], lm[SHOULDER[side]]
            cv2.line(img, (int(e[0] * w), int(e[1] * h)), (int(s[0] * w), int(s[1] * h)), (0, 0, 255), 3)
            cv2.putText(img, f"CVA {a:.0f} {label}", (10, 35), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            (ROOT / "data/out/cva").mkdir(exist_ok=True)
            cv2.imencode(".jpg", img)[1].tofile(str(ROOT / "data/out/cva" / f"{r['split']}_{Path(r['image']).stem}.jpg"))
    with open(ROOT / "data/out/cva.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f); wr.writerow(["split", "image", "cva", "label"]); wr.writerows(out)
    print(counts)
    vals = np.array([float(o[2]) for o in out if o[2] != ""])
    print("CVA 평균 %.1f 중앙값 %.1f 최소 %.1f 최대 %.1f" % (vals.mean(), np.median(vals), vals.min(), vals.max()))
