import {
  CAPABILITY_CATEGORIES,
  CapabilityCategory,
  IntakeLabel,
  IntakeReport,
  ParsedIntake
} from "./types.js";

const ELEVATED_RULES = new Set([
  "source.child_process",
  "source.shell_interpolation",
  "package.install_hook",
  "source.dynamic_code"
]);

const REVIEW_RULES = new Set([
  "manifest.tool_name",
  "package.bin",
  "package.script",
  "package.script_download",
  "source.credential_surface",
  "source.env_access",
  "source.executable_file",
  "source.fs_read",
  "source.fs_write",
  "source.network",
  "source.shebang",
  "source.tool_name",
  "source.tool_pattern"
]);

export function classifyIntake(parsed: ParsedIntake): IntakeReport {
  const capabilitySummary = summarizeCapabilities(parsed.findings);
  const elevatedReasons = collectElevatedReasons(parsed);
  const reviewReasons = collectReviewReasons(parsed);
  let label: IntakeLabel = "no_findings";
  let labelReasons: string[] = ["No notable static surfaces were found within the configured scan bounds."];

  if (elevatedReasons.length > 0) {
    label = "elevated_review";
    labelReasons = elevatedReasons;
  } else if (reviewReasons.length > 0 || parsed.findings.length > 0) {
    label = "review";
    labelReasons = reviewReasons.length > 0 ? reviewReasons : ["Static findings are present."];
  }

  return {
    ...parsed,
    label,
    labelReasons,
    capabilitySummary
  };
}

function collectElevatedReasons(parsed: ParsedIntake): string[] {
  const reasons = new Set<string>();

  for (const finding of parsed.findings) {
    if (ELEVATED_RULES.has(finding.ruleId)) {
      reasons.add(`${finding.id}: ${finding.title}`);
    }
  }

  const hasBin = parsed.findings.some((finding) =>
    ["package.bin", "source.executable_file", "source.shebang"].includes(finding.ruleId)
  );
  const hasShellOrProcess = parsed.findings.some((finding) =>
    ["source.child_process", "source.shell_interpolation", "source.env_access"].includes(finding.ruleId)
  );

  if (hasBin && hasShellOrProcess) {
    reasons.add("Bin entrypoint appears alongside shell/process-related patterns.");
  }

  return [...reasons].sort();
}

function collectReviewReasons(parsed: ParsedIntake): string[] {
  const reasons = new Set<string>();

  for (const finding of parsed.findings) {
    if (REVIEW_RULES.has(finding.ruleId)) {
      reasons.add(`${finding.id}: ${finding.title}`);
    }
  }

  return [...reasons].sort();
}

function summarizeCapabilities(findings: ParsedIntake["findings"]): Record<CapabilityCategory, number> {
  const summary = Object.fromEntries(
    CAPABILITY_CATEGORIES.map((category) => [category, 0])
  ) as Record<CapabilityCategory, number>;

  for (const finding of findings) {
    summary[finding.category] += 1;
  }

  return summary;
}
