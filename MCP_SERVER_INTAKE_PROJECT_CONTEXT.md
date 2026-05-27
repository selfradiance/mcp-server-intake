# MCP Server Intake Project Context

## Project Identity

- Repo name: `mcp-server-intake`
- Local folder: `~/Desktop/projects/mcp-server-intake`
- GitHub repo: `https://github.com/selfradiance/mcp-server-intake`
- Version: `v0.1.0`
- License: MIT
- Runtime: Node.js 20+
- Language: TypeScript
- Test framework: Vitest
- Validation: Zod

## Current Claim

A local deterministic CLI can inspect one local MCP server package before admission and produce a bounded intake report of declared MCP tool surfaces, package execution surfaces, and obvious command/network/dynamic-code patterns without installing, running, or trusting the server.

## Scope Boundaries

- Static intake only.
- One local MCP server package directory at a time.
- No execution of inspected MCP server packages.
- No dependency installation for inspected MCP server packages.
- No inspected package npm scripts are run.
- No MCP tool calls.
- No MCP protocol handshake.
- No network calls from the CLI.
- No LLM usage.
- No AgentGate or MCP Firewall integration.
- No malware detection claim.
- No vulnerability scanning claim.
- No semantic safety claim.
- No `safe` or `unsafe` output labels.
- No broad arbitrary huge repository scan.

## Command List

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run demo:benign`
- `npm run demo:suspicious`
- `node dist/cli.js inspect --path <mcp-server-package-dir> [--json-out <path>]`

## Shipped/Implemented Surfaces

- `package.json` summary:
  - name
  - version
  - description
  - scripts
  - bin entrypoints
  - dependency and devDependency names
  - MCP SDK, env-looking, and credential-looking dependency highlights
- README hint extraction:
  - setup/configuration/tool-use/capability-looking visible lines
- Bounded source discovery:
  - `src/`
  - `server/`
  - `tools/`
  - `lib/`
  - `bin/`
  - `scripts/`
  - `cli/`
  - root `index.*`
  - package main/bin entry files when present
- Manifest-like files:
  - `mcp.json`
  - `manifest.json`
  - `server.json`
- Deterministic findings:
  - MCP tool declaration patterns and simple literal tool names
  - package script surfaces
  - bin entrypoints
  - shebang and executable-looking files
  - child process calls
  - shell interpolation from input-like names
  - dynamic code patterns
  - filesystem read/write calls
  - network/download patterns
  - environment access
  - credential-looking identifiers
- Output:
  - human-readable terminal report
  - optional stable JSON report
  - simple protection against writing JSON over inspected input files

## Non-Goals

- Runtime MCP client behavior.
- Tool-call governance.
- Post-execution settlement or bonding.
- Skill bundle inspection.
- Dependency auditing.
- Semantic code interpretation.
- Full repository inventory.

## Relationship To Nearby Projects

- `mcp-config-inventory` asks what MCP servers an agent is configured to use before runtime.
- `mcp-server-intake` asks what surface one MCP server package introduces before admission.
- MCP Firewall governs selected MCP tool calls at runtime.
- AgentGate records, bonds, and settles actions after execution.
- SkillGate inspects installable Skill/capability bundles, not MCP server packages.

## Verification Status

Initial scaffold verification on 2026-05-27:

- `npm install`: passed
- `npm test`: passed
- `npm run typecheck`: passed
- `npm run build`: passed
- `npm run demo:benign`: passed
- `npm run demo:suspicious`: passed
- `git diff --check`: passed

Future release verification can update this section with the latest command results.

## Future Notes

- Consider configurable scan limits after the initial v0.1.0 boundary is stable.
- Consider structured manifest parsers for additional MCP server declaration formats.
- Consider opt-in SARIF or NDJSON output if downstream tooling needs it.
- Keep labels review-oriented and deterministic.
