import { useRef, useState } from "react";
import { explainExpression } from "../classifier/classifier.js";
import { useFaceLandmarker } from "../hooks/useFaceLandmarker.js";

const statusLabels = {
  loading: "카메라 준비 중",
  ready: "표정 캡처",
  error: "카메라 오류"
};

export function FloatingApp() {
  const { videoRef, status, error, rules, takeSnapshot } = useFaceLandmarker();
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const dragRef = useRef({ dragging: false, moved: false, x: 0, y: 0 });

  const handlePointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      dragging: true,
      moved: false,
      x: event.screenX,
      y: event.screenY
    };
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag.dragging) return;
    const x = event.screenX;
    const y = event.screenY;
    const deltaX = x - drag.x;
    const deltaY = y - drag.y;
    if (Math.abs(deltaX) + Math.abs(deltaY) >= 2) drag.moved = true;
    if (deltaX || deltaY) {
      window.faceMeme.moveFloatingWindow({ x: deltaX, y: deltaY });
      drag.x = x;
      drag.y = y;
    }
  };

  const handlePointerUp = async () => {
    const wasMoved = dragRef.current.moved;
    dragRef.current.dragging = false;
    if (wasMoved || isGenerating || status !== "ready" || !rules) return;

    const { snapshot, hasFace, capturedImage } = takeSnapshot();
    if (!hasFace) {
      window.faceMeme.logExpression({ type: "no-face" });
      setMessage("얼굴을 카메라에 보여주세요.");
      setTimeout(() => setMessage(""), 1800);
      return;
    }

    setIsGenerating(true);
    setMessage("밈 만드는 중");
    try {
      const explanation = explainExpression(snapshot, rules);
      const category = explanation.category;
      window.faceMeme.logExpression({
        type: "capture",
        category,
        scores: snapshot,
        failedRules: explanation.evaluations
          .filter((evaluation) => !evaluation.matched)
          .map((evaluation) => ({
            category: evaluation.category,
            failed: evaluation.failedConditions.map((condition) => condition.shape)
          }))
      });
      await window.faceMeme.createMeme({ category, snapshot, capturedImage });
      setMessage("");
    } catch (caughtError) {
      setMessage(caughtError?.message || "생성에 실패했어요.");
      setTimeout(() => setMessage(""), 2000);
    } finally {
      setIsGenerating(false);
    }
  };

  const visibleLabel = message || error || statusLabels[status];

  return (
    <main className="floating-shell">
      <video ref={videoRef} className="hidden-video" playsInline muted />
      <button
        type="button"
        className={`capture-button capture-button--${status} ${
          isGenerating ? "capture-button--working" : ""
        }`}
        aria-label={visibleLabel}
        title={visibleLabel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragRef.current.dragging = false;
        }}
      >
        <span className="camera-icon" aria-hidden="true">
          {status === "error" ? "!" : isGenerating ? "···" : "●"}
        </span>
      </button>
      {message && <span className="floating-message">{message}</span>}
    </main>
  );
}
