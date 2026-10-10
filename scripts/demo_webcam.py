"""웹캠 실시간 자세 데모. 사용: python scripts/demo_webcam.py [카메라번호] [--view front|side] [--selftest]
키: v 정면/측면 전환 / c 정면 기준선 채증(바른 자세로 12초) / q 종료 / s 스냅샷 / [ ] 측면 모델 임계값
정면 모드: 내 바른 자세 기준선 대비 변화로 판정(규칙). 처음 한 번 c로 기준선을 잡는다(data/out/baseline_front.json에 숫자만 저장).
측면 모드: 학습한 Random Forest로 판정.
데이터 수집: g=바른 자세 기록 시작, b=나쁜 자세 기록 시작, x=기록 중지 (영상은 저장하지 않고 특징 숫자만 data/out/mine.csv에 저장)"""
import sys, time
from pathlib import Path
import cv2, joblib, numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision
sys.path.insert(0, str(Path(__file__).parent))
from train_rf import features
from posture_rules import cva
from front_rules import front_features, Baseline

ROOT = Path(__file__).resolve().parent.parent
args = [a for a in sys.argv[1:] if not a.startswith("--")]
SELFTEST = "--selftest" in sys.argv
VIEW = sys.argv[sys.argv.index("--view") + 1] if "--view" in sys.argv else "front"
args = [a for a in args if a not in ("front", "side")]
cam = int(args[0]) if args else None   # 번호를 안 주면 자동 선택
SESSION = int(time.time())
MINE = ROOT / "data/out/mine.csv"
BASE_FILE = ROOT / "data/out/baseline_front.json"
CAL_SECS = 12
rec, rec_n = None, 0   # rec: None / 0(좋음) / 1(나쁨)

def load_models():
    side = joblib.load(ROOT / "models/posture_rf.joblib")
    ff = ROOT / "models/posture_rf_front.joblib"
    return {"side": side, "front": joblib.load(ff) if ff.exists() else side}, ff.exists()
MODELS, HAS_FRONT = load_models()
det = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
    base_options=mpt.BaseOptions(model_asset_buffer=(ROOT / "models/pose_landmarker_full.task").read_bytes()),
    running_mode=vision.RunningMode.VIDEO))

def open_cam(i):
    c = cv2.VideoCapture(i, cv2.CAP_DSHOW)
    return c if c.isOpened() else None

def looks_real(c):
    """가상/차단 카메라는 단색 배경의 안내 화면을 내보낸다. 한 가지 색이 화면 대부분이면 실제 영상이 아니다."""
    f = None
    for _ in range(15): ok, f = c.read()
    if f is None or not ok: return False
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(float)
    return np.mean(np.abs(g - np.median(g)) < 6) < 0.7   # 한 가지 색이 70% 넘으면 안내 화면

cap = None
for i in ([cam] if cam is not None else range(4)):
    c = open_cam(i)
    if c and (cam is not None or looks_real(c)):
        cap, cam = c, i; break
    if c: c.release()
if cap is None:
    sys.exit("사용할 수 있는 카메라를 찾지 못했습니다. 다른 앱이 쓰는 중인지, 카메라 번호를 직접 주고 실행해 보세요(예: python scripts/demo_webcam.py 1).")
print(f"카메라 {cam}번 사용")

base = Baseline.load(BASE_FILE)
calib, calib_t0, sff = None, 0.0, None   # calib: 채증 중이면 특징 리스트
thr, ema, t0, bad_since = 0.5, None, time.time(), None
UPPER = [(11, 12), (11, 13), (12, 14), (7, 11), (8, 12), (0, 7), (0, 8)]
GREEN, RED, YEL, GRAY = (0, 200, 0), (0, 0, 255), (0, 220, 255), (128, 128, 128)
print("카메라 시작. 'jasai posture demo' 창이 다른 창 뒤에 숨어 있을 수 있습니다. 종료는 창에서 q.")
if VIEW == "front" and not base.ready:
    print("정면 기준선이 없습니다. 바른 자세로 앉아 c 키를 누르세요(12초).")
