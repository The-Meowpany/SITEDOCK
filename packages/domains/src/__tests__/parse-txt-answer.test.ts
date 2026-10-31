import { describe, it, expect } from "vitest";
import { parseTxtAnswer } from "../infrastructure/dns-resolver";

describe("parseTxtAnswer", () => {
  it("joins split quoted strings", () => {
    expect(parseTxtAnswer('"abc" "def"')).toBe("abcdef");
  });
  it("unescapes quotes and backslashes", () => {
    expect(parseTxtAnswer('"a\\"b\\\\c"')).toBe('a"b\\c');
  });
  it("falls back to trimming quotes when nothing is terminated", () => {
    expect(parseTxtAnswer('"unterminated')).toBe("unterminated");
  });
  it("handles hostile input with many unmatched quotes in linear time", () => {
    const hostile = '"'.repeat(200_000);
    const start = Date.now();
    parseTxtAnswer(hostile);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
