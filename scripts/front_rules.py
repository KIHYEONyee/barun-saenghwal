"""정면 웹캠용 개인 기준선 규칙 판정.
처음 몇 초 바른 자세로 앉아 기준값을 재고, 이후에는 '지금 값 - 기준값'으로 부위별 문제를 찾는다.
방향(오른쪽/왼쪽)은 거울 모드 화면 기준이다. 거울처럼 화면 오른쪽 = 사용자 오른쪽."""
import time
from math import atan2, degrees, hypot
import numpy as np

MIN_VIS = 0.5
NEED = (0, 7, 8, 11, 12)   # 코, 양 귀, 양 어깨가 보여야 판정
METRICS = ["shoulder_w", "ear_d", "face_ratio", "neck_h", "head_pitch", "head_roll", "shoulder_tilt", "head_shift", "chin_rest"]

# 기준값 대비 얼마나 달라지면 문제로 볼지. 직접 모은 데이터로 조정할 값들
TH = dict(
    turtle=1.10,      # 어깨 대비 얼굴 크기가 기준보다 10% 이상 커짐 → 머리만 앞으로 나옴
    close=1.25,       # 얼굴이 기준보다 25% 이상 커지고
    close_body=1.15,  # 어깨도 15% 이상 커짐 → 몸 전체가 화면에 다가옴
    head_down=0.15,   # 코가 귀보다 내려간 정도(귀 사이 거리 대비)의 증가량
    roll=8.0,         # 고개 기울기(도)
    tilt=5.0,         # 어깨선 기울기(도)
    shrug=0.82,       # 귀-어깨 세로 거리가 기준의 82% 미만
    shift=0.20,       # 코의 좌우 위치 변화(어깨 너비 대비)
    chin=0.35,        # 손목-입 거리(어깨 너비 대비)가 이보다 작으면 턱 괴기
)
CAUTION_SEC = 1.5   # 이보다 짧게 나타난 문제는 무시


def metrics(lm, w, h):
    """lm: (33,4) 정규화 좌표(x, y, z, visibility). 반환: 지표 dict, 얼굴·어깨가 안 보이면 None."""
    if min(lm[i, 3] for i in NEED) < MIN_VIS:
        return None
    P = lm[:, :2] * [w, h]
    dist = lambda a, b: hypot(*(a - b))
    by_x = lambda i, j: (P[i], P[j]) if P[i][0] <= P[j][0] else (P[j], P[i])   # (화면 왼쪽, 화면 오른쪽)
    sL, sR = by_x(11, 12)
    eL, eR = by_x(7, 8)
    sw, ed = dist(sL, sR), dist(eL, eR)
    if sw < 1 or ed < 1:
        return None
    smid, emid, nose, mouth = (sL + sR) / 2, (eL + eR) / 2, P[0], (P[9] + P[10]) / 2
    wrists = [P[i] for i in (15, 16) if lm[i, 3] > MIN_VIS]
    return dict(
        shoulder_w=sw,
        ear_d=ed,
        face_ratio=ed / sw,
        neck_h=(smid[1] - emid[1]) / sw,
        head_pitch=(nose[1] - emid[1]) / ed,
        head_roll=degrees(atan2(eR[1] - eL[1], eR[0] - eL[0])),       # + = 오른쪽 귀가 낮음(오른쪽으로 기울임)
        shoulder_tilt=degrees(atan2(sR[1] - sL[1], sR[0] - sL[0])),   # + = 오른쪽 어깨가 낮음
        head_shift=(nose[0] - smid[0]) / sw,                          # + = 오른쪽으로 치우침
        chin_rest=min(dist(p, mouth) for p in wrists) / sw if wrists else 9.0,
    )


