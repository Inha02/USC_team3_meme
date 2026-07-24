import { describe, expect, it } from "vitest";
import { isExactTitleMatch } from "../src/services/jjalbotService.js";

describe("jalBot 제목 정확 일치 필터", () => {
  it("exact 결과의 제목에 검색어가 그대로 있으면 통과한다", () => {
    expect(
      isExactTitleMatch(
        { title: "레전드 우는 장면", matchType: "exact" },
        "우는"
      )
    ).toBe(true);
  });

  it("semantic 결과는 제목에 검색어가 있어도 제외한다", () => {
    expect(
      isExactTitleMatch(
        { title: "레전드 우는 장면", matchType: "semantic" },
        "우는"
      )
    ).toBe(false);
  });

  it("제목에 검색어가 없으면 제외한다", () => {
    expect(
      isExactTitleMatch(
        { title: "레전드 우는 장면", matchType: "exact" },
        "무표정"
      )
    ).toBe(false);
  });

  it("멍은 콧구멍의 일부이므로 정확한 단어 일치에서 제외한다", () => {
    expect(
      isExactTitleMatch(
        {
          title: "레전드 우는 장면 입벌리고 김래원 콧구멍",
          matchType: "exact"
        },
        "멍"
      )
    ).toBe(false);
  });

  it("독립된 멍 단어는 정확히 일치한다", () => {
    expect(
      isExactTitleMatch(
        { title: "멍 때리는 무표정 짤", matchType: "exact" },
        "멍"
      )
    ).toBe(true);
  });
});
