export const CAPABILITY_CATEGORIES = [
  "mcp_tool_surface",
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
] as const;

export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number];

export const INTAKE_LABELS = [
  "no_findings",
  "review",
  "elevated_review"
] as const;

export type IntakeLabel = (typeof INTAKE_LABELS)[number];

export type ScannedFileKind = "package" | "readme" | "manifest" | "source";

export interface ScanLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
}

export interface ScannedFile {
  path: string;
  relativePath: string;
  kind: ScannedFileKind;
  bytesRead: number;
  sizeBytes: number;
  truncated: boolean;
  content: string;
}

export interface SkippedItem {
  path: string;
  relativePath: string;
  reason: string;
}

export interface DiscoveryResult {
  rootPath: string;
  packageJson: unknown;
  files: ScannedFile[];
  skipped: SkippedItem[];
  limits: ScanLimits;
  totalBytesRead: number;
}

export interface PackageScriptSurface {
  name: string;
  command: string;
  installHook: boolean;
}

export interface BinEntrypointSurface {
  name: string;
  path: string;
}

export interface DependencyHighlight {
  name: string;
  reason: "mcp_sdk" | "env_looking" | "credential_looking";
  dependencyType: "dependencies" | "devDependencies";
}

export interface PackageSummary {
  name?: string;
  version?: string;
  description?: string;
  scripts: PackageScriptSurface[];
  bin: BinEntrypointSurface[];
  dependencies: string[];
  devDependencies: string[];
  highlightedDependencies: DependencyHighlight[];
}

export interface ReadmeHint {
  file: string;
  line: number;
  text: string;
}

export interface ManifestSummary {
  file: string;
  toolNames: string[];
}

export interface Finding {
  id: string;
  ruleId: string;
  category: CapabilityCategory;
  title: string;
  detail: string;
  file?: string;
  line?: number;
  value?: string;
  excerpt?: string;
}

export interface ParsedIntake {
  schemaVersion: "1.0";
  toolVersion: string;
  rootPath: string;
  package: PackageSummary;
  scannedFiles: Array<{
    path: string;
    kind: ScannedFileKind;
    bytesRead: number;
    sizeBytes: number;
    truncated: boolean;
  }>;
  skipped: SkippedItem[];
  limits: ScanLimits;
  totalBytesRead: number;
  readmeHints: ReadmeHint[];
  manifests: ManifestSummary[];
  findings: Finding[];
}

export interface IntakeReport extends ParsedIntake {
  label: IntakeLabel;
  labelReasons: string[];
  capabilitySummary: Record<CapabilityCategory, number>;
}

export class IntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeError";
  }
}
