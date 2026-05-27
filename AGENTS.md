# AGENTS.md

This repository contains a local deterministic TypeScript CLI for static MCP server package intake reports.

## Project Commands

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run demo:benign`
- `npm run demo:suspicious`

## Working Rules

- Do not execute inspected MCP server packages.
- Do not install dependencies for inspected MCP server packages.
- Do not call MCP tools or perform MCP protocol handshakes.
- Keep scans bounded to one local package directory.
- Keep output deterministic and avoid secret values in reports.
- Labels are conservative intake labels, not safety verdicts.

## Implementation Notes

- Runtime dependencies should remain limited to Node built-ins and Zod.
- Tests use Vitest.
- Scanner discovery must keep real paths inside the inspected package root and skip symlinks.
- `dist/` is generated and intentionally ignored.
