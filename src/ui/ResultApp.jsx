import { useEffect, useState } from "react";
import logoUrl from "../assets/facememe-logo.png";

const categoryLabels = {
  surprised: "놀람",
  laughing: "폭소",
  angry: "화남",
  sad: "울상/현타",
  neutral: "무표정"
};

export function ResultApp() {
  const [meme, setMeme] = useState(null);
  const [status, setStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    window.faceMeme.getLatestMeme().then(setMeme);
    return window.faceMeme.onMemeUpdated(setMeme);
  }, []);

  const regenerate = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setStatus("새 밈을 만들고 있어요.");
    try {
      const nextMeme = await window.faceMeme.regenerateMeme();
      setMeme(nextMeme);
      setStatus("");
    } catch (error) {
      setStatus(error?.message || "다시 만들지 못했어요.");
    } finally {
      setIsBusy(false);
    }
  };

  const download = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setStatus("저장 위치를 선택해 주세요.");
    try {
      const result = await window.faceMeme.downloadMeme();
      setStatus(result.canceled ? "" : "저장했어요!");
    } catch (error) {
      setStatus(error?.message || "이미지를 저장하지 못했어요.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="result-shell">
      <header className="result-header">
        <div className="brand-lockup">
          <img className="brand-logo" src={logoUrl} alt="facememe 로고" />
          <div>
            <p className="eyebrow">FACEMEME</p>
            <h1>FACE IT, MEME IT</h1>
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="닫기"
          onClick={() => window.faceMeme.closeResult()}
        >
          ×
        </button>
      </header>

      {meme ? (
        <>
          {meme.capturedImage && (
            <section className="captured-expression">
              <img src={meme.capturedImage} alt="버튼을 누른 순간 캡처된 표정" />
              <div>
                <span>캡처된 표정</span>
                <strong>{categoryLabels[meme.category] || "무표정"}</strong>
              </div>
            </section>
          )}
          <section className="meme-card">
            <img src={meme.imageUrl} alt={`${categoryLabels[meme.category]} 표정 밈`} />
            <div className="meme-meta">
              <span>{categoryLabels[meme.category] || "무표정"}</span>
              <strong>{meme.templateName || "추천 짤"}</strong>
            </div>
          </section>
          {meme.warning && <p className="warning">{meme.warning}</p>}
        </>
      ) : (
        <section className="empty-card">밈을 불러오는 중이에요.</section>
      )}

      <p className="result-status" aria-live="polite">
        {status}
      </p>
      <footer className="result-actions">
        <button type="button" className="secondary-button" onClick={regenerate} disabled={isBusy}>
          다시 생성
        </button>
        <button type="button" className="primary-button" onClick={download} disabled={isBusy || !meme}>
          다운로드
        </button>
      </footer>
    </main>
  );
}
