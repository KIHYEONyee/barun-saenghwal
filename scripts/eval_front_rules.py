"""정면 기준선 규칙(front_rules)을 MultiPosture 데이터로 평가하고 문턱값을 고른다.
사용: python scripts/eval_front_rules.py            현재 TH, K_STD로 평가
      python scripts/eval_front_rules.py --sweep    문턱값 조합을 바꿔가며 비교(앞 7명으로 고르고 뒤 6명으로 확인)
데이터: data/multiposture/data.csv (https://zenodo.org/records/14230872)
주의: 이 데이터는 엉덩이 중심의 실제 거리(미터) 좌표라 카메라에 다가가도 얼굴이 커지지 않는다.
그래서 각도 판정(고개·어깨 기울어짐)과 바른 자세 오탐은 잴 수 있지만, 거북목·화면 가까워짐은 잴 수 없다."""
import sys
from itertools import product
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).parent))
import front_rules as fr

ROOT = Path(__file__).resolve().parent.parent
J = ["nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer", "left_ear", "right_ear",
     "mouth_left", "mouth_right", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
     "left_pinky", "right_pinky", "left_index", "right_index", "left_thumb", "right_thumb", "left_hip", "right_hip",
     "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel", "right_heel", "left_foot_index", "right_foot_index"]
SCALE = 1000   # 미터 → 밀리미터. metrics()가 1 미만 길이를 무시하므로


def load():
    """사람별 (기준값, 평가 프레임 [(라벨, 지표)]). 기준은 바른 자세(TUP) 프레임의 앞 절반, 평가는 나머지."""
    d = pd.read_csv(ROOT / "data/multiposture/data.csv")
    X = np.stack([-d[[f"{j}_x" for j in J]].to_numpy(), d[[f"{j}_y" for j in J]].to_numpy()], -1)   # x를 뒤집어 거울 화면과 같은 방향으로
    out = {}
    for s in sorted(d.subject.unique()):
        idx = np.flatnonzero(d.subject.to_numpy() == s)
        labels = d.upperbody_label.to_numpy()[idx]
        ms = []
        for i in idx:
            lm = np.ones((33, 4)); lm[:, :2] = X[i]
            lm[[15, 16], 3] = 0.0   # 손 위치는 상체 라벨과 무관해서 턱 괴기 판정은 끔
            ms.append(fr.metrics(lm, SCALE, SCALE))
        tup = np.flatnonzero(labels == "TUP")
        cal, rest = tup[: len(tup) // 2], np.setdiff1d(np.arange(len(idx)), tup[: len(tup) // 2])
        A = np.array([[ms[i][k] for k in fr.METRICS] for i in cal])
        base = dict(zip(fr.METRICS, A.mean(0))); base["_std"] = dict(zip(fr.METRICS, A.std(0)))
        out[s] = (base, [(labels[i], ms[i]) for i in rest])
    return out


def score(data, subjects, th, k):
    """반환: 바른 자세 정답률, 좌우 기울어짐 방향 정답률, 앞으로 숙임 감지율."""
    tup, lr, tlf = [], [], []
    for s in subjects:
        base, frames = data[s]
        for lab, m in frames:
            iss = fr.detect_issues(m, base, th, k)
            if lab == "TUP":
                tup.append(not iss)
            elif lab in ("TLL", "TLR"):
                want = "왼쪽" if lab == "TLL" else "오른쪽"
                lr.append(any(i[1] in ("tilt", "roll", "lean") and want in i[2] for i in iss))
            elif lab == "TLF":
                tlf.append(bool(iss))
    return np.mean(tup), np.mean(lr), np.mean(tlf)


def report(name, r):
    print(f"{name}: 바른 자세 정답 {r[0]:.0%} | 좌우 기울어짐 방향 정답 {r[1]:.0%} | 앞으로 숙임 감지 {r[2]:.0%}")


if __name__ == "__main__":
    data = load()
    subs = list(data)
    report(f"현재 설정 (K_STD={fr.K_STD}, 13명)", score(data, subs, fr.TH, fr.K_STD))
    if "--sweep" in sys.argv:
        pick, check = [int(s) for s in subs[:7]], [int(s) for s in subs[7:]]
        grid = []
        for roll, tilt, shrug, down, k in product((8, 10, 12), (5, 6, 7, 8), (0.82, 0.78, 0.74), (0.15, 0.20), (0, 2, 3)):
            th = dict(fr.TH, roll=roll, tilt=tilt, shrug=shrug, head_down=down)
            r = score(data, pick, th, k)
            grid.append((r, roll, tilt, shrug, down, k))
        # 좌우 기울어짐 감지 95% 이상을 지키면서 바른 자세 정답률이 가장 높은 조합
        ok = sorted([g for g in grid if g[0][1] >= 0.95], key=lambda g: (-g[0][0], -g[0][1]))
        print(f"\n[고르기: 사람 {pick}] 좌우 감지 95% 이상 중 바른 자세 정답 상위 5개")
        for r, roll, tilt, shrug, down, k in ok[:5]:
            print(f"  roll {roll}° tilt {tilt}° shrug {shrug} head_down {down} K_STD {k} → 바른 {r[0]:.0%} / 좌우 {r[1]:.0%} / 숙임 {r[2]:.0%}")
        r, roll, tilt, shrug, down, k = ok[0]
        th = dict(fr.TH, roll=roll, tilt=tilt, shrug=shrug, head_down=down)
        print(f"\n[확인: 고를 때 안 쓴 사람 {check}]")
        report("  현재 설정", score(data, check, fr.TH, fr.K_STD))
        report("  고른 설정", score(data, check, th, k))
        report("[13명 전체] 고른 설정", score(data, subs, th, k))
