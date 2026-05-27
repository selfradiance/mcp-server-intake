import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DiscoveryResult,
  IntakeError,
  ScanLimits,
  ScannedFile,
  ScannedFileKind,
  SkippedItem
} from "./types.js";

export const DEFAULT_SCAN_LIMITS: ScanLimits = {
  maxFileBytes: 128 * 1024,
  maxTotalBytes: 768 * 1024,
  maxFiles: 200
};

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor"
]);

const SOURCE_DIRECTORIES = ["src", "server", "tools", "lib", "bin", "scripts", "cli"];
const MANIFEST_FILES = ["mcp.json", "manifest.json", "server.json"];
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".json",
  ".mjs",
  ".mts",
  ".sh",
  ".ts",
  ".tsx"
]);

type Candidate = {
  path: string;
  kind: ScannedFileKind;
};

export async function discoverPackage(
  inputPath: string,
  limits: ScanLimits = DEFAULT_SCAN_LIMITS
): Promise<DiscoveryResult> {
  const rootPath = await resolvePackageRoot(inputPath);
  const skipped: SkippedItem[] = [];
  const packageJsonPath = path.join(rootPath, "package.json");
  await assertRegularFileInsideRoot(packageJsonPath, rootPath, "package.json");

  const packageText = await fs.readFile(packageJsonPath, "utf8");
  const packageJson = parsePackageJson(packageText, packageJsonPath);
  const candidates = new Map<string, Candidate>();

  await addCandidate(candidates, skipped, rootPath, packageJsonPath, "package");
  await addRootMetadataFiles(candidates, skipped, rootPath);
  await addEntrypointCandidates(candidates, skipped, rootPath, packageJson);
  await addSourceDirectoryCandidates(candidates, skipped, rootPath, limits);

  const files: ScannedFile[] = [];
  let totalBytesRead = 0;
  const sortedCandidates = [...candidates.values()].sort((a, b) =>
    relative(rootPath, a.path).localeCompare(relative(rootPath, b.path))
  );

  for (const candidate of sortedCandidates.slice(0, limits.maxFiles)) {
    if (totalBytesRead >= limits.maxTotalBytes) {
      skipped.push(toSkipped(rootPath, candidate.path, "total byte limit reached"));
      continue;
    }

    const file = await readCandidate(candidate, rootPath, limits, totalBytesRead);
    if (!file) {
      skipped.push(toSkipped(rootPath, candidate.path, "could not read file"));
      continue;
    }

    totalBytesRead += file.bytesRead;
    files.push(file);
  }

  if (sortedCandidates.length > limits.maxFiles) {
    for (const candidate of sortedCandidates.slice(limits.maxFiles)) {
      skipped.push(toSkipped(rootPath, candidate.path, "file count limit reached"));
    }
  }

  return {
    rootPath,
    packageJson,
    files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    skipped: skipped.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    limits,
    totalBytesRead
  };
}

function parsePackageJson(text: string, packageJsonPath: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new IntakeError(`Invalid package.json at ${packageJsonPath}: ${detail}`);
  }
}

async function resolvePackageRoot(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  let stat;

  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new IntakeError(`Path does not exist: ${resolved}`);
  }

  if (!stat.isDirectory()) {
    throw new IntakeError(`Path is not a directory: ${resolved}`);
  }

  return fs.realpath(resolved);
}

async function assertRegularFileInsideRoot(filePath: string, rootPath: string, label: string) {
  let lstat;

  try {
    lstat = await fs.lstat(filePath);
  } catch {
    throw new IntakeError(`${label} not found in inspected package root`);
  }

  if (lstat.isSymbolicLink()) {
    throw new IntakeError(`${label} must be a regular file, not a symlink`);
  }

  if (!lstat.isFile()) {
    throw new IntakeError(`${label} must be a regular file`);
  }

  const real = await fs.realpath(filePath);
  if (!isInsideRoot(rootPath, real)) {
    throw new IntakeError(`${label} resolves outside inspected package root`);
  }
}

async function addRootMetadataFiles(
  candidates: Map<string, Candidate>,
  skipped: SkippedItem[],
  rootPath: string
) {
  const entries = await readDirectory(rootPath);
  for (const entry of entries) {
    const filePath = path.join(rootPath, entry.name);
    if (entry.isFile() && /^readme(?:\..*)?$/i.test(entry.name)) {
      await addCandidate(candidates, skipped, rootPath, filePath, "readme");
    }

    if (entry.isFile() && MANIFEST_FILES.includes(entry.name)) {
      await addCandidate(candidates, skipped, rootPath, filePath, "manifest");
    }

    if (entry.isFile() && /^index\.(?:cjs|cts|js|mjs|mts|ts|tsx)$/.test(entry.name)) {
      await addCandidate(candidates, skipped, rootPath, filePath, "source");
    }
  }
}

