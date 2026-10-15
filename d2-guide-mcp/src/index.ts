#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";
import { registerPrompts } from "./prompts.js";
import { getManifest } from "./bungie/manifest.js";
import { log } from "./config.js";

const server = new McpServer(
  { name: "d2-guide", version: "0.1.0" },
  {
    instructions:
      "Tools for helping new and returning Destiny 2 players understand their own account and the game. " +
      "All tools are read-only. Start with get_account_overview. Prefer lookup_game_definition over memory " +
      "when describing items, perks or activities.",
  },
);

registerTools(server);
registerPrompts(server);

await server.connect(new StdioServerTransport());
log("server ready on stdio");

// Warm the manifest in the background so the first tool call isn't the slow one.
getManifest().catch((e) => log("manifest preload failed:", e instanceof Error ? e.message : e));
