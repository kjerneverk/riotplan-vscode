/**
 * RiotPlan VSCode Extension
 *
 * Provides plan management UI connected to RiotPlan HTTP MCP server
 */

import * as vscode from 'vscode';
import { HttpMcpClient } from './mcp-client';
import { PlansTreeProvider } from './plans-provider';

let mcpClient: HttpMcpClient;
let plansProvider: PlansTreeProvider;

export async function activate(context: vscode.ExtensionContext) {
    console.log('RiotPlan extension is now active');

    // Get server URL from configuration
    const config = vscode.workspace.getConfiguration('riotplan');
    const serverUrl = config.get<string>('serverUrl', 'http://127.0.0.1:3002');

    // Create MCP client
    mcpClient = new HttpMcpClient(serverUrl);

    // Check server health
    const isHealthy = await mcpClient.healthCheck();
    if (!isHealthy) {
        vscode.window.showWarningMessage(
            `RiotPlan server not available at ${serverUrl}. Please start the server and reload the window.`
        );
    }

    // Create plans tree provider
    plansProvider = new PlansTreeProvider(mcpClient);

    // Register tree view
    const treeView = vscode.window.createTreeView('riotplan-plans', {
        treeDataProvider: plansProvider,
    });

    context.subscriptions.push(treeView);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('riotplan.refreshPlans', () => {
            plansProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('riotplan.openPlan', async (plan: any) => {
            if (plan && plan.uuid) {
                try {
                    const status = await mcpClient.getPlanStatus(plan.uuid);
                    const doc = await vscode.workspace.openTextDocument({
                        content: JSON.stringify(status, null, 2),
                        language: 'json',
                    });
                    await vscode.window.showTextDocument(doc);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to open plan: ${error}`);
                }
            }
        })
    );

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('riotplan.serverUrl')) {
                const newUrl = vscode.workspace
                    .getConfiguration('riotplan')
                    .get<string>('serverUrl', 'http://127.0.0.1:3002');
                mcpClient = new HttpMcpClient(newUrl);
                plansProvider.updateClient(mcpClient);
                plansProvider.refresh();
            }
        })
    );
}

export function deactivate() {
    console.log('RiotPlan extension is now deactivated');
}
