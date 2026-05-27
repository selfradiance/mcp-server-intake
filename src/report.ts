import { promises as fs } from "node:fs";
import path from "node:path";
import { validateIntakeReport } from "./schema.js";
import { CAPABILITY_CATEGORIES, DiscoveryResult, IntakeReport } from "./types.js";

export function renderHumanReport(report: IntakeReport): string {
  const packageName = report.package.name ?? "(unnamed package)";
  const packageVersion = report.package.version ? `@${report.package.version}` : "";
  const lines: string[] = [];

  lines.push(`mcp-server-intake v${report.toolVersion}`);
  lines.push(`Path: ${report.rootPath}`);
  lines.push(`Package: ${packageName}${packageVersion}`);
  if (report.package.description) {
    lines.push(`Description: ${report.package.description}`);
  }
  lines.push(`Scanned files: ${report.scannedFiles.length}`);
  lines.push(`Scanned bytes: ${report.totalBytesRead}`);
  lines.push("");

  lines.push("Package summary");
  lines.push(renderList("Scripts", report.package.scripts.map((script) => `${script.name}: ${script.command}`)));
  lines.push(renderList("Bin entrypoints", report.package.bin.map((entry) => `${entry.name}: ${entry.path}`)));
  lines.push(renderList("Dependencies", report.package.dependencies));
  lines.push(renderList("Dev dependencies", report.package.devDependencies));
  lines.push(
    renderList(
      "Dependency highlights",
      report.package.highlightedDependencies.map(
        (item) => `${item.name} (${item.dependencyType}, ${item.reason})`
      )
    )
  );
  lines.push("");

  lines.push("Declared MCP/tool-surface findings");
  lines.push(renderFindings(report, "mcp_tool_surface"));
  lines.push("");

  lines.push("Execution-surface findings");
  lines.push(
    renderFindings(report, [
      "shell_execution",
      "filesystem_read",
      "filesystem_write",
      "network",
      "env_access",
      "credential_surface",
      "package_script_surface",
      "bin_entrypoint",
      "dynamic_code",
      "unknown"
    ])
  );
  lines.push("");

  lines.push("README/setup hints");
  lines.push(renderList("Hints", report.readmeHints.map((hint) => `${hint.file}:${hint.line} ${hint.text}`)));
  lines.push("");

  lines.push("Capability category summary");
  for (const category of CAPABILITY_CATEGORIES) {
    lines.push(`- ${category}: ${report.capabilitySummary[category]}`);
  }
  lines.push("");

  lines.push("Label reasons");
  for (const reason of report.labelReasons) {
    lines.push(`- ${reason}`);
  }
  lines.push("");
  lines.push(`Final intake label: ${report.label}`);

  return lines.join("\n");
}

export async function writeJsonReport(
  report: IntakeReport,
  jsonOutPath: string,
  discovery: DiscoveryResult
): Promise<string> {
  const validated = validateIntakeReport(report);
  const outPath = path.resolve(jsonOutPath);
  const inputFiles = new Set(discovery.files.map((file) => path.resolve(file.path)));

  if (inputFiles.has(outPath)) {
    throw new Error(`json-out path matches inspected input file: ${outPath}`);
  }

  try {
    const existingRealPath = await fs.realpath(outPath);
    if (inputFiles.has(existingRealPath)) {
      throw new Error(`json-out path resolves to inspected input file: ${outPath}`);
    }
  } catch (error) {
    if (error instanceof Error && !("code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  return outPath;
}

function renderList(label: string, values: string[]): string {
  if (values.length === 0) {
    return `- ${label}: none`;
  }

  return [`- ${label}:`, ...values.map((value) => `  - ${value}`)].join("\n");
}

function renderFindings(
  report: IntakeReport,
  categories: IntakeReport["findings"][number]["category"] | IntakeReport["findings"][number]["category"][]
): string {
  const categorySet = new Set(Array.isArray(categories) ? categories : [categories]);
  const findings = report.findings.filter((finding) => categorySet.has(finding.category));

  if (findings.length === 0) {
    return "- none";
  }

  return findings.map((finding) => `- ${formatFinding(finding)}`).join("\n");
}

function formatFinding(finding: IntakeReport["findings"][number]): string {
  const location = finding.file ? ` ${finding.file}${finding.line ? `:${finding.line}` : ""}` : "";
  const value = finding.value ? ` [${finding.value}]` : "";
  const excerpt = finding.excerpt ? ` | ${finding.excerpt}` : "";
  return `${finding.id}${location} ${finding.title}${value}: ${finding.detail}${excerpt}`;
}
