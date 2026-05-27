# mcp-server-intake

A local deterministic CLI can inspect one local MCP server package before admission and produce a bounded intake report of declared MCP tool surfaces, package execution surfaces, and obvious command/network/dynamic-code patterns without installing, running, or trusting the server.

`mcp-server-intake` is a static intake tool, not a runtime MCP client.

## Quickstart

```bash
npm install
npm test
npm run build
node dist/cli.js inspect --path ./fixtures/benign-mcp-server
node dist/cli.js inspect --path ./fixtures/suspicious-mcp-server --json-out ./intake-report.json
```

After package installation, the CLI entrypoint is:

```bash
mcp-server-intake inspect --path <mcp-server-package-dir> [--json-out <path>]
```

## What This Does

- Reads one local MCP server package directory.
- Inspects `package.json` metadata, scripts, bin entrypoints, and dependency names.
- Looks at README files for visible setup and tool-use hints.
- Scans bounded source targets such as `src/`, `server/`, `tools/`, `lib/`, root `index.*`, and main/bin entry files when present.
- Checks manifest-like files such as `mcp.json`, `manifest.json`, and `server.json`.
- Reports simple literal MCP tool names when they are statically visible.
- Reports obvious patterns for shell execution, filesystem mutation, network/download usage, environment access, credential-looking identifiers, and dynamic code.
- Emits a human-readable report and optional stable JSON report.

## What This Does Not Do

- Does not execute the MCP server.
- Does not install dependencies for the inspected package.
- Does not run npm scripts for the inspected package.
- Does not call MCP tools.
- Does not perform an MCP protocol handshake.
- Does not make network calls.
- Does not use an LLM.
- Does not integrate with AgentGate.
- Does not integrate with MCP Firewall.
- Does not claim malware detection.
- Does not claim vulnerability scanning.
- Does not claim semantic safety.
- Does not output `safe` or `unsafe`.
- Does not scan arbitrary huge repositories broadly.

## Intake Labels

The final labels are conservative intake labels, not safety verdicts or risk scores:

- `no_findings`: no notable static surfaces were found within the configured bounds.
- `review`: static findings were found and should be examined before admission.
- `elevated_review`: higher-attention static patterns were found, such as child process use, shell interpolation from input-like values, install hooks, bin entrypoints paired with shell/process patterns, or dynamic code.

Rule logic is deterministic and implemented in `src/classifier.ts`.

## Relationship To Nearby Projects

- `mcp-config-inventory` asks what MCP servers an agent is configured to use before runtime.
- `mcp-server-intake` asks what surface one MCP server package introduces before admission.
- MCP Firewall governs selected MCP tool calls at runtime.
- AgentGate records, bonds, and settles actions after execution.
- SkillGate inspects installable Skill/capability bundles, not MCP server packages.

## Example Terminal Output

```text
mcp-server-intake v0.1.0
Path: /path/to/package
Package: suspicious-mcp-server@0.0.0
Scanned files: 4
Scanned bytes: 1052

Package summary
- Scripts:
  - postinstall: node bin/setup.js
- Bin entrypoints:
  - suspicious-mcp-server: bin/setup.js
- Dependencies:
  - @modelcontextprotocol/sdk
- Dev dependencies: none
- Dependency highlights:
  - @modelcontextprotocol/sdk (dependencies, mcp_sdk)

Declared MCP/tool-surface findings
- F005 src/server.ts:5 MCP tool name literal found [clone_repo]: Tool declaration includes literal name 'clone_repo'.

Execution-surface findings
- F001 Package bin entrypoint declared [suspicious-mcp-server]: suspicious-mcp-server: bin/setup.js
- F002 Package install hook script declared [postinstall]: postinstall: node bin/setup.js
- F006 src/server.ts:7 Environment access pattern found [process.env]: Environment access pattern present: process.env.
- F007 src/server.ts:8 Shell command interpolation from input-like value: A command-like string includes interpolation or construction from params/input/args/path/repo/branch/url/query.
- F008 src/server.ts:9 Filesystem mutation call found [writeFile]: Call to writeFile() is present in scanned source.
- F009 src/server.ts:10 child_process method call found [exec]: Call to exec() is present in scanned source.

Capability category summary
- mcp_tool_surface: 1
- shell_execution: 2
- filesystem_read: 0
- filesystem_write: 1
- network: 0
- env_access: 1
- credential_surface: 1
- package_script_surface: 1
- bin_entrypoint: 2
- dynamic_code: 0
- unknown: 0

Final intake label: elevated_review
```

## Bounds

Default scan limits:

- Per-file bytes: 128 KiB
- Total scanned bytes: 768 KiB
- Total files: 200

The scanner skips `node_modules`, `dist`, `build`, `coverage`, `.git`, `.next`, and `vendor`. Symlinks are skipped, and real paths are checked so discovered files remain inside the inspected package root.
