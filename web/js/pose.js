// 웹캠 + MediaPipe Pose Landmarker 연결
import {
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export async function createPoseLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  try {
    return await PoseLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    return await PoseLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

// fps 만큼만 분석 (CPU·배터리 절약). onResult(landmarks | null, timeMs)
export function runLoop(video, landmarker, fps, onResult) {
  let last = 0;
  let stopped = false;
  const tick = (now) => {
    if (stopped) return;
    if (now - last >= 1000 / fps && video.readyState >= 2) {
      last = now;
      const result = landmarker.detectForVideo(video, now);
      onResult(result.landmarks?.[0] ?? null, now);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => (stopped = true);
}
