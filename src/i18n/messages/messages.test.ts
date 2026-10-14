import { describe, expect, it } from "vitest";
import en from "./en";
import es from "./es";
import ca from "./ca";
import fr from "./fr";
import { pickLocale, translate } from "./index";

/** Every leaf of the messages, by its dotted key. */
function leaves(node: object, prefix = ""): Array<[string, string]> {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === "string" ? [[prefix + key, value] as [string, string]] : leaves(value, `${prefix}${key}.`)
  );
}

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe("translations", () => {
  // The types already require the same keys; a renamed or dropped {placeholder}
  // only shows up at runtime, as a raw "{message}" in the window.
  it.each(Object.entries({ es, ca, fr }))("%s uses the same placeholders as English", (_locale, messages) => {
    const theirs = new Map(leaves(messages));
    for (const [key, text] of leaves(en)) {
      expect(placeholders(theirs.get(key) ?? ""), key).toEqual(placeholders(text));
    }
  });

  it("fills placeholders in", () => {
    expect(translate("en", "session.sessionSize", { size: "4 MB" })).toBe("Session size: 4 MB");
  });
});

describe("pickLocale", () => {
  it("takes the first supported language", () => {
    expect(pickLocale(["de-DE", "ca-ES", "es"])).toBe("ca");
    expect(pickLocale(["de-DE"])).toBe("en");
  });
});
