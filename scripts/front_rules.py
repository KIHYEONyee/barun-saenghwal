"""정면 웹캠용 자세 판정. 학습 모델 대신 '내 바른 자세 기준선 대비 변화'로 판정한다(기획서 5장 개인화 방식).
정면에서는 머리가 앞으로 나온 정도를 직접 잴 수 없어서, 얼굴/어깨 크기 비율 같은 간접 값을 쓴다."""
import json
from math import atan2, degrees
from pathlib import Path
import numpy as np

NAMES = ["face_ratio", "sw_frac", "face_frac", "shoulder_tilt", "head_tilt", "nose_drop", "ear_sh", "head_shift"]

# (특징 이름, 부호, 임계값, 한글 메시지, 영문 메시지) 부호: +1 기준보다 커지면 문제, -1 작아지면 문제, 0 절댓값 차이
# 크기 관련 특징(REL)은 기준값 대비 비율(0.10 = 10%), 나머지는 절대 차이(각도는 °, 길이는 어깨너비 단위)
# 임계값은 일반적인 웹캠 거리에서 잡은 초기값이다. 기준선 흔들림(std)이 크면 3*std로 자동으로 넓어진다.
REL = {"face_ratio", "sw_frac"}
RULES = [
    ("face_ratio", +1, 0.10, "고개가 앞으로 나옴(거북목 의심)", "head forward"),
    ("sw_frac", +1, 0.10, "화면에 너무 가까움", "too close to screen"),
    ("shoulder_tilt", 0, 4.0, "어깨가 기울어짐", "shoulders uneven"),
    ("head_tilt", 0, 7.0, "고개가 기울어짐", "head tilted"),
    ("nose_drop", +1, 0.10, "고개를 숙임/구부정", "head down / slouching"),
    ("ear_sh", -1, 0.08, "어깨가 올라감(으쓱)", "shoulders raised"),
    ("head_shift", 0, 0.12, "머리가 한쪽으로 쏠림", "head shifted sideways"),
]

def _tilt(a, b):
    """두 점을 잇는 선의 수평 대비 각도(°)를 -90~90으로 정규화."""
    d = degrees(atan2(b[1] - a[1], b[0] - a[0]))
    return (d + 90) % 180 - 90

def front_features(lm, w, h):
    """lm: (33,4) 정규화 좌표. 양 어깨와 얼굴이 보이는 정면 기준 특징 8개. 판정 불가면 None."""
    if min(lm[11, 3], lm[12, 3], lm[0, 3]) < 0.5:
        return None
    P = lm[:, :2] * [w, h]
    sw = np.linalg.norm(P[11] - P[12])
    if sw < 1e-6:
        return None
    mid = (P[11] + P[12]) / 2
    ear_mid = (P[7] + P[8]) / 2
    face = np.linalg.norm(P[7] - P[8])           # 귀 사이 거리(머리 폭)
    return np.array([
        face / sw,                                # 머리 대비 어깨: 머리만 앞으로 오면 커짐
        sw / w,                                   # 어깨가 화면에서 차지하는 비율: 몸 전체가 가까워지면 커짐
        face / w,
        _tilt(P[11], P[12]),
        _tilt(P[7], P[8]),
        (P[0, 1] - mid[1]) / sw,                  # 어깨선 대비 코 높이(음수일수록 코가 위)
        (mid[1] - ear_mid[1]) / sw,               # 어깨선 대비 귀 높이
        (P[0, 0] - mid[0]) / sw,                  # 코가 어깨 중심에서 좌우로 벗어난 정도
    ])

class Baseline:
    def __init__(self, mean=None, std=None):
        self.mean, self.std = mean, std

    @property
    def ready(self):
        return self.mean is not None

    def fit(self, feats):
        F = np.array(feats)
        self.mean = F.mean(0)
        self.std = F.std(0)
        return self

    def stability(self):
        """기준선 채증 중 흔들림이 큰 특징 이름들(다시 채증 권장)."""
        rel = self.std[[0, 1]] / np.abs(self.mean[[0, 1]])
        return [NAMES[i] for i, r in zip((0, 1), rel) if r > 0.06]

    def judge(self, f):
        """f: front_features 결과. 반환: [(영문, 한글, 심각도 1.0=임계값)] 심각도 순."""
        if not self.ready or f is None:
            return []
        out = []
        for name, sign, thr, ko, en in RULES:
            i = NAMES.index(name)
            d, sd = f[i] - self.mean[i], self.std[i]
            if name in REL:
                d, sd = d / abs(self.mean[i]), sd / abs(self.mean[i])
            lim = max(thr, 3 * sd)
            bad = d > lim if sign > 0 else d < -lim if sign < 0 else abs(d) > lim
            if bad:
                out.append((en, ko, abs(d) / lim))
        # 몸 전체가 가까워지면 sw_frac만, 머리만 나오면 face_ratio만 뜬다. 둘 다 뜨면 몸을 숙이며 머리까지 나온 것.
        return sorted(out, key=lambda t: -t[2])

    def save(self, path):
        Path(path).write_text(json.dumps({"mean": self.mean.tolist(), "std": self.std.tolist()}))

    @classmethod
    def load(cls, path):
        p = Path(path)
        if not p.exists():
            return cls()
        d = json.loads(p.read_text())
        return cls(np.array(d["mean"]), np.array(d["std"]))
