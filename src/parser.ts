import path from "node:path";
import {
  BinEntrypointSurface,
  CapabilityCategory,
  DependencyHighlight,
  DiscoveryResult,
  Finding,
  ManifestSummary,
  PackageScriptSurface,
  PackageSummary,
  ParsedIntake,
  ReadmeHint,
  ScannedFile
} from "./types.js";

export const TOOL_VERSION = "0.1.0";

const INSTALL_HOOK_SCRIPTS = new Set(["preinstall", "install", "postinstall", "prepare"]);
const README_HINT_PATTERN =
  /\b(mcp|tool|server|setup|install|configure|configuration|env|token|api\s*key|credential|command|permission)\b/i;

const SECRET_ASSIGNMENT_PATTERN =
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|KEY|CREDENTIAL)[A-Z0-9_]*\s*[:=]\s*)(["'`]?)([^\s"'`;,)\]\[{}]+)/gi;

type FindingInput = Omit<Finding, "id">;

export function parseDiscovery(discovery: DiscoveryResult): ParsedIntake {
  const findings: FindingInput[] = [];
  const readmeHints: ReadmeHint[] = [];
  const manifests: ManifestSummary[] = [];
  const packageSummary = parsePackageSummary(discovery.packageJson);

  addPackageFindings(packageSummary, findings);

  for (const file of discovery.files) {
    if (file.kind === "readme") {
      readmeHints.push(...extractReadmeHints(file));
      continue;
    }

    if (file.kind === "manifest") {
      const manifest = parseManifest(file);
      manifests.push(manifest);
      for (const toolName of manifest.toolNames) {
        findings.push({
          ruleId: "manifest.tool_name",
          category: "mcp_tool_surface",
          title: "Manifest tool name found",
          detail: `Manifest declares tool '${toolName}'.`,
          file: file.relativePath,
          value: toolName
        });
      }
    }

    if (file.kind === "source" || file.kind === "manifest") {
      findings.push(...scanSourceFile(file));
    }
  }

  const sortedFindings = findings
    .sort(compareFindingInputs)
    .map((finding, index) => ({ id: `F${String(index + 1).padStart(3, "0")}`, ...finding }));

  return {
    schemaVersion: "1.0",
    toolVersion: TOOL_VERSION,
    rootPath: discovery.rootPath,
    package: packageSummary,
    scannedFiles: discovery.files.map((file) => ({
      path: file.relativePath,
      kind: file.kind,
      bytesRead: file.bytesRead,
      sizeBytes: file.sizeBytes,
      truncated: file.truncated
    })),
    skipped: discovery.skipped,
    limits: discovery.limits,
    totalBytesRead: discovery.totalBytesRead,
    readmeHints: readmeHints.sort((a, b) => comparePathLine(a.file, a.line, b.file, b.line)),
    manifests: manifests.sort((a, b) => a.file.localeCompare(b.file)),
    findings: sortedFindings
  };
}

export function parsePackageSummary(packageJson: unknown): PackageSummary {
  const pkg = isRecord(packageJson) ? packageJson : {};
  const dependencies = dependencyNames(pkg.dependencies);
  const devDependencies = dependencyNames(pkg.devDependencies);
  const scripts = parseScripts(pkg.scripts);
  const bin = parseBinEntries(pkg.bin, pkg.name);

  return {
    name: optionalString(pkg.name),
    version: optionalString(pkg.version),
    description: optionalSanitizedString(pkg.description),
    scripts,
    bin,
    dependencies,
    devDependencies,
    highlightedDependencies: highlightDependencies(dependencies, devDependencies)
  };
}

export function sanitizeForReport(value: string, maxLength = 220): string {
  const redacted = value
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, prefix: string, quote: string) => {
      return `${prefix}${quote}[redacted]`;
    })
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(
      /\b(api[_-]?key|apiKey|access[_-]?token|token|secret|password)\s*[:=]\s*(["'`]?)[^\s"'`;,)\]\[{}]+/gi,
      (_match, key: string, quote: string) => `${key}=${quote}[redacted]`
    )
    .replace(/\s+/g, " ")
    .trim();

  if (redacted.length <= maxLength) {
    return redacted;
  }

  return `${redacted.slice(0, maxLength - 1)}…`;
}

function addPackageFindings(packageSummary: PackageSummary, findings: FindingInput[]) {
  for (const script of packageSummary.scripts) {
    findings.push({
      ruleId: script.installHook ? "package.install_hook" : "package.script",
      category: "package_script_surface",
      title: script.installHook ? "Package install hook script declared" : "Package script declared",
      detail: `${script.name}: ${script.command}`,
      value: script.name
    });

    if (/\b(?:curl|wget)\b/.test(script.command)) {
      findings.push({
        ruleId: "package.script_download",
        category: "network",
        title: "Download command string in package script",
        detail: `${script.name}: ${script.command}`,
        value: script.name
      });
    }
  }

  for (const entrypoint of packageSummary.bin) {
    findings.push({
      ruleId: "package.bin",
      category: "bin_entrypoint",
      title: "Package bin entrypoint declared",
      detail: `${entrypoint.name}: ${entrypoint.path}`,
      value: entrypoint.name
    });
  }
}

function parseScripts(value: unknown): PackageScriptSurface[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, command]) => ({
      name,
      command: sanitizeForReport(command),
      installHook: INSTALL_HOOK_SCRIPTS.has(name)
    }));
}

