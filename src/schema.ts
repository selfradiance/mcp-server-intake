import { z } from "zod";
import { CAPABILITY_CATEGORIES, INTAKE_LABELS } from "./types.js";

export const capabilityCategorySchema = z.enum(CAPABILITY_CATEGORIES);
export const intakeLabelSchema = z.enum(INTAKE_LABELS);

export const scanLimitsSchema = z.object({
  maxFileBytes: z.number().int().positive(),
  maxTotalBytes: z.number().int().positive(),
  maxFiles: z.number().int().positive()
});

export const packageScriptSurfaceSchema = z.object({
  name: z.string(),
  command: z.string(),
  installHook: z.boolean()
});

export const binEntrypointSurfaceSchema = z.object({
  name: z.string(),
  path: z.string()
});

export const dependencyHighlightSchema = z.object({
  name: z.string(),
  reason: z.enum(["mcp_sdk", "env_looking", "credential_looking"]),
  dependencyType: z.enum(["dependencies", "devDependencies"])
});

export const packageSummarySchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  scripts: z.array(packageScriptSurfaceSchema),
  bin: z.array(binEntrypointSurfaceSchema),
  dependencies: z.array(z.string()),
  devDependencies: z.array(z.string()),
  highlightedDependencies: z.array(dependencyHighlightSchema)
});

export const readmeHintSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  text: z.string()
});

export const manifestSummarySchema = z.object({
  file: z.string(),
  toolNames: z.array(z.string())
});

export const skippedItemSchema = z.object({
  path: z.string(),
  relativePath: z.string(),
  reason: z.string()
});

export const scannedFileSummarySchema = z.object({
  path: z.string(),
  kind: z.enum(["package", "readme", "manifest", "source"]),
  bytesRead: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  truncated: z.boolean()
});

export const findingSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  category: capabilityCategorySchema,
  title: z.string(),
  detail: z.string(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  value: z.string().optional(),
  excerpt: z.string().optional()
});

export const intakeReportSchema = z.object({
  schemaVersion: z.literal("1.0"),
  toolVersion: z.string(),
  rootPath: z.string(),
  package: packageSummarySchema,
  scannedFiles: z.array(scannedFileSummarySchema),
  skipped: z.array(skippedItemSchema),
  limits: scanLimitsSchema,
  totalBytesRead: z.number().int().nonnegative(),
  readmeHints: z.array(readmeHintSchema),
  manifests: z.array(manifestSummarySchema),
  findings: z.array(findingSchema),
  label: intakeLabelSchema,
  labelReasons: z.array(z.string()),
  capabilitySummary: z.record(capabilityCategorySchema, z.number().int().nonnegative())
});

export function validateIntakeReport(value: unknown) {
  return intakeReportSchema.parse(value);
}
