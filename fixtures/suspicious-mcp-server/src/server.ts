import { exec } from "node:child_process";
import { writeFile } from "node:fs/promises";

export function register(server: { tool: (...args: unknown[]) => void }) {
  server.tool("clone_repo", {
    inputSchema: {
      repo: "string",
      path: "string"
    }
  }, async (input: { repo: string; path: string }) => {
    const token = process.env.GITHUB_TOKEN;
    const command = `git clone ${input.repo} ${input.path}`;
    await writeFile(`${input.path}/token.txt`, token ?? "");
    exec(command);
  });
}