function parseBinEntries(value: unknown, packageName: unknown): BinEntrypointSurface[] {
  if (typeof value === "string") {
    return [
      {
        name: typeof packageName === "string" ? packageName : "default",
        path: sanitizeForReport(value)
      }
    ];
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entryPath]) => ({ name, path: sanitizeForReport(entryPath) }));
}

function dependencyNames(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.keys(value).sort();
}

function highlightDependencies(
  dependencies: string[],
  devDependencies: string[]
): DependencyHighlight[] {
  const highlights: DependencyHighlight[] = [];

  for (const [dependencyType, names] of [
    ["dependencies", dependencies],
    ["devDependencies", devDependencies]
  ] as const) {
    for (const name of names) {
      const lower = name.toLowerCase();
      if (lower === "@modelcontextprotocol/sdk" || lower.includes("mcp")) {
        highlights.push({ name, reason: "mcp_sdk", dependencyType });
      } else if (/\b(dotenv|env|envalid|convict|config)\b/.test(lower)) {
        highlights.push({ name, reason: "env_looking", dependencyType });
      } else if (/\b(keytar|credential|secret|token)\b/.test(lower)) {
        highlights.push({ name, reason: "credential_looking", dependencyType });
      }
    }
  }

  return highlights.sort((a, b) =>
    `${a.dependencyType}:${a.name}:${a.reason}`.localeCompare(`${b.dependencyType}:${b.name}:${b.reason}`)
  );
}

function extractReadmeHints(file: ScannedFile): ReadmeHint[] {
  return file.content
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => README_HINT_PATTERN.test(line))
    .slice(0, 12)
    .map(({ line, index }) => ({
      file: file.relativePath,
      line: index + 1,
      text: sanitizeForReport(line)
    }));
}

function parseManifest(file: ScannedFile): ManifestSummary {
  try {
    const manifest = JSON.parse(file.content);
    return {
      file: file.relativePath,
      toolNames: extractToolNamesFromJson(manifest).sort()
    };
  } catch {
    return {
      file: file.relativePath,
      toolNames: []
    };
  }
}

function extractToolNamesFromJson(value: unknown): string[] {
  const names = new Set<string>();

  function visit(node: unknown, parentKey?: string) {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, parentKey);
      }
      return;
    }

    if (!isRecord(node)) {
      return;
    }

    if (
      (parentKey === "tools" || "inputSchema" in node) &&
      typeof node.name === "string" &&
      isSimpleName(node.name)
    ) {
      names.add(node.name);
    }

    for (const [key, child] of Object.entries(node)) {
      visit(child, key);
    }
  }

  visit(value);
  return [...names];
}

function scanSourceFile(file: ScannedFile): FindingInput[] {
  const findings: FindingInput[] = [];

  addExecutableFindings(file, findings);
  addToolSurfaceFindings(file, findings);
  addChildProcessFindings(file, findings);
  addShellInterpolationFindings(file, findings);
  addDynamicCodeFindings(file, findings);
  addFilesystemFindings(file, findings);
  addNetworkFindings(file, findings);
  addEnvFindings(file, findings);
  addCredentialSurfaceFindings(file, findings);

  return findings;
}

function addExecutableFindings(file: ScannedFile, findings: FindingInput[]) {
  if (file.content.startsWith("#!")) {
    findings.push({
      ruleId: "source.shebang",
      category: "bin_entrypoint",
      title: "Shebang file found",
      detail: "Source file begins with a shebang.",
      file: file.relativePath,
      line: 1,
      excerpt: sanitizeForReport(firstLine(file.content))
    });
  }

  if (/^(?:bin|scripts|cli)\//.test(file.relativePath)) {
    findings.push({
      ruleId: "source.executable_file",
      category: "bin_entrypoint",
      title: "Executable-looking file in command directory",
      detail: "File is located under bin/, scripts/, or cli/.",
      file: file.relativePath
    });
  }
}

