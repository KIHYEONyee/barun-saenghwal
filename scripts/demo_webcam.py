"""웹캠 실시간 자세 데모. 사용: python scripts/demo_webcam.py [카메라번호] [--selftest]
키: v 정면/측면 전환 / q 종료 / s 스냅샷 저장 / [ ] 경고 임계값 조절 / n 다음 카메라로 전환(고른 카메라는 다음 실행 때도 먼저 사용) / d 기준 대비 수치 표시
정면 기준 자세: c=바르게 앉아 기준 자세 측정(CAL_SEC초). 측정 후 정면 모드는 기준 대비 변화로 부위별 판정
기준 자세는 data/out/front_baseline.json에 저장돼 같은 카메라면 다음 실행 때 다시 쓴다
데이터 수집: g=바른 자세 기록 시작, b=나쁜 자세 기록 시작, x=기록 중지 (영상은 저장하지 않고 특징 숫자는 data/out/mine.csv, 관절 좌표 원본은 data/out/mine_landmarks.csv에 저장)
기준 자세 측정 프레임의 관절 원본은 data/out/mine_baseline.csv에 저장. 같은 session 값으로 기록 데이터와 묶인다
옵션: --view front|side (수집 데이터에 붙는 촬영 방향 태그, 기본 front)"""
import sys, time
from pathlib import Path
import cv2, joblib, numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, str(Path(__file__).parent))
from train_rf import features
from posture_rules import cva
from front_rules import metrics as front_metrics, make_baseline, detect_issues, IssueTracker, smooth, save_baseline, load_baseline

ROOT = Path(__file__).resolve().parent.parent
args = [a for a in sys.argv[1:] if not a.startswith("--")]
SELFTEST = "--selftest" in sys.argv
VIEW = sys.argv[sys.argv.index("--view") + 1] if "--view" in sys.argv else "front"
args = [a for a in args if a not in ("front", "side")]
cam = int(args[0]) if args else None
SESSION = int(time.time())
MINE = ROOT / "data/out/mine.csv"
MINE_LM = ROOT / "data/out/mine_landmarks.csv"   # mine.csv와 같은 행 순서로 관절 원본 저장. 특징 계산이 바뀌어도 다시 계산할 수 있다
MINE_BASE = ROOT / "data/out/mine_baseline.csv"   # 기준 자세 측정 프레임의 관절 원본
BASE_FILE = ROOT / "data/out/front_baseline.json"  # 마지막 기준 자세(숫자만). 같은 카메라면 다음 실행 때 다시 쓴다
MINE.parent.mkdir(parents=True, exist_ok=True)
LM_HEADER = ",".join(f"{n}{i}" for i in range(33) for n in "xyzv")
rec, rec_n = None, 0   # rec: None / 0(좋음) / 1(나쁨)
CAL_SEC = 7            # 기준 자세 측정 시간(초)
WARN_SEC = 8           # 문제가 이보다 오래 계속되면 빨간색

def load_models():
    side = joblib.load(ROOT / "models/posture_rf.joblib")
    ff = ROOT / "models/posture_rf_front.joblib"
    return {"side": side, "front": joblib.load(ff) if ff.exists() else side}, ff.exists()
MODELS, HAS_FRONT = load_models()
det = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
    base_options=mpt.BaseOptions(model_asset_buffer=(ROOT / "models/pose_landmarker_full.task").read_bytes()),
    running_mode=vision.RunningMode.VIDEO))

def load_font(size):
    """OpenCV 글꼴은 한글을 못 그려서 시스템 한글 글꼴을 찾는다. 없으면 None(영문 표시로 대체)."""
    for f in ("/System/Library/Fonts/AppleSDGothicNeo.ttc", "C:/Windows/Fonts/malgun.ttf",
              "/usr/share/fonts/truetype/nanum/NanumGothic.ttf"):
        try: return ImageFont.truetype(f, size)
        except OSError: pass
    return None
FONT = load_font(26)

def draw_lines(frame, lines, x, y, gap=34):
    """lines: [(한글 문구, 영문 문구, BGR 색)]. 한글 글꼴이 있으면 한글, 없으면 영문으로 그린다."""
    if FONT is None:
        for i, (_, en, c) in enumerate(lines):
            cv2.putText(frame, en, (x, y + 24 + i * gap), cv2.FONT_HERSHEY_SIMPLEX, 0.75, c, 2)
        return frame
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(img)
    for i, (ko, _, c) in enumerate(lines):
        d.text((x, y + i * gap), ko, font=FONT, fill=(c[2], c[1], c[0]), stroke_width=3, stroke_fill=(0, 0, 0))
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

