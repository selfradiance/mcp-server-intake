import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

async function tempPackage() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-server-intake-cli-"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0" }),
    "utf8"
  );
  return root;
}

function capture() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    }
  });

  return {
    stream,
    text: () => chunks.join("")
  };
}

describe("runCli", () => {
  it("prints a report and exits zero for successful inspections", async () => {
    const root = await tempPackage();
    const stdout = capture();
    const stderr = capture();
    const code = await runCli(["inspect", "--path", root], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      cwd: process.cwd()
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe("");
    expect(stdout.text()).toContain("Final intake label: no_findings");
  });

  it("writes stable JSON output", async () => {
    const root = await tempPackage();
    const out = path.join(root, "report.json");
    const stdout = capture();
    const stderr = capture();
    const code = await runCli(["inspect", "--path", root, "--json-out", out], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      cwd: process.cwd()
    });
    const json = JSON.parse(await fs.readFile(out, "utf8"));

    expect(code).toBe(0);
    expect(json.label).toBe("no_findings");
    expect(json.package.name).toBe("fixture");
  });

  it("rejects json-out paths that match inspected input files", async () => {
    const root = await tempPackage();
    const stdout = capture();
    const stderr = capture();
    const code = await runCli(["inspect", "--path", root, "--json-out", path.join(root, "package.json")], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      cwd: process.cwd()
    });

    expect(code).toBe(1);
    expect(stderr.text()).toContain("inspected input file");
  });

  it("exits nonzero on invalid arguments", async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runCli(["inspect"], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      cwd: process.cwd()
    });

    expect(code).toBe(1);
    expect(stderr.text()).toContain("Missing required --path");
  });
});
