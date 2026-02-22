/**
 * RiotPlan VSCode Extension
 *
 * Provides plan management UI connected to RiotPlan HTTP MCP server
 */

import * as vscode from 'vscode';
import { HttpMcpClient } from './mcp-client';
import { PlansTreeProvider } from './plans-provider';
import { PlanDetailPanel } from './plan-detail-panel';
import { StatusTreeProvider } from './status-provider';

let mcpClient: HttpMcpClient;
let plansProvider: PlansTreeProvider;
let statusProvider: StatusTreeProvider;
let currentServerUrl = 'http://127.0.0.1:3002';

export async function activate(context: vscode.ExtensionContext) {
    console.log('RiotPlan extension is now active');

    const config = vscode.workspace.getConfiguration('riotplan');
    currentServerUrl = config.get<string>('serverUrl', 'http://127.0.0.1:3002');

    mcpClient = new HttpMcpClient(currentServerUrl);
    plansProvider = new PlansTreeProvider(mcpClient);
    statusProvider = new StatusTreeProvider(mcpClient, currentServerUrl);

    // Register tree views
    const plansTreeView = vscode.window.createTreeView('riotplan-plans', {
        treeDataProvider: plansProvider,
    });

    const connectionTreeView = vscode.window.createTreeView('riotplan-connection', {
        treeDataProvider: statusProvider,
    });

    context.subscriptions.push(plansTreeView, connectionTreeView);

    // Check server health and update connection status
    checkConnection(currentServerUrl);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('riotplan.refreshPlans', () => {
            plansProvider.refresh();
            checkConnection(currentServerUrl);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('riotplan.configureServerUrl', async () => {
            const input = await vscode.window.showInputBox({
                title: 'RiotPlan Server URL',
                prompt: 'Set RiotPlan HTTP MCP server URL',
                value: currentServerUrl,
                placeHolder: 'http://127.0.0.1:3002',
                validateInput: (value) => {
                    try {
                        const parsed = new URL(value.trim());
                        if (!/^https?:$/.test(parsed.protocol)) {
                            return 'URL must use http or https';
                        }
                        return null;
                    } catch {
                        return 'Enter a valid URL';
                    }
                },
            });
            if (!input) {
                return;
            }
            await vscode.workspace
                .getConfiguration('riotplan')
                .update('serverUrl', input.trim(), vscode.ConfigurationTarget.Global);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('riotplan.reconnect', async () => {
            checkConnection(currentServerUrl);
            plansProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('riotplan.openPlan', (plan: any) => {
            const planRef = plan?.path ?? plan?.uuid ?? plan?.planId ?? plan?.id;
            const planName = plan?.name || plan?.title || plan?.code || planRef || 'Plan';
            if (plan && planRef) {
                PlanDetailPanel.createOrShow(planRef, planName, mcpClient, plan?.project);
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
                currentServerUrl = newUrl;
                mcpClient = new HttpMcpClient(newUrl);
                plansProvider.updateClient(mcpClient);
                statusProvider.updateClient(mcpClient, newUrl);
                plansProvider.refresh();
                checkConnection(newUrl);
            }
        })
    );
}

async function checkConnection(serverUrl: string): Promise<void> {
    statusProvider.setConnectionState('checking');
    const isHealthy = await mcpClient.healthCheck();
    if (isHealthy) {
        statusProvider.setConnectionState('connected');
    } else {
        statusProvider.setConnectionState('disconnected');
        vscode.window.showWarningMessage(
            `RiotPlan server not available at ${serverUrl}. Please start the server and reload the window.`
        );
    }
}

export function deactivate() {
    console.log('RiotPlan extension is now deactivated');
}
