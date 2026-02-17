# RiotPlan VSCode Extension

VSCode extension for managing RiotPlan plans via HTTP MCP server.

## Features

- **Plans Tree View**: Browse plans organized by lifecycle stage (Active, Done, Hold)
- **Plan Status**: View plan details and progress
- **HTTP MCP Integration**: Connects to RiotPlan HTTP MCP server

## Requirements

- RiotPlan HTTP MCP server running (default: http://127.0.0.1:3002)
- Start the server with: `riotplan-mcp-http --port 3002 --plans-dir /path/to/plans`

## Extension Settings

This extension contributes the following settings:

* `riotplan.serverUrl`: RiotPlan HTTP MCP server URL (default: `http://127.0.0.1:3002`)

## Usage

1. Start the RiotPlan HTTP MCP server
2. Open VSCode
3. The Plans view will appear in the Explorer sidebar
4. Browse plans by category (Active, Done, Hold)
5. Click on a plan to view its status

## Development

```bash
npm install
npm run compile
```

## Building

```bash
npm run package
```

This creates a `.vsix` file that can be installed in VSCode.

## Architecture

The extension uses:
- **HTTP MCP Client**: JSON-RPC 2.0 over HTTP POST
- **Tree Data Provider**: Displays plans in a hierarchical view
- **Session Management**: Maintains session with Mcp-Session-Id header

## License

Apache-2.0