def open_cam(i):
    # CAP_DSHOW는 윈도우 전용. 맥(AVFoundation)·리눅스에서는 OpenCV 기본 백엔드를 쓴다
    c = cv2.VideoCapture(i, cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY)
    if not c.isOpened(): return None
    c.set(cv2.CAP_PROP_FRAME_WIDTH, 1280); c.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)   # 멀리 앉아도 관절이 잘 잡히게 고해상도 요청(지원 안 하면 무시됨)
    return c

CAM_FILE = ROOT / "data/out/camera.txt"   # 마지막으로 고른 카메라 번호. 맥은 아이폰 연속성 카메라 때문에 번호가 바뀌어 기억해 둔다
def remember_cam(i):
    try: CAM_FILE.write_text(str(i))
    except OSError: pass
def saved_cam():
    try: return int(CAM_FILE.read_text())
    except (OSError, ValueError): return None

def looks_real(c):
    """가상/차단 카메라는 단색 배경의 안내 화면을 내보낸다. 한 가지 색이 화면 대부분이면 실제 영상이 아니다."""
    f = None
    for _ in range(15): ok, f = c.read()
    if f is None or not ok: return False
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(float)
    return np.mean(np.abs(g - np.median(g)) < 6) < 0.7   # 한 가지 색이 70% 넘으면 안내 화면

def next_cam(cur, n=5):
    """cur 다음 번호부터 차례로 쓸 수 있는 실제 카메라를 찾는다. 반환: (캡처, 번호) 또는 (None, cur)."""
    for j in range(1, n + 1):
        i = (cur + j) % n
        c = open_cam(i)
        if c and looks_real(c): return c, i
        if c: c.release()
    return None, cur

cap = None
if cam is not None: remember_cam(cam)   # 번호를 직접 주면 다음부터 그 카메라를 먼저 쓴다
last = saved_cam()
order = [cam] if cam is not None else ([last] if last is not None else []) + [i for i in range(4) if i != last]
for i in order:
    c = open_cam(i)
    if c and (cam is not None or looks_real(c)):
        cap, cam = c, i; break
    if c: c.release()
if cap is None:
    sys.exit("사용할 수 있는 카메라를 찾지 못했습니다. 다른 앱이 쓰는 중인지, 카메라 번호를 직접 주고 실행해 보세요(예: python scripts/demo_webcam.py 1).")
print(f"카메라 {cam}번 사용. 원하는 카메라가 아니면 창에서 n 키로 다음 카메라로 바꿀 수 있습니다(아이폰 연속성 카메라 등).")

thr, ema, t0, bad_since = 0.5, None, time.time(), None
base, cal_until, cal_samples = None, None, []   # 정면 기준 자세
sm = None                                       # 떨림 완화한 정면 지표
base, saved_session = load_baseline(BASE_FILE, cam)
if base is not None:
    SESSION = saved_session or SESSION   # 이어서 기록하는 g/b 데이터가 저장된 기준과 같은 session으로 묶이게
    print("저장된 기준 자세를 불러왔습니다. 자리가 바뀌었으면 c로 다시 측정하세요.")
