#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyIntake } from "./classifier.js";
import { discoverPackage } from "./discovery.js";
import { parseDiscovery } from "./parser.js";
import { renderHumanReport, writeJsonReport } from "./report.js";
import { IntakeError } from "./types.js";

interface CliIO {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  cwd?: string;
}

interface InspectArgs {
  path: string;
  jsonOut?: string;
}

const HELP = `Usage:
  mcp-server-intake inspect --path <mcp-server-package-dir> [--json-out <path>]

This is a bounded static intake report for one local MCP server package.`;

export async function runCli(
  argv = process.argv.slice(2),
  io: CliIO = { stdout: process.stdout, stderr: process.stderr, cwd: process.cwd() }
): Promise<number> {
  try {
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
      io.stdout.write(`${HELP}\n`);
      return 0;
    }

    const inspectArgs = parseInspectArgs(argv);
    const cwd = io.cwd ?? process.cwd();
    const inspectedPath = path.resolve(cwd, inspectArgs.path);
    const discovery = await discoverPackage(inspectedPath);
    const parsed = parseDiscovery(discovery);
    const report = classifyIntake(parsed);

    if (inspectArgs.jsonOut) {
      await writeJsonReport(report, path.resolve(cwd, inspectArgs.jsonOut), discovery);
    }

    io.stdout.write(`${renderHumanReport(report)}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`${formatError(error)}\n`);
    return 1;
  }
}

function parseInspectArgs(argv: string[]): InspectArgs {
  const [command, ...rest] = argv;
  if (command !== "inspect") {
    throw new IntakeError(`Unknown command: ${command}`);
  }

  let inspectedPath: string | undefined;
  let jsonOut: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--path") {
      inspectedPath = rest[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--json-out") {
      jsonOut = rest[index + 1];
      index += 1;
      continue;
    }

    throw new IntakeError(`Unknown argument: ${arg}`);
  }

  if (!inspectedPath) {
    throw new IntakeError("Missing required --path argument");
  }

  return { path: inspectedPath, jsonOut };
}

function formatError(error: unknown): string {
  if (error instanceof IntakeError) {
    return `Error: ${error.message}`;
  }

  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }

  return `Error: ${String(error)}`;
}

const isDirect = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirect) {
  const code = await runCli();
  process.exitCode = code;
}
