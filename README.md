# D2 MCP server

A read-only [MCP](https://modelcontextprotocol.io) server that helps **new and returning Destiny 2 players** understand
their own account and the game. It reads your characters, gear and vault through the official Bungie.net API and
explains what you have, what your build does, and what to do next, using Bungie's own item and activity descriptions.

It never moves, equips or deletes anything.

## What you can ask it

- Catch me up on my account after a long break.
- What does my current build do, and what do my exotics do?
- Find anything I own by name, type, rarity, element or class.
- What is a perk, item or activity, whether or not I own it?
- What's cluttering my vault, and what's stuck at the Postmaster?

## Tools and prompts

| Tool | What it does |
|---|---|
| `get_account_overview` | Characters, power, hours played, time since you last played, currencies, vault and Postmaster fill |
| `get_equipped_loadout` | Subclass (super, abilities, aspects, fragments), weapons and armor for a character |
| `search_my_items` | Search everything you own |
| `explain_my_item` | Full breakdown of an item you own, including every copy |
| `lookup_game_definition` | Look up any item, perk or activity in the game |
| `vault_cleanup_summary` | Duplicates, biggest categories, rarity mix and Postmaster contents |

Two prompts are included: `returning_player_briefing` and `explain_my_build`.

## Quick start

You need Node.js 20 or newer and a Bungie.net account with Destiny 2 characters.

```bash
cd d2-guide-mcp
npm install
npm run build
cp .env.example .env    # add your Bungie app credentials
npm run login           # one-time Bungie login
```

Then add the server to your MCP client. The full setup guide, including how to register a Bungie app, is in
[`d2-guide-mcp/README.md`](d2-guide-mcp/README.md).

## Status

Version 0.1. It has been tested against a real account. Planned next: activity and vendor lookups, and roll evaluation
from community wishlists.

Not affiliated with Bungie. Destiny is a trademark of Bungie, Inc.
