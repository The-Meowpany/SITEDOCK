import { describe, expect, it } from "vitest";
import { en, es, catalogues, SUPPORTED_LOCALES } from "./messages";
import { matchLocale, translate } from "./index";

describe("i18n catalogue", () => {
  it("has exactly the same keys in every locale", () => {
    const base = Object.keys(en).sort();
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(catalogues[locale]).sort()).toEqual(base);
    }
  });

  it("uses the same placeholders in every locale for each key", () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(placeholders(es[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("has no empty messages", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of Object.entries(catalogues[locale])) {
        expect(value.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("translate", () => {
  it("interpolates placeholders", () => {
    expect(translate("en", "members.removed", { name: "Ana" })).toBe("Ana was removed from the workspace.");
    expect(translate("es", "members.removed", { name: "Ana" })).toBe("Ana fue quitado del workspace.");
  });

  it("leaves unknown placeholders visible instead of hiding the gap", () => {
    expect(translate("en", "members.removed")).toContain("{name}");
    expect(translate("en", "members.removed", { other: "x" })).toContain("{name}");
  });
});

describe("matchLocale", () => {
  it("maps regional tags to supported locales and rejects the rest", () => {
    expect(matchLocale("es-UY")).toBe("es");
    expect(matchLocale("es_AR")).toBe("es");
    expect(matchLocale("EN-us")).toBe("en");
    expect(matchLocale("fr-FR")).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
    expect(matchLocale("")).toBeNull();
  });
});