async function addEntrypointCandidates(
  candidates: Map<string, Candidate>,
  skipped: SkippedItem[],
  rootPath: string,
  packageJson: unknown
) {
  const pkg = asRecord(packageJson);
  const entrypoints = new Set<string>();

  if (typeof pkg.main === "string") {
    entrypoints.add(pkg.main);
  }

  const bin = pkg.bin;
  if (typeof bin === "string") {
    entrypoints.add(bin);
  } else if (isRecord(bin)) {
    for (const value of Object.values(bin)) {
      if (typeof value === "string") {
        entrypoints.add(value);
      }
    }
  }

  for (const entrypoint of [...entrypoints].sort()) {
    await addCandidate(
      candidates,
      skipped,
      rootPath,
      path.resolve(rootPath, entrypoint),
      "source"
    );
  }
}

async function addSourceDirectoryCandidates(
  candidates: Map<string, Candidate>,
  skipped: SkippedItem[],
  rootPath: string,
  limits: ScanLimits
) {
  for (const directory of SOURCE_DIRECTORIES) {
    const dirPath = path.join(rootPath, directory);
    await walkDirectory(candidates, skipped, rootPath, dirPath, limits);
  }
}

async function walkDirectory(
  candidates: Map<string, Candidate>,
  skipped: SkippedItem[],
  rootPath: string,
  dirPath: string,
  limits: ScanLimits
) {
  if (candidates.size >= limits.maxFiles) {
    return;
  }

  let dirStat;
  try {
    dirStat = await fs.lstat(dirPath);
  } catch {
    return;
  }

  if (dirStat.isSymbolicLink()) {
    skipped.push(toSkipped(rootPath, dirPath, "symlink skipped"));
    return;
  }

  if (!dirStat.isDirectory()) {
    return;
  }

  const dirReal = await fs.realpath(dirPath);
  if (!isInsideRoot(rootPath, dirReal)) {
    skipped.push(toSkipped(rootPath, dirPath, "path resolves outside package root"));
    return;
  }

  const entries = await readDirectory(dirPath);
  for (const entry of entries) {
    if (candidates.size >= limits.maxFiles) {
      return;
    }

    const childPath = path.join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      skipped.push(toSkipped(rootPath, childPath, "symlink skipped"));
      continue;
    }

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) {
        skipped.push(toSkipped(rootPath, childPath, "skipped directory"));
        continue;
      }

      await walkDirectory(candidates, skipped, rootPath, childPath, limits);
      continue;
    }

    if (entry.isFile() && shouldScanSourceFile(entry.name)) {
      await addCandidate(candidates, skipped, rootPath, childPath, "source");
    }
  }
}

async function addCandidate(
  candidates: Map<string, Candidate>,
  skipped: SkippedItem[],
  rootPath: string,
  filePath: string,
  kind: ScannedFileKind
) {
  let lstat;
  try {
    lstat = await fs.lstat(filePath);
  } catch {
    return;
  }

  if (lstat.isSymbolicLink()) {
    skipped.push(toSkipped(rootPath, filePath, "symlink skipped"));
    return;
  }

  if (!lstat.isFile()) {
    return;
  }

  const real = await fs.realpath(filePath);
  if (!isInsideRoot(rootPath, real)) {
    skipped.push(toSkipped(rootPath, filePath, "path resolves outside package root"));
    return;
  }

  const existing = candidates.get(real);
  if (!existing || kindPrecedence(kind) < kindPrecedence(existing.kind)) {
    candidates.set(real, { path: real, kind });
  }
}

async function readCandidate(
  candidate: Candidate,
  rootPath: string,
  limits: ScanLimits,
  currentTotalBytes: number
): Promise<ScannedFile | undefined> {
  const stat = await fs.stat(candidate.path);
  const remainingBytes = Math.max(limits.maxTotalBytes - currentTotalBytes, 0);
  const bytesToRead = Math.min(stat.size, limits.maxFileBytes, remainingBytes);

  if (bytesToRead <= 0) {
    return undefined;
  }

  const handle = await fs.open(candidate.path, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const result = await handle.read(buffer, 0, bytesToRead, 0);
    return {
      path: candidate.path,
      relativePath: relative(rootPath, candidate.path),
      kind: candidate.kind,
      bytesRead: result.bytesRead,
      sizeBytes: stat.size,
      truncated: result.bytesRead < stat.size,
      content: buffer.subarray(0, result.bytesRead).toString("utf8")
    };
  } finally {
    await handle.close();
  }
}

async function readDirectory(dirPath: string) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function shouldScanSourceFile(fileName: string): boolean {
  if (fileName === "package.json") {
    return true;
  }

  const extension = path.extname(fileName);
  if (SOURCE_EXTENSIONS.has(extension)) {
    return true;
  }

  return extension === "";
}

function isInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function relative(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).split(path.sep).join("/");
}

function toSkipped(rootPath: string, itemPath: string, reason: string): SkippedItem {
  return {
    path: itemPath,
    relativePath: relative(rootPath, itemPath),
    reason
  };
}

function kindPrecedence(kind: ScannedFileKind): number {
  switch (kind) {
    case "package":
      return 0;
    case "manifest":
      return 1;
    case "readme":
      return 2;
    case "source":
      return 3;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
