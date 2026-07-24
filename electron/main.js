import { app, BrowserWindow, dialog, ipcMain, screen, session } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import { createMemeImage, initializeTemplates } from "../src/services/jjalbotService.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");

const isDevelopment = !app.isPackaged;
let floatingWindow = null;
let resultWindow = null;
let latestMeme = null;
let latestCategory = "neutral";
let isGenerating = false;

function getRendererUrl(route = "") {
  if (isDevelopment) {
    return `http://127.0.0.1:5173/${route}`;
  }
  return `file://${path.join(projectRoot, "dist", "index.html")}${route ? `#${route}` : ""}`;
}

function createFloatingWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  floatingWindow = new BrowserWindow({
    width: 60,
    height: 60,
    x: workArea.x + workArea.width - 80,
    y: workArea.y + workArea.height - 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  floatingWindow.setAlwaysOnTop(true, "floating");
  floatingWindow.loadURL(getRendererUrl());
  floatingWindow.on("closed", () => {
    floatingWindow = null;
  });
}

function createResultWindow() {
  if (resultWindow && !resultWindow.isDestroyed()) {
    resultWindow.show();
    resultWindow.focus();
    return;
  }

  resultWindow = new BrowserWindow({
    width: 440,
    height: 720,
    minWidth: 380,
    minHeight: 620,
    show: false,
    title: "MemeCam 결과",
    backgroundColor: "#17171c",
    webPreferences: {
      preload: path.join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  resultWindow.loadURL(getRendererUrl("result"));
  resultWindow.once("ready-to-show", () => resultWindow?.show());
  resultWindow.on("closed", () => {
    resultWindow = null;
  });
}

async function generateMeme(category, capturedImage = null) {
  if (isGenerating) {
    throw new Error("이미 밈을 만들고 있어요.");
  }
  isGenerating = true;
  try {
    latestCategory = category;
    const meme = await createMemeImage(
      category,
      projectRoot,
      app.getPath("userData")
    );
    latestMeme = {
      ...meme,
      category,
      capturedImage,
      createdAt: Date.now()
    };
    createResultWindow();
    resultWindow?.webContents.send("meme:updated", latestMeme);
    return latestMeme;
  } finally {
    isGenerating = false;
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "media";
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });

  createFloatingWindow();
  initializeTemplates(projectRoot, app.getPath("userData")).catch((error) => {
    console.warn("jalBot 짤 초기화 실패, 로컬 이미지를 사용합니다:", error.message);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createFloatingWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("meme:create", async (_event, payload) => {
  const allowed = new Set(["surprised", "laughing", "angry", "sad", "neutral"]);
  const category = allowed.has(payload?.category) ? payload.category : "neutral";
  const capturedImage =
    typeof payload?.capturedImage === "string" &&
    payload.capturedImage.startsWith("data:image/jpeg;base64,") &&
    payload.capturedImage.length <= 2_500_000
      ? payload.capturedImage
      : null;
  return generateMeme(category, capturedImage);
});

ipcMain.handle("meme:regenerate", () =>
  generateMeme(latestCategory, latestMeme?.capturedImage || null)
);
ipcMain.handle("meme:get-latest", () => latestMeme);

ipcMain.handle("meme:download", async () => {
  if (!latestMeme?.imageUrl) return { canceled: true, reason: "저장할 밈이 없습니다." };
  const defaultPath = path.join(
    app.getPath("downloads"),
    `memecam-${latestMeme.category}-${Date.now()}.${latestMeme.extension || "jpg"}`
  );
  const selection = await dialog.showSaveDialog(resultWindow, {
    title: "밈 이미지 저장",
    defaultPath,
    filters: [{ name: "이미지", extensions: ["jpg", "jpeg", "png", "webp"] }]
  });
  if (selection.canceled || !selection.filePath) return { canceled: true };

  if (latestMeme.localPath) {
    console.log(`[jalBot] 로컬 합성 이미지를 저장합니다: ${selection.filePath}`);
    await fs.copyFile(latestMeme.localPath, selection.filePath);
  } else {
    console.log(`[jalBot] 생성 이미지를 다운로드합니다: ${latestMeme.imageUrl}`);
    const response = await axios.get(latestMeme.imageUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      maxContentLength: 15 * 1024 * 1024
    });
    await fs.writeFile(selection.filePath, response.data);
    console.log(`[jalBot] 이미지 저장 완료: ${selection.filePath}`);
  }
  return { canceled: false, filePath: selection.filePath };
});

ipcMain.on("result:close", () => resultWindow?.close());
ipcMain.on("expression:log", (_event, payload) => {
  const allowedTypes = new Set(["capture", "no-face"]);
  if (!allowedTypes.has(payload?.type)) return;

  if (payload.type === "no-face") {
    console.log("[표정 인식] 얼굴을 찾는 중...");
    return;
  }

  const relevantShapes = [
    "eyeWideLeft",
    "eyeWideRight",
    "jawOpen",
    "mouthSmileLeft",
    "mouthSmileRight",
    "cheekSquintLeft",
    "browDownLeft",
    "browDownRight",
    "mouthFrownLeft",
    "browInnerUp"
  ];
  const safeScores = Object.fromEntries(
    relevantShapes.map((name) => [
      name,
      Number(payload.scores?.[name] || 0).toFixed(2)
    ])
  );
  const category = payload.category ? ` → 판정: ${payload.category}` : "";
  console.log(`[표정 인식] 클릭 스냅샷${category}`, safeScores);
  if (payload.type === "capture" && Array.isArray(payload.failedRules)) {
    const failedSummary = payload.failedRules
      .slice(0, 4)
      .map((rule) => `${rule.category}: ${rule.failed.join(", ")}`)
      .join(" | ");
    if (failedSummary) {
      console.log(`[표정 인식] 미충족 조건 → ${failedSummary}`);
    }
  }
});
ipcMain.on("floating:move", (_event, delta) => {
  if (!floatingWindow || floatingWindow.isDestroyed()) return;
  const [x, y] = floatingWindow.getPosition();
  const nextX = x + Math.round(Number(delta?.x) || 0);
  const nextY = y + Math.round(Number(delta?.y) || 0);
  const display = screen.getDisplayNearestPoint({ x: nextX, y: nextY });
  const area = display.workArea;
  floatingWindow.setPosition(
    Math.min(Math.max(nextX, area.x), area.x + area.width - 60),
    Math.min(Math.max(nextY, area.y), area.y + area.height - 60)
  );
});
