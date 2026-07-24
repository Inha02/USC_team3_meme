import axios from "axios";
import fs from "node:fs/promises";
import path from "node:path";

const API_URL = "https://api.jjalbot.com";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CATEGORIES = ["surprised", "laughing", "angry", "sad", "neutral"];
const searchKeywords = {
  surprised: ["엥", "?????", "개놀람"],
  laughing: ["ㅋㅋ", "웃김", "웃참", "폭소", "신나는"],
  angry: ["에바", "개화나네", "화나", "화난", "분노", "빡침", "정색"],
  sad: ["ㅜㅜ", "ㅠㅠ", "슬픔", "흑흑", "서러움", "슬픈", "우는", "눈물", "현타", "슬퍼" ],
  neutral: ["어쩔", "어쩌라고", "무표정", "멍", "어이없음", "덤덤"]
};

let templatePools = null;
let initializePromise = null;
const categoryIndexes = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));

function isUsableJjal(jjal) {
  const contentType = String(
    jjal?.type || jjal?.metadata?.contentType || ""
  ).toLowerCase();
  const hasStaticExtension = /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(
    jjal?.imageUrl || ""
  );
  const isAnimated =
    Boolean(jjal?.videoUrl) ||
    contentType.includes("gif") ||
    contentType.startsWith("video/") ||
    /\.gif(?:\?|$)/i.test(jjal?.imageUrl || "");
  return (
    jjal &&
    !jjal.nsfw &&
    !isAnimated &&
    typeof jjal.imageUrl === "string" &&
    jjal.imageUrl.startsWith("https://") &&
    (["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(contentType) ||
      hasStaticExtension)
  );
}

export function isExactTitleMatch(jjal, keyword) {
  const title = String(jjal?.title || "").normalize("NFC").toLowerCase();
  const normalizedKeyword = String(keyword).normalize("NFC").toLowerCase();
  if (jjal?.matchType !== "exact") return false;

  // 한글·영문·숫자 검색어는 제목의 독립된 단어와 정확히 같아야 합니다.
  // 예: "멍"은 "멍 때리기"에는 일치하지만 "콧구멍"에는 일치하지 않습니다.
  if (/^[\p{L}\p{N}]+$/u.test(normalizedKeyword)) {
    const titleWords = title.match(/[\p{L}\p{N}]+/gu) || [];
    return titleWords.includes(normalizedKeyword);
  }

  // 물음표 같은 기호 검색어는 동일한 기호 문자열이 있을 때만 허용합니다.
  return title.includes(normalizedKeyword);
}

function isExactCategoryTitleMatch(jjal, category) {
  return (searchKeywords[category] || []).some((keyword) =>
    isExactTitleMatch(jjal, keyword)
  );
}

async function searchKeyword(keyword) {
  console.log(`[jalBot] 검색 요청: "${keyword}"`);
  const response = await axios.get(`${API_URL}/jjals`, {
    params: { text: keyword, thumbnail: false, nsfw: false },
    timeout: 12000
  });
  if (!Array.isArray(response.data)) {
    throw new Error(`"${keyword}" 검색 응답이 배열이 아닙니다.`);
  }
  const results = response.data
    .filter(isUsableJjal)
    .filter((jjal) => isExactTitleMatch(jjal, keyword))
    .sort((left, right) => (right.views || 0) - (left.views || 0))
    .slice(0, 25);
  console.log(`[jalBot] 제목 정확 일치 결과: "${keyword}" → ${results.length}개`);
  return results;
}

async function buildCategoryPool(category) {
  const byId = new Map();
  for (const keyword of searchKeywords[category]) {
    try {
      const results = await searchKeyword(keyword);
      for (const jjal of results) {
        byId.set(String(jjal.shortId || jjal.id), {
          ...jjal,
          matchedKeyword: keyword
        });
      }
    } catch (error) {
      console.warn(`[jalBot] "${keyword}" 검색 실패:`, error.message);
    }
  }
  return [...byId.values()].sort((left, right) => (right.views || 0) - (left.views || 0));
}

async function loadCache(cacheFile) {
  try {
    const cache = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    const age = Date.now() - new Date(cache.generatedAt).getTime();
    if (cache.version !== 5 || age > CACHE_TTL_MS) return null;
    if (cache.keywordSignature !== JSON.stringify(searchKeywords)) return null;
    if (!CATEGORIES.every((category) => Array.isArray(cache.pools?.[category]))) {
      return null;
    }
    return Object.fromEntries(
      CATEGORIES.map((category) => [
        category,
        cache.pools[category].filter((jjal) =>
          isExactCategoryTitleMatch(jjal, category)
        )
      ])
    );
  } catch {
    return null;
  }
}

async function saveCache(cacheFile, pools) {
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(
    cacheFile,
    JSON.stringify(
      {
        version: 5,
        generatedAt: new Date().toISOString(),
        source: "jjalbot-search",
        keywords: searchKeywords,
        keywordSignature: JSON.stringify(searchKeywords),
        pools
      },
      null,
      2
    )
  );
}

export function initializeTemplates(projectRoot, cacheDirectory = path.join(projectRoot, "data")) {
  if (initializePromise) {
    console.log("[jalBot] 메모리에 캐시된 짤 후보 풀을 사용합니다.");
    return initializePromise;
  }

  initializePromise = (async () => {
    const cacheFile = path.join(cacheDirectory, "jjalBotMap.json");
    const cached = await loadCache(cacheFile);
    if (cached) {
      templatePools = cached;
      console.log(`[jalBot] 검색 JSON 캐시를 불러왔습니다: ${cacheFile}`);
    } else {
      console.log("[jalBot] 표정별 한국어 검색으로 짤 후보 풀을 만듭니다.");
      const entries = await Promise.all(
        CATEGORIES.map(async (category) => [category, await buildCategoryPool(category)])
      );
      templatePools = Object.fromEntries(entries);
      await saveCache(cacheFile, templatePools);
      console.log(`[jalBot] 검색 JSON 캐시를 저장했습니다: ${cacheFile}`);
    }

    console.log(
      `[jalBot] 카테고리 풀: ${CATEGORIES.map((category) => `${category}=${templatePools[category].length}`).join(", ")}`
    );
    return templatePools;
  })();
  return initializePromise;
}

function nextTemplate(category) {
  const categoryPool = (templatePools[category] || []).filter((jjal) =>
    isExactCategoryTitleMatch(jjal, category)
  );
  templatePools[category] = categoryPool;
  const pool = categoryPool;
  if (!pool?.length) return null;
  const index = categoryIndexes[category] % pool.length;
  categoryIndexes[category] += 1;
  const selected = pool[index];
  console.log(
    `[jalBot] 순환 선택: ${category} ${index + 1}/${pool.length} → ${selected.title} (${selected.shortId || selected.id}, 조회 ${selected.views || 0})`
  );
  return selected;
}

async function fallbackResult(category, projectRoot, reason) {
  const localPath = path.join(projectRoot, "assets", "fallback", `${category}.jpg`);
  let imageUrl = `file://${localPath}`;
  try {
    const image = await fs.readFile(localPath);
    imageUrl = `data:image/jpeg;base64,${image.toString("base64")}`;
  } catch {
    // 자산 준비 전이라면 file URL을 유지합니다.
  }
  return {
    imageUrl,
    pageUrl: null,
    localPath,
    isFallback: true,
    extension: "jpg",
    warning: reason
  };
}

function getImageExtension(jjal) {
  const contentType = String(
    jjal.type || jjal.metadata?.contentType || ""
  ).toLowerCase();
  if (contentType.includes("gif") || /\.gif(?:\?|$)/i.test(jjal.imageUrl)) return "gif";
  if (contentType.includes("webp") || /\.webp(?:\?|$)/i.test(jjal.imageUrl)) return "webp";
  if (contentType.includes("png") || /\.png(?:\?|$)/i.test(jjal.imageUrl)) return "png";
  return "jpg";
}

export async function createMemeImage(category, projectRoot, cacheDirectory) {
  await initializeTemplates(projectRoot, cacheDirectory);
  const jjal = nextTemplate(category);
  if (!jjal?.imageUrl) {
    console.warn(`[jalBot] ${category} 카테고리에 사용할 짤이 없습니다.`);
    return fallbackResult(
      category,
      projectRoot,
      "jalBot 검색 결과가 없어 로컬 이미지를 사용했어요."
    );
  }

  try {
    console.log(
      `[jalBot] 이미지 요청: category=${category}, title="${jjal.title}", url=${jjal.imageUrl}`
    );
    return {
      imageUrl: jjal.imageUrl,
      pageUrl: `https://jjalbot.com/jjals/${jjal.shortId}`,
      isFallback: false,
      extension: getImageExtension(jjal),
      templateName: jjal.title,
      source: "jjalbot"
    };
  } catch (error) {
    console.warn("[jalBot] 이미지 조회 실패:", error.message);
    console.warn(`[jalBot] ${category} 카테고리의 로컬 폴백 JPEG를 사용합니다.`);
    return fallbackResult(category, projectRoot, error.message);
  }
}

export function resetTemplateCacheForTests() {
  templatePools = null;
  initializePromise = null;
  for (const category of CATEGORIES) categoryIndexes[category] = 0;
}
