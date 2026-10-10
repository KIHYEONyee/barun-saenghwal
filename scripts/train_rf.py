"""MediaPipe 랜드마크 특징으로 바른/나쁜 자세 Random Forest를 학습하고, 규칙(CVA)과 비교한다."""
import sys
from math import atan2, degrees
from pathlib import Path
import cv2, joblib, numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import confusion_matrix, roc_auc_score
from sklearn.model_selection import GroupKFold

ROOT = Path(__file__).resolve().parent.parent
DESK, DL = Path.home() / "Desktop", Path.home() / "Downloads"
KP4 = DESK / "sitting posture.v4-sitting_posture_4keypoint.yolov8"
FOLDER = DL / "Sitting Posture.v2i.folder"
CACHE = ROOT / "data/out/rf_cache.npz"

def gather():
    """(경로, 나쁜자세=1, split, 데이터셋) 목록. v2(0/1)는 클래스 의미가 불확실해 제외."""
    s = []
    for sp in ("train", "valid", "test"):
        for f in sorted((KP4 / sp / "images").glob("*.*")):
            t = (KP4 / sp / "labels" / (f.stem + ".txt")).read_text().split()
            if t: s.append((f, int(t[0] == "0"), "train" if sp == "train" else "test", "kp4"))
        for cls, y in (("goodposture", 0), ("forwardbadposture", 1), ("backwardbadposture", 1)):
            for f in sorted((FOLDER / sp / cls).glob("*.jpg")):
                s.append((f, y, "train" if sp == "train" else "test", "folder"))
    return s

def features(lm, w, h):
    """lm: (33,4) 정규화 좌표(x,y,z,vis). 어깨·귀·코 중심의 크기 불변 특징."""
    P = lm[:, :2] * [w, h]
    L, R = 11, 12
    mid = (P[L] + P[R]) / 2
    side = 0 if lm[7, 3] + lm[11, 3] >= lm[8, 3] + lm[12, 3] else 1
    ear, sh = P[7 + side], P[11 + side]
    sw = np.linalg.norm(P[L] - P[R])
    scale = max(np.linalg.norm(ear - sh), np.linalg.norm(P[L] - P[R]), 1e-6)   # 정면=어깨너비, 측면=귀-어깨
    facing = 1 if P[0, 0] >= ear[0] else -1
    fwd, up = (ear[0] - sh[0]) * facing, sh[1] - ear[1]
    face = np.linalg.norm(P[2] - P[5]) + 1e-6                                  # 양 눈 사이(얼굴 크기)
    tilt = lambda a, b: degrees(atan2(b[1] - a[1], b[0] - a[0]))
    return np.array([
        degrees(atan2(up, fwd)), fwd / scale, up / scale,
        abs(tilt(P[L], P[R])), abs(tilt(P[7], P[8])),
        sw / scale, face / scale, sw / face,
        (P[0, 1] - mid[1]) / scale, (P[0, 0] - mid[0]) * facing / scale,
        (mid[1] - ear[1]) / scale, abs(P[7, 1] - P[8, 1]) / scale,
        lm[7 + side, 3], lm[11 + side, 3], lm[0, 3],
        lm[0, 2] - lm[11 + side, 2], lm[7 + side, 2] - lm[11 + side, 2],      # 깊이(z) 차이
    ])

def build():
    if CACHE.exists():
        d = np.load(CACHE, allow_pickle=True); return d["X"], d["y"], d["split"], d["ds"], d["grp"]
    det = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=mpt.BaseOptions(model_asset_buffer=(ROOT / "models/pose_landmarker_full.task").read_bytes()),
        running_mode=vision.RunningMode.IMAGE))
    X, y, sp, ds, grp = [], [], [], [], []
    for f, lab, split, d in gather():
        img = cv2.imdecode(np.fromfile(str(f), "uint8"), cv2.IMREAD_COLOR)
        h, w = img.shape[:2]
        res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))
        if not res.pose_landmarks: continue
        lm = np.array([[p.x, p.y, p.z, p.visibility] for p in res.pose_landmarks[0]])
        X.append(features(lm, w, h)); y.append(lab); sp.append(split); ds.append(d)
        grp.append(d + f.name.split(".rf.")[0])   # 증강본이 같은 그룹이 되도록 원본 이름 기준
    X, y, sp, ds, grp = map(np.array, (X, y, sp, ds, grp))
    np.savez(CACHE, X=X, y=y, split=sp, ds=ds, grp=grp)
    return X, y, sp, ds, grp

def bal(y, p):
    return (np.mean(p[y == 0] == 0) + np.mean(p[y == 1] == 1)) / 2

if __name__ == "__main__":
    X, y, sp, ds, grp = build()
    print(f"샘플 {len(y)} (나쁨 {y.sum()}, 좋음 {(1-y).sum()})")
    tr, te = sp == "train", sp == "test"
    mk = lambda: RandomForestClassifier(n_estimators=400, min_samples_leaf=3, class_weight="balanced", random_state=0, n_jobs=-1)
    rf = mk().fit(X[tr], y[tr])
    pr = rf.predict_proba(X[te])[:, 1]; pred = (pr >= 0.5).astype(int)
    rule = (X[te, 0] < 52).astype(int)
    print(f"[test {te.sum()}장] RF 균형정확도 {bal(y[te], pred):.1%}  AUC {roc_auc_score(y[te], pr):.3f} | 규칙(CVA<52) 균형정확도 {bal(y[te], rule):.1%}  AUC {roc_auc_score(y[te], -X[te, 0]):.3f}")
    print("혼동행렬(행=실제 좋음/나쁨, 열=예측):\n", confusion_matrix(y[te], pred))
    for d in ("kp4", "folder"):
        m = ds[te] == d
        print(f"  {d}: RF {bal(y[te][m], pred[m]):.1%} / 규칙 {bal(y[te][m], rule[m]):.1%} (n={m.sum()})")
    # 그룹 교차검증(같은 원본 사진은 한 쪽에만)
    cv_p = np.zeros(len(y))
    for a, b in GroupKFold(5).split(X, y, grp):
        cv_p[b] = mk().fit(X[a], y[a]).predict_proba(X[b])[:, 1]
    print(f"[5-fold 그룹 CV 전체] RF 균형정확도 {bal(y, (cv_p>=.5).astype(int)):.1%}  AUC {roc_auc_score(y, cv_p):.3f} | 규칙 {bal(y, (X[:,0]<52).astype(int)):.1%}")
    names = ["CVA", "귀앞", "귀위", "어깨기울기", "귀기울기", "어깨/기준", "얼굴/기준", "어깨/얼굴", "코세로", "코가로", "귀-어깨중심", "귀높이차", "귀vis", "어깨vis", "코vis", "코z", "귀z"]
    top = np.argsort(rf.feature_importances_)[::-1][:6]
    print("중요 특징:", ", ".join(f"{names[i]} {rf.feature_importances_[i]:.2f}" for i in top))
    joblib.dump(mk().fit(X, y), ROOT / "models/posture_rf.joblib")
