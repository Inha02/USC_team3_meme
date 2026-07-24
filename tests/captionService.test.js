import { describe, expect, it } from "vitest";
import { sanitizeCaption } from "../src/services/captionService.js";

describe("캡션 후처리", () => {
  it("따옴표와 줄바꿈을 제거한다", () => {
    expect(sanitizeCaption('"오늘도\n망했네"')).toBe("오늘도 망했네");
  });

  it("15자를 초과하는 출력은 자른다", () => {
    expect(sanitizeCaption("가나다라마바사아자차카타파하가나다").length).toBe(15);
  });
});
