import { useCallback, useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import {
  categoriesToShapeMap,
  createExpressionBuffer
} from "../classifier/classifier.js";

const REMOTE_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const REMOTE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

async function loadRules() {
  const response = await fetch("./config/expressionRules.json");
  if (!response.ok) throw new Error("표정 규칙을 불러오지 못했습니다.");
  return response.json();
}

async function createLandmarker() {
  let vision;
  try {
    vision = await FilesetResolver.forVisionTasks("./mediapipe/wasm");
  } catch {
    vision = await FilesetResolver.forVisionTasks(REMOTE_WASM);
  }

  const options = {
    baseOptions: {
      modelAssetPath: "./mediapipe/face_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    outputFaceBlendshapes: true,
    numFaces: 1
  };

  try {
    return await FaceLandmarker.createFromOptions(vision, options);
  } catch {
    return FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: REMOTE_MODEL, delegate: "CPU" }
    });
  }
}

export function useFaceLandmarker() {
  const videoRef = useRef(null);
  const bufferRef = useRef(null);
  const streamRef = useRef(null);
  const animationRef = useRef(null);
  const landmarkerRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [rules, setRules] = useState(null);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const loadedRules = await loadRules();
        if (!active) return;
        setRules(loadedRules);
        bufferRef.current = createExpressionBuffer(loadedRules);

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user"
          },
          audio: false
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        landmarkerRef.current = await createLandmarker();
        if (!active) return;
        setStatus("ready");

        const analyze = () => {
          if (!active) return;
          const video = videoRef.current;
          if (
            video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            video.currentTime !== lastVideoTimeRef.current
          ) {
            lastVideoTimeRef.current = video.currentTime;
            const result = landmarkerRef.current.detectForVideo(video, performance.now());
            const categories = result.faceBlendshapes?.[0]?.categories;
            if (categories?.length) {
              const shapes = categoriesToShapeMap(categories);
              bufferRef.current.addFrame(shapes);
              // 개발자 도구에서 52종 blendshape 값을 확인할 수 있습니다.
              if (import.meta.env.DEV) console.debug("blendshape", shapes);
            }
          }
          animationRef.current = requestAnimationFrame(analyze);
        };
        analyze();
      } catch (caughtError) {
        console.error(caughtError);
        if (!active) return;
        setStatus("error");
        setError(
          caughtError?.name === "NotAllowedError"
            ? "카메라 권한이 필요해요."
            : "표정 인식을 시작하지 못했어요."
        );
      }
    }

    initialize();
    return () => {
      active = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      landmarkerRef.current?.close();
    };
  }, []);

  const takeSnapshot = useCallback(() => {
    const hasFace = bufferRef.current?.hasFaceData();
    const video = videoRef.current;
    let capturedImage = null;

    if (hasFace && video?.videoWidth && video?.videoHeight) {
      const maxWidth = 640;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext("2d");

      if (context) {
        // 사용자가 거울을 보는 방향과 같도록 좌우 반전해 저장합니다.
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        capturedImage = canvas.toDataURL("image/jpeg", 0.82);
      }
    }

    return {
      snapshot: hasFace ? bufferRef.current.snapshot() : {},
      hasFace: Boolean(hasFace),
      capturedImage
    };
  }, []);

  return { videoRef, status, error, rules, takeSnapshot };
}