SHOW_NUM, numbers = False, ""                   # d 키: 기준 대비 수치 표시(문턱값 조정용)
tracker = IssueTracker()
flash = None   # 잠깐 띄울 안내 (한글, 영문, 색, 끝나는 시각)
UPPER = [(11, 12), (11, 13), (12, 14), (7, 11), (8, 12), (0, 7), (0, 8)]
print("카메라 시작. 'jasai posture demo' 창이 다른 창 뒤에 숨어 있을 수 있습니다. 종료는 창에서 q. 정면 모드에서는 먼저 c로 기준 자세를 측정하세요.")
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
    status, color, angle = "NO PERSON", (128, 128, 128), None
    notes = []   # 화면 왼쪽 아래에 그릴 안내 [(한글, 영문, 색)]
    numbers = ""
    if res.pose_landmarks:
        pl = res.pose_landmarks[0]
        lm = np.array([[p.x, p.y, p.z, p.visibility] for p in pl])
        feat = features(lm, w, h)
        p_bad = float(MODELS[VIEW].predict_proba(feat[None])[0, 1])
        m = front_metrics(lm, w, h)
        if cal_until is not None:   # 기준 자세 측정 중
            if m is not None:
                cal_samples.append(m)
                new = not MINE_BASE.exists()
                with open(MINE_BASE, "a", encoding="utf-8") as fh:
                    if new: fh.write("session,view,w,h," + LM_HEADER + "\n")
                    fh.write(f"{SESSION},{VIEW},{w},{h}," + ",".join(f"{v:.5f}" for v in lm.ravel()) + "\n")
        if rec is not None and frame_i % 3 == 0:   # 3프레임마다 1행 저장
            new = not MINE.exists()
            with open(MINE, "a", encoding="utf-8") as fh:
                if new: fh.write("session,view,label," + ",".join(f"f{i}" for i in range(len(feat))) + "\n")
                fh.write(f"{SESSION},{VIEW},{rec}," + ",".join(f"{v:.6f}" for v in feat) + "\n")
            new = not MINE_LM.exists()
            with open(MINE_LM, "a", encoding="utf-8") as fh:
                if new: fh.write("session,view,label,w,h," + LM_HEADER + "\n")
                fh.write(f"{SESSION},{VIEW},{rec},{w},{h}," + ",".join(f"{v:.5f}" for v in lm.ravel()) + "\n")
            rec_n += 1
        ema = p_bad if ema is None else 0.8 * ema + 0.2 * p_bad   # 떨림 완화
        angle, _ = cva([(p.x, p.y, p.visibility) for p in pl], w, h)
        if VIEW == "front" and base is not None and cal_until is None:
            # 정면 + 기준 자세 있음: 기준 대비 변화로 부위별 판정 (모델 확률은 참고로만 표시)
            if m is None:   # 귀·어깨가 잘 안 보여 판정할 수 없음. 바른 자세로 표시하지 않는다
                tracker.update([]); bad = False; sm = None
                status, color = "CAN'T SEE", (160, 160, 160)
                notes.append(("얼굴과 양 어깨가 잘 보이게 앉아주세요", "show face and both shoulders", (200, 200, 200)))
            else:
                sm = smooth(sm, m)   # 떨림 완화한 지표로 판정해 안내가 깜빡이지 않게
                shown = tracker.update(detect_issues(sm, base))
                bad = bool(shown)
                longest = shown[0][1] if shown else 0
                color = (0, 0, 255) if longest >= WARN_SEC else (0, 200, 255) if bad else (0, 200, 0)
                status = "BAD POSTURE" if bad else "GOOD"
                for (part, key, ko, en), dur in shown:
                    notes.append((f"{ko} ({dur:.0f}초)", f"{en} ({dur:.0f}s)", color))
                dist_rel = sm["shoulder_w"] / base["shoulder_w"]
                if not 0.75 < dist_rel < 1.35:   # 기준을 잰 거리와 많이 다름. 크기 비교가 틀어진다
                    notes.append((f"기준을 잰 거리와 달라요({dist_rel:.0%}). 이 자리에서 c로 다시 측정하세요",
                                  f"distance changed ({dist_rel:.0%}) - press c here", (0, 255, 255)))
                if SHOW_NUM:
                    numbers = (f"roll {sm['head_roll'] - base['head_roll']:+.1f}  tilt {sm['shoulder_tilt'] - base['shoulder_tilt']:+.1f}  "
                               f"face {sm['face_ratio'] / base['face_ratio'] - 1:+.0%}  size {sm['ear_d'] / base['ear_d'] - 1:+.0%}  "
                               f"pitch {sm['head_pitch'] - base['head_pitch']:+.2f}  neck {sm['neck_h'] / base['neck_h'] - 1:+.0%}  "
                               f"shift {sm['head_shift'] - base['head_shift']:+.2f}")
        else:
            bad = ema >= thr
            status, color = ("BAD POSTURE", (0, 0, 255)) if bad else ("GOOD", (0, 200, 0))
        bad_since = (bad_since or time.time()) if bad else None
        for a, b in UPPER:
            cv2.line(frame, (int(lm[a, 0] * w), int(lm[a, 1] * h)), (int(lm[b, 0] * w), int(lm[b, 1] * h)), color, 2)
        cv2.rectangle(frame, (10, 110), (210, 130), (60, 60, 60), -1)
        cv2.rectangle(frame, (10, 110), (10 + int(200 * ema), 130), color, -1)
        cv2.line(frame, (10 + int(200 * thr), 105), (10 + int(200 * thr), 135), (255, 255, 255), 2)
    else:
        ema, bad_since, sm = None, None, None
        tracker.update([])
    if cal_until is not None and time.time() >= cal_until:   # 측정 끝: 사람이 안 보였던 프레임은 빼고 기준값 계산
        base, msg = make_baseline(cal_samples)
        cal_until, sm = None, None; tracker.reset(); print(msg)
        if base is not None: save_baseline(BASE_FILE, base, SESSION, cam)
        flash = ("기준 자세 저장 완료", "baseline saved", (0, 200, 0), time.time() + 3) if base is not None else \
                (msg.split(".")[0], "calibration failed - press c again", (0, 0, 255), time.time() + 5)
    if cal_until is not None:
        bad_since = None
        left = max(0, cal_until - time.time())
        status, color = "CALIBRATING", (255, 200, 0)
        notes = [(f"바르게 앉아 계세요... {left:.0f}초", f"sit up straight... {left:.0f}s", (255, 200, 0))]
    elif VIEW == "front" and base is None:
        notes.append(("c 키: 기준 자세 측정 (지금은 측면 모델로 판정 중)", "press c to calibrate (side model now)", (0, 255, 255)))
    cv2.putText(frame, status, (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.1, color, 3)
    model_txt = "model" if VIEW == "front" and base is not None else "bad prob"
    cv2.putText(frame, f"{model_txt} {ema:.2f} (thr {thr:.2f})" if ema is not None else f"{model_txt} -", (10, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    cv2.putText(frame, f"CVA {angle:.0f} deg" if angle is not None and VIEW == "side" else "CVA -", (10, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    tag = VIEW.upper() + (" (baseline)" if VIEW == "front" and base is not None else "" if VIEW == "side" or HAS_FRONT else " (side model)")
    cv2.putText(frame, f"CAM {cam}  VIEW: {tag}  [v: switch, n: camera, c: calibrate, d: numbers]", (10, h - 50), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 0), 2)
    if numbers:
        cv2.putText(frame, numbers, (10, h - 80), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
    if bad_since and time.time() - bad_since > 5:
        cv2.putText(frame, f"bad for {time.time() - bad_since:.0f}s - sit up!", (10, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
    if flash and time.time() < flash[3]:
        notes.insert(0, flash[:3])
    if notes:
        frame = draw_lines(frame, notes, 10, 150)
    if rec is not None:
        cv2.circle(frame, (w - 30, 30), 10, (0, 0, 255), -1)
        cv2.putText(frame, f"REC {'BAD' if rec else 'GOOD'} {rec_n}", (w - 200, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
    if SELFTEST:
        print("selftest ok:", status, ema, angle); break
    cv2.imshow("jasai posture demo (q: quit)", frame)
    k = cv2.waitKey(1) & 0xFF
    if k == ord("q"):
        print("q 입력으로 종료합니다."); break
    if cv2.getWindowProperty("jasai posture demo (q: quit)", cv2.WND_PROP_VISIBLE) < 1:
        print("창이 닫혀 종료합니다."); break
    if k == ord("["): thr = max(0.1, thr - 0.05)
    if k == ord("]"): thr = min(0.95, thr + 0.05)
    if k == ord("v"):
        VIEW = "side" if VIEW == "front" else "front"; ema, bad_since, rec, cal_until, sm = None, None, None, None, None
        tracker.reset()
        print(f"모드 전환: {VIEW}" + ("" if VIEW == "side" or HAS_FRONT or base is not None else " (정면 기준 자세가 없어 측면 모델로 판정. c로 측정하세요)"))
    if k == ord("d"):
        SHOW_NUM = not SHOW_NUM
    if k == ord("c") and cal_until is not None:
        pass   # 측정 중에 또 누르면 무시(처음부터 다시 시작되지 않게)
    elif k == ord("c"):
        if VIEW != "front":
            print("기준 자세 측정은 정면 모드에서만 합니다. v로 정면 모드로 바꾸세요.")
        else:
            SESSION = int(time.time())   # 기준 자세 하나에 세션 하나. 이후 g/b 기록이 이 기준과 묶인다
            cal_until, cal_samples, base, rec, sm = time.time() + CAL_SEC, [], None, None, None
            print(f"기준 자세 측정 시작: {CAL_SEC}초 동안 바르게 앉아 계세요 (session={SESSION})")
    if k == ord("n"):
        c2, i2 = next_cam(cam)
        if c2 is None:
            print("다른 카메라를 찾지 못했습니다.")
        else:
            cap.release(); cap, cam = c2, i2; remember_cam(cam)
            ema, bad_since, rec, cal_until, sm = None, None, None, None, None
            tracker.reset()
            base, saved_session = load_baseline(BASE_FILE, cam)   # 이 카메라로 잰 기준이 저장돼 있으면 다시 씀
            if base is not None: SESSION = saved_session or SESSION
            print(f"카메라 {cam}번으로 전환." + (" 저장된 기준 자세를 불러왔습니다." if base is not None else " 이 카메라는 기준 자세가 없어 c로 측정해야 합니다."))
    if k == ord("g"):
        rec = 0; print(f"바른 자세 기록 시작 (view={VIEW})" + ("" if VIEW == "side" or base is not None else " — 정면 기준 자세 없이 기록 중. 먼저 c로 측정하면 기준과 함께 저장됩니다"))
    if k == ord("b"):
        rec = 1; print(f"나쁜 자세 기록 시작 (view={VIEW})" + ("" if VIEW == "side" or base is not None else " — 정면 기준 자세 없이 기록 중. 먼저 c로 측정하면 기준과 함께 저장됩니다"))
    if k == ord("x") and rec is not None: rec = None; print(f"기록 중지. 이번 세션 누적 {rec_n}행 -> {MINE}")
    if k == ord("s"): cv2.imencode(".jpg", frame)[1].tofile(str(ROOT / f"data/out/snap_{int(time.time())}.jpg")); print("saved")
cap.release(); cv2.destroyAllWindows()
