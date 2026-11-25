import { describe, expect, it } from "vitest";
import { caseKey } from "./index";

describe("caseKey", () => {
  it("maps a case path to its bucket key", () => {
    expect(caseKey("/cases/kits-00002/ct/0001.dcm")).toBe("cases/kits-00002/ct/0001.dcm");
    expect(caseKey("/cases/index.json")).toBe("cases/index.json");
  });

  it("refuses anything that could reach outside the cases", () => {
    expect(caseKey("/cases/../secret")).toBeNull();
    expect(caseKey("/cases/%2e%2e/secret")).toBeNull();
    expect(caseKey("/cases//x")).toBeNull();
    expect(caseKey("/cases/%E0%A4%A")).toBeNull();
    expect(caseKey("/other/file")).toBeNull();
    expect(caseKey("/cases/Kits/UPPER.dcm")).toBeNull();
  });
});