function addToolSurfaceFindings(file: ScannedFile, findings: FindingInput[]) {
  const literalNames = new Map<string, number>();
  const literalPatterns = [
    /\b(?:server\s*\.\s*)?tool\s*\(\s*["'`]([A-Za-z0-9_.:-]+)["'`]/g,
    /\bregisterTool\s*\(\s*["'`]([A-Za-z0-9_.:-]+)["'`]/g
  ];

  for (const pattern of literalPatterns) {
    for (const match of file.content.matchAll(pattern)) {
      const toolName = match[1];
      if (toolName && isSimpleName(toolName)) {
        literalNames.set(toolName, lineAt(file.content, match.index ?? 0));
      }
    }
  }

  for (const [toolName, line] of [...literalNames].sort(([a], [b]) => a.localeCompare(b))) {
    findings.push({
      ruleId: "source.tool_name",
      category: "mcp_tool_surface",
      title: "MCP tool name literal found",
      detail: `Tool declaration includes literal name '${toolName}'.`,
      file: file.relativePath,
      line,
      value: toolName
    });
  }

  const genericPatterns = [
    /\bserver\s*\.\s*tool\s*\(/,
    /\bregisterTool\s*\(/,
    /\bListToolsRequestSchema\b/,
    /\bCallToolRequestSchema\b/,
    /\btools\s*:/,
    /\binputSchema\b/
  ];

  if (literalNames.size === 0) {
    const pattern = genericPatterns.find((candidate) => candidate.test(file.content));
    if (pattern) {
      findings.push({
        ruleId: "source.tool_pattern",
        category: "mcp_tool_surface",
        title: "MCP tool declaration pattern found",
        detail: `Pattern '${pattern.source}' is present, but no simple literal tool name was extracted.`,
        file: file.relativePath,
        line: lineAt(file.content, file.content.search(pattern))
      });
    }
  }
}

function addChildProcessFindings(file: ScannedFile, findings: FindingInput[]) {
  const calls = collectNamedCalls(file.content, ["execFile", "exec", "spawn", "fork"]);
  if (calls.size === 0) {
    return;
  }

  for (const [method, index] of [...calls].sort(([a], [b]) => a.localeCompare(b))) {
    findings.push({
      ruleId: "source.child_process",
      category: "shell_execution",
      title: "child_process method call found",
      detail: `Call to ${method}() is present in scanned source.`,
      file: file.relativePath,
      line: lineAt(file.content, index),
      value: method,
      excerpt: lineExcerpt(file.content, index)
    });
  }
}

function addShellInterpolationFindings(file: ScannedFile, findings: FindingInput[]) {
  const patterns = [
    /`[^`]*\$\{[^}]*\b(?:param|params|input|args|argv|path|repo|branch|url|query|command|cmd)\b[^}]*\}[^`]*`/gi,
    /\b(?:const|let|var)\s+\w*(?:cmd|command|shell)\w*\s*=\s*[^;\n]*\b(?:param|params|input|args|argv|path|repo|branch|url|query)\b/gi
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(file.content);
    if (match) {
      findings.push({
        ruleId: "source.shell_interpolation",
        category: "shell_execution",
        title: "Shell command interpolation from input-like value",
        detail: "A command-like string includes interpolation or construction from params/input/args/path/repo/branch/url/query.",
        file: file.relativePath,
        line: lineAt(file.content, match.index),
        excerpt: lineExcerpt(file.content, match.index)
      });
      return;
    }
  }
}

function addDynamicCodeFindings(file: ScannedFile, findings: FindingInput[]) {
  const patterns: Array<[RegExp, string]> = [
    [/\beval\s*\(/, "eval"],
    [/\bnew\s+Function\s*\(/, "new Function"],
    [/\bvm\s*\.\s*runInNewContext\s*\(/, "vm.runInNewContext"],
    [/\bimport\s*\(\s*(?!["'`])[^)]+\)/, "import() with non-literal expression"]
  ];

  addFirstPatternPerName(file, findings, patterns, {
    ruleId: "source.dynamic_code",
    category: "dynamic_code",
    title: "Dynamic code pattern found",
    detailPrefix: "Dynamic code pattern present"
  });
}

function addFilesystemFindings(file: ScannedFile, findings: FindingInput[]) {
  const writeCalls = collectNamedCalls(file.content, [
    "appendFile",
    "appendFileSync",
    "mkdir",
    "mkdirSync",
    "rename",
    "renameSync",
    "rm",
    "rmSync",
    "unlink",
    "unlinkSync",
    "writeFile",
    "writeFileSync"
  ]);

  for (const [method, index] of [...writeCalls].sort(([a], [b]) => a.localeCompare(b))) {
    findings.push({
      ruleId: "source.fs_write",
      category: "filesystem_write",
      title: "Filesystem mutation call found",
      detail: `Call to ${method}() is present in scanned source.`,
      file: file.relativePath,
      line: lineAt(file.content, index),
      value: method,
      excerpt: lineExcerpt(file.content, index)
    });
  }

  const readCalls = collectNamedCalls(file.content, [
    "createReadStream",
    "readFile",
    "readFileSync",
    "readdir",
    "readdirSync",
    "stat",
    "statSync"
  ]);

  for (const [method, index] of [...readCalls].sort(([a], [b]) => a.localeCompare(b))) {
    findings.push({
      ruleId: "source.fs_read",
      category: "filesystem_read",
      title: "Filesystem read call found",
      detail: `Call to ${method}() is present in scanned source.`,
      file: file.relativePath,
      line: lineAt(file.content, index),
      value: method,
      excerpt: lineExcerpt(file.content, index)
    });
  }
}

function addNetworkFindings(file: ScannedFile, findings: FindingInput[]) {
  const patterns: Array<[RegExp, string]> = [
    [/\bfetch\s*\(/, "fetch"],
    [/\baxios\b/, "axios"],
    [/\bhttps?\s*\.\s*request\s*\(/, "http/https request"],
    [/\bhttps?\s*\.\s*get\s*\(/, "http/https get"],
    [/\b(?:curl|wget)\b/, "curl/wget string"]
  ];

  addFirstPatternPerName(file, findings, patterns, {
    ruleId: "source.network",
    category: "network",
    title: "Network/download pattern found",
    detailPrefix: "Network/download pattern present"
  });
}

function addEnvFindings(file: ScannedFile, findings: FindingInput[]) {
  const patterns: Array<[RegExp, string]> = [
    [/\bprocess\s*\.\s*env\b/, "process.env"],
    [/\bdotenv\b/, "dotenv"]
  ];

  addFirstPatternPerName(file, findings, patterns, {
    ruleId: "source.env_access",
    category: "env_access",
    title: "Environment access pattern found",
    detailPrefix: "Environment access pattern present"
  });
}

function addCredentialSurfaceFindings(file: ScannedFile, findings: FindingInput[]) {
  const pattern =
    /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\b/gi;
  const match = pattern.exec(file.content);

  if (!match) {
    return;
  }

  findings.push({
    ruleId: "source.credential_surface",
    category: "credential_surface",
    title: "Credential-looking identifier found",
    detail: "A credential-looking identifier name is present in scanned source.",
    file: file.relativePath,
    line: lineAt(file.content, match.index),
    value: match[0],
    excerpt: lineExcerpt(file.content, match.index)
  });
}

function addFirstPatternPerName(
  file: ScannedFile,
  findings: FindingInput[],
  patterns: Array<[RegExp, string]>,
  base: {
    ruleId: string;
    category: CapabilityCategory;
    title: string;
    detailPrefix: string;
  }
) {
  for (const [pattern, name] of patterns) {
    const match = pattern.exec(file.content);
    if (!match) {
      continue;
    }

    findings.push({
      ruleId: base.ruleId,
      category: base.category,
      title: base.title,
      detail: `${base.detailPrefix}: ${name}.`,
      file: file.relativePath,
      line: lineAt(file.content, match.index),
      value: name,
      excerpt: lineExcerpt(file.content, match.index)
    });
  }
}

function collectNamedCalls(content: string, names: string[]): Map<string, number> {
  const found = new Map<string, number>();
  for (const name of names) {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`, "g");
    const match = pattern.exec(content);
    if (match) {
      found.set(name, match.index);
    }
  }

  return found;
}

function lineAt(content: string, index: number): number {
  if (index < 0) {
    return 1;
  }

  return content.slice(0, index).split(/\r?\n/).length;
}

function lineExcerpt(content: string, index: number): string {
  const lineNumber = lineAt(content, index);
  const line = content.split(/\r?\n/)[lineNumber - 1] ?? "";
  return sanitizeForReport(line);
}

function firstLine(content: string): string {
  return content.split(/\r?\n/)[0] ?? "";
}

function compareFindingInputs(a: FindingInput, b: FindingInput): number {
  const pathCompare = (a.file ?? "").localeCompare(b.file ?? "");
  if (pathCompare !== 0) {
    return pathCompare;
  }

  const lineCompare = (a.line ?? 0) - (b.line ?? 0);
  if (lineCompare !== 0) {
    return lineCompare;
  }

  return `${a.category}:${a.ruleId}:${a.title}:${a.value ?? ""}`.localeCompare(
    `${b.category}:${b.ruleId}:${b.title}:${b.value ?? ""}`
  );
}

function comparePathLine(aPath: string, aLine: number, bPath: string, bLine: number): number {
  const pathCompare = aPath.localeCompare(bPath);
  return pathCompare === 0 ? aLine - bLine : pathCompare;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalSanitizedString(value: unknown): string | undefined {
  return typeof value === "string" ? sanitizeForReport(value) : undefined;
}

function isSimpleName(value: string): boolean {
  return /^[A-Za-z0-9_.:-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeReportPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
