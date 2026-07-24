import axios from "axios";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const API_URL = "https://api.jjalbot.com";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CATEGORIES = ["surprised", "laughing", "angry", "sad", "neutral"];
const searchKeywords = {
  surprised: ["놀란", "당황", "충격", "대박"],
  laughing: ["웃긴", "폭소", "신나는", "웃는"],
  angry: ["화난", "분노", "빡침", "정색"],
  sad: ["슬픈", "우는", "눈물", "현타"],
  neutral: ["무표정", "멍", "어이없음", "덤덤"]
};

let templatePools = null;
let initializePromise = null;
const categoryIndexes = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function renderKoreanCaption(imageUrl, caption, cacheDirectory, category) {
  const response = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 15000,
    maxContentLength: 20 * 1024 * 1024
  });
  const input = Buffer.from(response.data);
  const image = sharp(input, { animated: false });
  const metadata = await image.metadata();
  const width = metadata.width || 640;
  const height = metadata.height || 640;
  const fontSize = Math.max(28, Math.min(64, Math.round(width / 10)));
  const strokeWidth = Math.max(4, Math.round(fontSize / 8));
  const overlay = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="${fontSize + 22}" text-anchor="middle"
        font-family="Apple SD Gothic Neo, Malgun Gothic, Noto Sans CJK KR, sans-serif"
        font-size="${fontSize}" font-weight="900"
        fill="white" stroke="black" stroke-width="${strokeWidth}"
        paint-order="stroke fill" stroke-linejoin="round">${escapeXml(caption)}</text>
    </svg>
  `);
  const output = await image
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
  const outputDirectory = path.join(cacheDirectory, "generated");
  await fs.mkdir(outputDirectory, { recursive: true });
  const localPath = path.join(
    outputDirectory,
    `memecam-${category}-${Date.now()}.jpg`
  );
  await fs.writeFile(localPath, output);
  return {
    localPath,
    imageUrl: `data:image/jpeg;base64,${output.toString("base64")}`
  };
}

function isUsableJjal(jjal) {
  const imageResource = jjal?.resources?.find(
    (resource) =>
      resource.url === jjal.imageUrl &&
      String(resource.contentType || "").startsWith("image/")
  );
  const imageExtension = /\.(?:jpe?g|png|webp|gif)(?:\?|$)/i.test(jjal?.imageUrl || "");
  return (
    jjal &&
    !jjal.nsfw &&
    typeof jjal.imageUrl === "string" &&
    jjal.imageUrl.startsWith("https://") &&
    (String(jjal.type || jjal.metadata?.contentType || "").startsWith("image/") ||
      Boolean(imageResource) ||
      imageExtension)
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
    .sort((left, right) => (right.views || 0) - (left.views || 0))
    .slice(0, 25);
  console.log(`[jalBot] 검색 결과: "${keyword}" → ${results.length}개`);
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
    if (cache.version !== 1 || age > CACHE_TTL_MS) return null;
    if (!CATEGORIES.every((category) => Array.isArray(cache.pools?.[category]))) {
      return null;
    }
    return cache.pools;
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
        version: 1,
        generatedAt: new Date().toISOString(),
        source: "jjalbot-search",
        keywords: searchKeywords,
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
  const pool = templatePools[category]?.length
    ? templatePools[category]
    : templatePools.neutral;
  if (!pool?.length) return null;
  const index = categoryIndexes[category] % pool.length;
  categoryIndexes[category] += 1;
  const selected = pool[index];
  console.log(
    `[jalBot] 순환 선택: ${category} ${index + 1}/${pool.length} → ${selected.title} (${selected.shortId || selected.id}, 조회 ${selected.views || 0})`
  );
  return selected;
}

async function fallbackResult(category, caption, projectRoot, reason) {
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
    caption,
    warning: reason
  };
}

export async function createMemeImage(category, caption, projectRoot, cacheDirectory) {
  await initializeTemplates(projectRoot, cacheDirectory);
  const jjal = nextTemplate(category);
  if (!jjal?.imageUrl) {
    console.warn(`[jalBot] ${category} 카테고리에 사용할 짤이 없습니다.`);
    return fallbackResult(
      category,
      caption,
      projectRoot,
      "jalBot 검색 결과가 없어 로컬 이미지를 사용했어요."
    );
  }

  try {
    console.log(
      `[jalBot] 이미지 요청: category=${category}, title="${jjal.title}", url=${jjal.imageUrl}`
    );
    const rendered = await renderKoreanCaption(
      jjal.imageUrl,
      caption,
      cacheDirectory,
      category
    );
    console.log(`[jalBot] 한글 캡션 합성 완료: ${rendered.localPath}`);
    return {
      imageUrl: rendered.imageUrl,
      pageUrl: `https://jjalbot.com/jjals/${jjal.shortId}`,
      localPath: rendered.localPath,
      isFallback: false,
      isLocalGenerated: true,
      caption,
      templateName: jjal.title,
      source: "jjalbot"
    };
  } catch (error) {
    console.warn("[jalBot] 이미지 조회 또는 합성 실패:", error.message);
    console.warn(`[jalBot] ${category} 카테고리의 로컬 폴백 JPEG를 사용합니다.`);
    return fallbackResult(category, caption, projectRoot, error.message);
  }
}

export function resetTemplateCacheForTests() {
  templatePools = null;
  initializePromise = null;
  for (const category of CATEGORIES) categoryIndexes[category] = 0;
}