def make_baseline(samples):
    """바른 자세 동안 모은 지표들로 기준값을 만든다. 반환: (기준값 dict 또는 None, 사유)."""
    if len(samples) < 15:
        return None, f"측정된 프레임이 {len(samples)}개뿐입니다. 얼굴과 어깨가 화면에 보이게 앉아 다시 측정하세요."
    A = np.array([[s[k] for k in METRICS] for s in samples])
    mean, std = A.mean(0), A.std(0)
    base = dict(zip(METRICS, mean))
    if base["face_ratio"] < 0.25:   # 양 귀가 겹쳐 보일 만큼 몸이 옆으로 돌아감. 정면이면 보통 0.35 이상
        return None, "몸이 옆으로 돌아가 있습니다. 카메라 정면을 보고 앉아 다시 측정하세요."
    if std[METRICS.index("head_roll")] > 3 or std[0] / mean[0] > 0.06:
        return None, "측정 중에 많이 움직였습니다. 가만히 바르게 앉아 다시 측정하세요."
    return base, f"기준 자세 저장 ({len(samples)}프레임)"


def detect_issues(m, base, t=TH):
    """지금 지표와 기준값을 비교해 문제 목록을 돌려준다. 항목: (부위, 키, 한글 안내, 영문 약칭)."""
    side = lambda v: "오른쪽" if v > 0 else "왼쪽"
    eng = lambda v: "R" if v > 0 else "L"
    out = []
    face_rel = m["face_ratio"] / base["face_ratio"]
    close_rel = m["ear_d"] / base["ear_d"]
    body_rel = m["shoulder_w"] / base["shoulder_w"]
    neck_rel = m["neck_h"] / base["neck_h"] if base["neck_h"] > 0 else 1.0
    roll = m["head_roll"] - base["head_roll"]
    tilt = m["shoulder_tilt"] - base["shoulder_tilt"]
    shift = m["head_shift"] - base["head_shift"]

    turtle = face_rel > t["turtle"]
    if turtle:
        out.append(("neck", "turtle", "목이 앞으로 나와 있어요", "TURTLE NECK"))
    elif close_rel > t["close"] and body_rel > t["close_body"]:
        out.append(("head", "close", "화면에 너무 가까워요", "TOO CLOSE"))
    head_down = m["head_pitch"] - base["head_pitch"] > t["head_down"]
    if head_down:
        out.append(("neck", "head_down", "고개를 숙이고 있어요", "HEAD DOWN"))
    if abs(roll) > t["roll"]:
        out.append(("head", "roll", f"고개가 {side(roll)}으로 기울어져 있어요", f"HEAD TILT {eng(roll)}"))
    if abs(tilt) > t["tilt"]:
        out.append(("shoulder", "tilt", f"{side(tilt)} 어깨가 내려가 있어요", f"SHOULDER {eng(tilt)} DOWN"))
    elif neck_rel < t["shrug"] and not turtle and not head_down:
        out.append(("shoulder", "shrug", "어깨가 올라가 있어요. 힘을 빼 보세요", "SHRUG"))
    if abs(shift) > t["shift"]:
        out.append(("torso", "lean", f"몸이 {side(shift)}으로 기울어져 있어요", f"LEAN {eng(shift)}"))
    if m["chin_rest"] < t["chin"]:
        out.append(("arm", "chin", "턱을 괴고 있어요", "CHIN REST"))
    return out


class IssueTracker:
    """문제가 잠깐 나타났다 사라지는 건 무시하고, 계속된 시간을 잰다."""
    def __init__(self):
        self.since = {}

    def update(self, issues, now=None):
        """반환: CAUTION_SEC 이상 계속된 문제의 [(항목, 지속 초)], 오래된 순."""
        now = time.time() if now is None else now
        keys = {i[1] for i in issues}
        self.since = {k: v for k, v in self.since.items() if k in keys}
        for k in keys:
            self.since.setdefault(k, now)
        shown = [(i, now - self.since[i[1]]) for i in issues if now - self.since[i[1]] >= CAUTION_SEC]
        return sorted(shown, key=lambda x: -x[1])

    def reset(self):
        self.since = {}
