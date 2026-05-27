import { describe, expect, it } from "vitest";
import { classifyIntake } from "../src/classifier.js";
import { Finding, ParsedIntake } from "../src/types.js";

function parsedWithFindings(findings: Finding[]): ParsedIntake {
  return {
    schemaVersion: "1.0",
    toolVersion: "0.1.0",
    rootPath: "/tmp/pkg",
    package: {
      name: "fixture",
      version: "0.0.0",
      description: undefined,
      scripts: [],
      bin: [],
      dependencies: [],
      devDependencies: [],
      highlightedDependencies: []
    },
    scannedFiles: [],
    skipped: [],
    limits: {
      maxFileBytes: 1,
      maxTotalBytes: 1,
      maxFiles: 1
    },
    totalBytesRead: 0,
    readmeHints: [],
    manifests: [],
    findings
  };
}

describe("classifyIntake", () => {
  it("returns no_findings when no findings exist", () => {
    expect(classifyIntake(parsedWithFindings([])).label).toBe("no_findings");
  });

  it("returns review for MCP tool surface findings", () => {
    const report = classifyIntake(
      parsedWithFindings([
        {
          id: "F001",
          ruleId: "source.tool_name",
          category: "mcp_tool_surface",
          title: "MCP tool name literal found",
          detail: "Tool declaration includes literal name."
        }
      ])
    );

    expect(report.label).toBe("review");
  });

  it("returns elevated_review for child_process findings", () => {
    const report = classifyIntake(
      parsedWithFindings([
        {
          id: "F001",
          ruleId: "source.child_process",
          category: "shell_execution",
          title: "child_process method call found",
          detail: "Call to exec() is present."
        }
      ])
    );

    expect(report.label).toBe("elevated_review");
  });

  it("returns elevated_review for install hook scripts", () => {
    const report = classifyIntake(
      parsedWithFindings([
        {
          id: "F001",
          ruleId: "package.install_hook",
          category: "package_script_surface",
          title: "Package install hook script declared",
          detail: "postinstall: node setup.js"
        }
      ])
    );

    expect(report.label).toBe("elevated_review");
  });
});
