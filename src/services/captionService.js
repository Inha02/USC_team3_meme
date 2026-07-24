import OpenAI from "openai";

const labels = {
  surprised: "놀란",
  laughing: "폭소하는",
  angry: "화난",
  sad: "울상/현타 온",
  neutral: "무표정인"
};

const fallbackCaptions = {
  surprised: ["이게 된다고?", "잠깐만 뭐라고?", "실화냐 진짜"],
  laughing: ["참을 수가 없네", "또 시작이네", "개웃기네 진짜"],
  angry: ["선 넘었네", "진짜 화난다", "딱 기다려"],
  sad: ["내 인생 왜 이래", "현타 제대로네", "눈물만 난다"],
  neutral: ["아무 생각 없다", "그냥 그렇다고", "퇴근만 기다림"]
};

function fallbackCaption(category) {
  const options = fallbackCaptions[category] || fallbackCaptions.neutral;
  return options[Math.floor(Math.random() * options.length)];
}

function sanitizeCaption(value) {
  return String(value || "")
    .replace(/^["'“”]|["'“”]$/g, "")
    .replace(/[\r\n]/g, " ")
    .trim()
    .slice(0, 15);
}

function createLlmClient() {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL = process.env.LLM_BASE_URL;
  const model =
    process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) return null;
  return {
    client: new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL: baseURL.replace(/\/+$/, "") } : {}),
      timeout: 30000
    }),
    model
  };
}

export async function createCaption(category) {
  const llm = createLlmClient();
  if (!llm) return fallbackCaption(category);

  try {
    const prompt = `사용자가 방금 ${labels[category] || labels.neutral} 표정을 지었다. 밈 스타일의 짧고 재치있는 한국어 캡션 1개만 만들어줘. 반말, 15자 이내, 설명 없이 캡션 텍스트만 출력.`;
    // Gateway와 공식 OpenAI가 공통 지원하는 Chat Completions 형식을 사용합니다.
    const response = await llm.client.chat.completions.create({
      model: llm.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 40,
      temperature: 0.9
    });
    const content = response.choices?.[0]?.message?.content;
    return sanitizeCaption(content) || fallbackCaption(category);
  } catch (error) {
    console.warn("LLM 캡션 생성 실패, 기본 캡션을 사용합니다:", error.message);
    return fallbackCaption(category);
  }
}

export { fallbackCaption, sanitizeCaption };
