import { describe, expect, it } from "vitest";
import { parseDiscovery, sanitizeForReport } from "../src/parser.js";
import { DiscoveryResult } from "../src/types.js";

function discoveryWithSource(content: string): DiscoveryResult {
  return {
    rootPath: "/tmp/pkg",
    packageJson: {
      name: "fixture",
      version: "0.0.0"
    },
    files: [
      {
        path: "/tmp/pkg/package.json",
        relativePath: "package.json",
        kind: "package",
        bytesRead: 2,
        sizeBytes: 2,
        truncated: false,
        content: "{}"
      },
      {
        path: "/tmp/pkg/src/server.ts",
        relativePath: "src/server.ts",
        kind: "source",
        bytesRead: Buffer.byteLength(content),
        sizeBytes: Buffer.byteLength(content),
        truncated: false,
        content
      }
    ],
    skipped: [],
    limits: {
      maxFileBytes: 1024,
      maxTotalBytes: 4096,
      maxFiles: 10
    },
    totalBytesRead: Buffer.byteLength(content) + 2
  };
}

describe("parseDiscovery", () => {
  it("extracts simple literal MCP tool names", () => {
    const parsed = parseDiscovery(
      discoveryWithSource("server.tool('search_docs', { inputSchema: {} }, async () => {});\n")
    );

    expect(parsed.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "source.tool_name",
          value: "search_docs",
          category: "mcp_tool_surface"
        })
      ])
    );
  });

  it("reports generic tool declaration patterns when names are not simple literals", () => {
    const parsed = parseDiscovery(
      discoveryWithSource("server.tool(toolName, { inputSchema: {} }, handler);\n")
    );

    expect(parsed.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "source.tool_pattern",
          category: "mcp_tool_surface"
        })
      ])
    );
  });

  it("detects command, env, filesystem, network, and dynamic-code patterns", () => {
    const parsed = parseDiscovery(
      discoveryWithSource(`
        import { exec } from 'node:child_process';
        const command = \`git clone \${input.repo}\`;
        process.env.API_TOKEN;
        writeFile(input.path, 'x');
        fetch(input.url);
        exec(command);
        eval(input.code);
      `)
    );
    const ruleIds = parsed.findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("source.child_process");
    expect(ruleIds).toContain("source.shell_interpolation");
    expect(ruleIds).toContain("source.env_access");
    expect(ruleIds).toContain("source.fs_write");
    expect(ruleIds).toContain("source.network");
    expect(ruleIds).toContain("source.dynamic_code");
    expect(ruleIds).toContain("source.credential_surface");
  });

  it("redacts secret-looking assigned values", () => {
    expect(sanitizeForReport("API_TOKEN=abc123 npm start")).toBe("API_TOKEN=[redacted] npm start");
    expect(sanitizeForReport('const API_TOKEN = "abc123";')).toBe(
      'const API_TOKEN = "[redacted]";'
    );
    expect(sanitizeForReport("token: abc123")).toBe("token: [redacted]");
  });

  it("redacts secret-looking values in parsed excerpts and package descriptions", () => {
    const discovery = discoveryWithSource('const API_TOKEN = "super-secret-value";\n');
    discovery.packageJson = {
      name: "fixture",
      version: "0.0.0",
      description: "API_TOKEN=description-secret"
    };

    const parsed = parseDiscovery(discovery);
    const json = JSON.stringify(parsed);

    expect(json).not.toContain("super-secret-value");
    expect(json).not.toContain("description-secret");
    expect(json).toContain("[redacted]");
  });
});
