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

### Debugging

1. **Start the RiotPlan MCP server** (in a separate terminal):
   ```bash
   riotplan-mcp-http --port 3002 --plans-dir /path/to/plans
   ```

2. **Open the extension folder** in VS Code:
   - For multi-root workspace (e.g. kjerneverk): Use **"Launch Extension"** from the Run and Debug view
   - For single folder: Open `riotplan-vscode` as the workspace root, then use **"Launch Extension (single folder)"**

3. **Press F5** or run **Debug: Start Debugging** from the Command Palette

4. A new **Extension Development Host** window opens with the extension loaded. Set breakpoints in `src/` and they will hit when the extension runs.

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
