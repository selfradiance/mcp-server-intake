import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverPackage } from "../src/discovery.js";

async function tempPackage() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-server-intake-discovery-"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0" }),
    "utf8"
  );
  return root;
}

describe("discoverPackage", () => {
  it("keeps discovery inside root and skips ignored directories and symlinks", async () => {
    const root = await tempPackage();
    await fs.mkdir(path.join(root, "src"));
    await fs.mkdir(path.join(root, "node_modules"));
    await fs.writeFile(path.join(root, "src", "index.ts"), "export const x = 1;\n", "utf8");
    await fs.writeFile(path.join(root, "node_modules", "ignored.js"), "fetch('x')\n", "utf8");

    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.ts`);
    await fs.writeFile(outside, "export const outside = true;\n", "utf8");
    await fs.symlink(outside, path.join(root, "src", "outside.ts"));

    const discovery = await discoverPackage(root);
    const paths = discovery.files.map((file) => file.relativePath);

    expect(paths).toContain("package.json");
    expect(paths).toContain("src/index.ts");
    expect(paths).not.toContain("node_modules/ignored.js");
    expect(paths).not.toContain("src/outside.ts");
    expect(discovery.skipped.some((item) => item.relativePath === "src/outside.ts")).toBe(true);
  });

  it("respects file and total byte limits", async () => {
    const root = await tempPackage();
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "large.ts"), "x".repeat(200), "utf8");

    const discovery = await discoverPackage(root, {
      maxFileBytes: 50,
      maxTotalBytes: 120,
      maxFiles: 10
    });
    const large = discovery.files.find((file) => file.relativePath === "src/large.ts");

    expect(large?.bytesRead).toBeLessThanOrEqual(50);
    expect(large?.truncated).toBe(true);
    expect(discovery.totalBytesRead).toBeLessThanOrEqual(120);
  });
});
