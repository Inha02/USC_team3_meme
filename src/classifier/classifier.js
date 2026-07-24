export function averageShapes(frames) {
  if (!frames.length) return {};
  const totals = {};
  for (const frame of frames) {
    for (const [name, score] of Object.entries(frame)) {
      totals[name] = (totals[name] || 0) + (Number(score) || 0);
    }
  }
  return Object.fromEntries(
    Object.entries(totals).map(([name, total]) => [name, total / frames.length])
  );
}

export function createExpressionBuffer(config) {
  const rawFrames = [];
  const smoothedFrames = [];

  function addFrame(shapes, timestamp = performance.now()) {
    rawFrames.push(shapes);
    while (rawFrames.length > config.frameSmoothingCount) rawFrames.shift();

    smoothedFrames.push({ timestamp, shapes: averageShapes(rawFrames) });
    const oldestAllowed = timestamp - config.windowMs;
    while (smoothedFrames[0]?.timestamp < oldestAllowed) smoothedFrames.shift();
  }

  function snapshot(timestamp = performance.now()) {
    const recent = smoothedFrames
      .filter((frame) => frame.timestamp >= timestamp - config.windowMs)
      .map((frame) => frame.shapes);
    return averageShapes(recent);
  }

  return {
    addFrame,
    snapshot,
    hasFaceData: () => smoothedFrames.length > 0,
    clear: () => {
      rawFrames.length = 0;
      smoothedFrames.length = 0;
    }
  };
}

function matchesCondition(score, condition) {
  const value = score[condition.shape] || 0;
  if (condition.operator === ">") return value > condition.threshold;
  if (condition.operator === ">=") return value >= condition.threshold;
  return false;
}

export function classifyExpression(snapshot, config) {
  return explainExpression(snapshot, config).category;
}

export function explainExpression(snapshot, config) {
  const sortedRules = [...config.rules].sort((a, b) => a.priority - b.priority);
  const evaluations = sortedRules.map((rule) => {
    const matchedConditions = rule.conditions.filter((condition) =>
      matchesCondition(snapshot, condition)
    );
    const failedConditions = rule.conditions.filter(
      (condition) => !matchesCondition(snapshot, condition)
    );
    const optionalMatches = (rule.optionalConditions || []).filter((condition) =>
      matchesCondition(snapshot, condition)
    );
    return {
      category: rule.category,
      matched:
        matchedConditions.length >=
        (rule.minMatches ?? rule.conditions.length),
      matchedCount: matchedConditions.length,
      requiredCount: rule.minMatches ?? rule.conditions.length,
      failedConditions,
      optionalMatches
    };
  });
  const match = evaluations.find((evaluation) => evaluation.matched);
  return {
    category: match?.category || config.defaultCategory,
    evaluations
  };
}

export function categoriesToShapeMap(categories = []) {
  return Object.fromEntries(
    categories.map((category) => [category.categoryName, category.score])
  );
}
