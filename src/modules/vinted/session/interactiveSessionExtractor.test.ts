import { describe, expect, it } from "vitest";
import { abnormalExit } from "./interactiveSessionExtractor";

describe("abnormalExit", () => {
  it("treats the user closing the window as normal", () => {
    expect(abnormalExit({ code: 0, signal: null, runMs: 40_000 })).toBeNull();
    expect(abnormalExit(null)).toBeNull();
  });

  it("reports Firefox being killed, e.g. by macOS refusing to run it", () => {
    expect(abnormalExit({ code: null, signal: "SIGKILL", runMs: 300 })).toBe("killed by SIGKILL after 0.3s");
  });

  it("reports a failing exit code, however long it ran", () => {
    expect(abnormalExit({ code: 1, signal: null, runMs: 60_000 })).toBe("exit code 1 after 60.0s");
  });

  it("reports a clean exit too soon for anyone to have used the window", () => {
    expect(abnormalExit({ code: 0, signal: null, runMs: 1_200 })).toBe("quit after 1.2s");
  });
});