fails = 0
frame_i = 0
while True:
    frame_i += 1
    ok, frame = cap.read()
    if not ok:
        fails += 1
        if fails > 60:
            print("카메라에서 프레임을 읽지 못해 종료합니다. 다른 앱이 카메라를 쓰는지, 카메라 번호(0/1)를 확인하세요.")
            break
        time.sleep(0.05); continue
    fails = 0
    frame = cv2.flip(frame, 1)                       # 거울 모드
    h, w = frame.shape[:2]
    res = det.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)), int((time.time() - t0) * 1000))
    status, color, angle, issues, info = "NO PERSON", GRAY, None, [], ""
    if res.pose_landmarks:
        pl = res.pose_landmarks[0]
        lm = np.array([[p.x, p.y, p.z, p.visibility] for p in pl])
        feat = features(lm, w, h)
        if rec is not None and frame_i % 3 == 0:   # 3프레임마다 1행 저장
            new = not MINE.exists()
            with open(MINE, "a", encoding="utf-8") as fh:
                if new: fh.write("session,view,label," + ",".join(f"f{i}" for i in range(len(feat))) + "\n")
                fh.write(f"{SESSION},{VIEW},{rec}," + ",".join(f"{v:.6f}" for v in feat) + "\n")
            rec_n += 1
        bad = False
        if VIEW == "front":
            ff = front_features(lm, w, h)
            if calib is not None:                      # 기준선 채증 중
                if ff is not None: calib.append(ff)
                left = CAL_SECS - (time.time() - calib_t0)
                status, color, info = f"CALIBRATING {max(left, 0):.0f}s", YEL, "sit straight, look at screen"
                if left <= 0:
                    if len(calib) >= 30:
                        base = Baseline().fit(calib); base.save(BASE_FILE)
                        shaky = base.stability()
                        print("기준선 저장 완료." + (f" 움직임이 커서 불안정: {shaky} -> 다시 c 권장" if shaky else ""))
                    else:
                        print("어깨와 얼굴이 충분히 안 보여 기준선을 못 만들었습니다. 다시 c.")
                    calib, sff = None, None
            elif not base.ready:
                status, color, info = "PRESS C TO CALIBRATE", YEL, "sit straight, then press c (12s)"
            elif ff is None:
                status, color, info = "SHOW BOTH SHOULDERS", GRAY, ""
            else:
                sff = ff if sff is None else 0.7 * sff + 0.3 * ff      # 떨림 완화
                issues = base.judge(sff)
                bad = bool(issues)
                status, color = ("BAD POSTURE", RED) if bad else ("GOOD", GREEN)
        else:
            p_bad = float(MODELS["side"].predict_proba(feat[None])[0, 1])
            ema = p_bad if ema is None else 0.8 * ema + 0.2 * p_bad
            angle, _ = cva([(p.x, p.y, p.visibility) for p in pl], w, h)
            bad = ema >= thr
            status, color = ("BAD POSTURE", RED) if bad else ("GOOD", GREEN)
            info = f"bad prob {ema:.2f} (thr {thr:.2f})   CVA {angle:.0f} deg" if angle is not None else f"bad prob {ema:.2f}"
            cv2.rectangle(frame, (10, 110), (210, 130), (60, 60, 60), -1)
            cv2.rectangle(frame, (10, 110), (10 + int(200 * ema), 130), color, -1)
            cv2.line(frame, (10 + int(200 * thr), 105), (10 + int(200 * thr), 135), (255, 255, 255), 2)
        bad_since = (bad_since or time.time()) if bad else None
        for a, b in UPPER:
            cv2.line(frame, (int(lm[a, 0] * w), int(lm[a, 1] * h)), (int(lm[b, 0] * w), int(lm[b, 1] * h)), color, 2)
    else:
        ema, bad_since, sff = None, None, None
    cv2.putText(frame, status, (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.1, color, 3)
    cv2.putText(frame, info, (10, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    for n, (en, ko, sev) in enumerate(issues[:3]):
        cv2.putText(frame, f"- {en} ({sev:.1f}x)", (10, 105 + 25 * n), cv2.FONT_HERSHEY_SIMPLEX, 0.6, RED, 2)
    cv2.putText(frame, f"VIEW: {VIEW.upper()}  [v: switch" + ("  c: calibrate]" if VIEW == "front" else "]"), (10, h - 50), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
    if bad_since and time.time() - bad_since > 5:
        cv2.putText(frame, f"bad for {time.time() - bad_since:.0f}s - sit up!", (10, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.8, RED, 2)
    if rec is not None:
        cv2.circle(frame, (w - 30, 30), 10, RED, -1)
        cv2.putText(frame, f"REC {'BAD' if rec else 'GOOD'} {rec_n}", (w - 200, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.7, RED, 2)
    if SELFTEST:
        print("selftest ok:", status, [i[0] for i in issues], ema, angle); break
    cv2.imshow("jasai posture demo (q: quit)", frame)
    k = cv2.waitKey(1) & 0xFF
    if k == ord("q"):
        print("q 입력으로 종료합니다."); break
    if cv2.getWindowProperty("jasai posture demo (q: quit)", cv2.WND_PROP_VISIBLE) < 1:
        print("창이 닫혀 종료합니다."); break
    if k == ord("["): thr = max(0.1, thr - 0.05)
    if k == ord("]"): thr = min(0.95, thr + 0.05)
    if k == ord("v"):
        VIEW = "side" if VIEW == "front" else "front"; ema, bad_since, sff, rec, calib = None, None, None, None, None
        print(f"모드 전환: {VIEW}" + (" (기준선이 없으면 c로 채증)" if VIEW == "front" and not base.ready else ""))
    if k == ord("c"):
        if VIEW != "front": print("c 는 정면 모드(v로 전환)에서만 쓸 수 있습니다.")
        else: calib, calib_t0, rec = [], time.time(), None; print(f"기준선 채증 시작: {CAL_SECS}초 동안 바른 자세로 화면을 보세요.")
    if k == ord("g"): rec = 0; print(f"바른 자세 기록 시작 (view={VIEW})")
    if k == ord("b"): rec = 1; print(f"나쁜 자세 기록 시작 (view={VIEW})")
    if k == ord("x") and rec is not None: rec = None; print(f"기록 중지. 이번 세션 누적 {rec_n}행 -> {MINE}")
    if k == ord("s"): cv2.imencode(".jpg", frame)[1].tofile(str(ROOT / f"data/out/snap_{int(time.time())}.jpg")); print("saved")
cap.release(); cv2.destroyAllWindows()
