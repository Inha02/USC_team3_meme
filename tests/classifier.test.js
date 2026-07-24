import { describe, expect, it, vi } from "vitest";
import rules from "../public/config/expressionRules.json";
import {
  averageShapes,
  classifyExpression,
  createExpressionBuffer
} from "../src/classifier/classifier.js";

describe("표정 분류기", () => {
  it("여러 조건이 겹치면 높은 우선순위인 놀람을 선택한다", () => {
    const result = classifyExpression(
      {
        eyeWideLeft: 0.8,
        eyeWideRight: 0.9,
        jawOpen: 0.7,
        mouthSmileLeft: 0.9,
        mouthSmileRight: 0.9,
        cheekSquintLeft: 0.8
      },
      rules
    );
    expect(result).toBe("surprised");
  });

  it("양쪽 미소가 강하면 cheekSquint가 낮아도 폭소로 판정한다", () => {
    expect(
      classifyExpression(
        {
          mouthSmileLeft: 0.78,
          mouthSmileRight: 0.83,
          cheekSquintLeft: 0
        },
        rules
      )
    ).toBe("laughing");
  });

  it("민감 모드에서는 임계값과 정확히 같아도 조건을 만족한다", () => {
    expect(
      classifyExpression(
        { browDownLeft: 0.01, browInnerDistanceDelta: -0.015 },
        rules
      )
    ).toBe("angry");
  });

  it("눈썹을 내려도 눈썹 사이가 가까워지지 않으면 화남이 아니다", () => {
    expect(
      classifyExpression(
        { browDownLeft: 0.2, browDownRight: 0.2, browInnerDistanceDelta: 0 },
        rules
      )
    ).toBe("neutral");
  });

  it("안쪽 눈썹 상승과 입꼬리 내림이 함께 있으면 울상이다", () => {
    expect(
      classifyExpression(
        { browInnerUp: 0.3, mouthFrownRight: 0.1 },
        rules
      )
    ).toBe("sad");
  });

  it("반올림 전 0.7 미만인 미소도 민감하게 폭소로 판정한다", () => {
    expect(
      classifyExpression(
        {
          mouthSmileLeft: 0.73,
          mouthSmileRight: 0.696,
          cheekSquintLeft: 0
        },
        rules
      )
    ).toBe("laughing");
  });

  it("한쪽 미소만 반응해도 고감도 폭소로 판정한다", () => {
    expect(
      classifyExpression(
        { mouthSmileLeft: 0.36, mouthSmileRight: 0.02 },
        rules
      )
    ).toBe("laughing");
  });

  it("놀람 조건 세 개 중 두 개만 반응해도 판정한다", () => {
    expect(
      classifyExpression(
        { eyeWideLeft: 0.07, eyeWideRight: 0.01, jawOpen: 0.11 },
        rules
      )
    ).toBe("surprised");
  });

  it("누락된 blendshape는 0으로 취급한다", () => {
    expect(classifyExpression({}, rules)).toBe("neutral");
  });

  it("프레임 평균을 계산한다", () => {
    expect(averageShapes([{ jawOpen: 0.2 }, { jawOpen: 0.8 }]).jawOpen).toBeCloseTo(0.5);
  });

  it("0.5초보다 오래된 프레임은 스냅샷에서 제외한다", () => {
    vi.stubGlobal("performance", { now: () => 1000 });
    const buffer = createExpressionBuffer({ ...rules, frameSmoothingCount: 1 });
    buffer.addFrame({ jawOpen: 1 }, 100);
    buffer.addFrame({ jawOpen: 0.2 }, 900);
    expect(buffer.snapshot(1000).jawOpen).toBeCloseTo(0.2);
    vi.unstubAllGlobals();
  });
});
