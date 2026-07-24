import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const fallbackDir = path.join(projectRoot, "assets", "fallback");
const mediaPipeDir = path.join(projectRoot, "public", "mediapipe");
const wasmSource = path.join(
  projectRoot,
  "node_modules",
  "@mediapipe",
  "tasks-vision",
  "wasm"
);

await fs.mkdir(fallbackDir, { recursive: true });
await fs.mkdir(path.join(mediaPipeDir, "wasm"), { recursive: true });

const themes = {
  surprised: [255, 193, 71],
  laughing: [255, 91, 133],
  angry: [218, 55, 67],
  sad: [70, 119, 201],
  neutral: [116, 112, 129]
};

for (const [category, color] of Object.entries(themes)) {
  const width = 640;
  const height = 480;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const shade = Math.max(0.45, 1 - Math.hypot(x - width / 2, y - height / 2) / 520);
      data[offset] = color[0] * shade;
      data[offset + 1] = color[1] * shade;
      data[offset + 2] = color[2] * shade;
      data[offset + 3] = 255;
    }
  }
  const image = jpeg.encode({ data, width, height }, 82);
  await fs.writeFile(path.join(fallbackDir, `${category}.jpg`), image.data);
}

try {
  await fs.cp(wasmSource, path.join(mediaPipeDir, "wasm"), { recursive: true });
  const modelUrl =
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await fs.writeFile(
    path.join(mediaPipeDir, "face_landmarker.task"),
    Buffer.from(await response.arrayBuffer())
  );
  console.log("MediaPipe 로컬 자산과 폴백 이미지를 준비했습니다.");
} catch (error) {
  console.warn(
    "MediaPipe 로컬 자산 준비에 실패했습니다. 실행 시 CDN을 사용합니다:",
    error.message
  );
}
