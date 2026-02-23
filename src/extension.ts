/**
 * RiotPlan VSCode Extension
 *
 * Provides plan management UI connected to RiotPlan HTTP MCP server
 */

import * as vscode from 'vscode';
import { HttpMcpClient } from './mcp-client';
import { PlanItem, PlansTreeProvider } from './plans-provider';
import { PlanDetailPanel } from './plan-detail-panel';
import { StatusTreeProvider } from './status-provider';
import { DashboardViewProvider } from './dashboard-view';

let mcpClient: HttpMcpClient;
let plansProvider: PlansTreeProvider;
let statusProvider: StatusTreeProvider;
let dashboardProvider: DashboardViewProvider;
let currentServerUrl = 'http://127.0.0.1:3002';

export async function activate(context: vscode.ExtensionContext) {
    console.log('RiotPlan extension is now active');

    const config = vscode.workspace.getConfiguration('riotplan');
    currentServerUrl = config.get<string>('serverUrl', 'http://127.0.0.1:3002');

    mcpClient = new HttpMcpClient(currentServerUrl);
    plansProvider = new PlansTreeProvider(mcpClient);
    statusProvider = new StatusTreeProvider(mcpClient, currentServerUrl);
    dashboardProvider = new DashboardViewProvider(context.extensionUri);
    dashboardProvider.setClient(mcpClient);

    // Register tree views
    const plansTreeView = vscode.window.createTreeView('riotplan-plans', {
        treeDataProvider: plansProvider,
        dragAndDropController: plansProvider,
        canSelectMany: true,
    });

    const connectionTreeView = vscode.window.createTreeView('riotplan-connection', {
        treeDataProvider: statusProvider,
    });

    context.subscriptions.push(plansTreeView, connectionTreeView);

    context.subscriptions.push(
        plansTreeView.onDidChangeSelection((event) => {
            const selected = event.selection?.[0];
            if (selected?.contextValue === 'plan') {
                openPlan(selected);
            }
        })
    );

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
            openPlan(plan);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('riotplan.copyPlanUrl', async (plan: PlanItem | any) => {
            const planRef = resolvePlanRef(plan);
            if (!planRef) {
                vscode.window.showWarningMessage('Unable to determine plan reference for this item.');
                return;
            }
            const planUrl = `riotplan://plan/${planRef}`;
            await vscode.env.clipboard.writeText(planUrl);
            vscode.window.setStatusBarMessage('Copied plan URL to clipboard', 2000);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('riotplan.openDashboard', () => {
            dashboardProvider.show();
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
                dashboardProvider.setClient(mcpClient);
                plansProvider.refresh();
                checkConnection(newUrl);
            }
        })
    );
}

function openPlan(plan: PlanItem | any): void {
    if (typeof plan === 'string' && plan.trim()) {
        const planRef = plan.trim();
        PlanDetailPanel.createOrShow(planRef, planRef, mcpClient);
        return;
    }

    const planRef = resolvePlanRef(plan);
    const planName = plan?.label || plan?.name || plan?.title || plan?.code || planRef || 'Plan';
    if (!planRef || typeof planRef !== 'string') {
        return;
    }
    PlanDetailPanel.createOrShow(planRef, planName, mcpClient, plan?.project);
}

function resolvePlanRef(plan: PlanItem | any): string | undefined {
    if (typeof plan === 'string' && plan.trim()) {
        return plan.trim();
    }
    const sqliteNameRef =
        typeof plan?.name === 'string' && /^[0-9a-f]{8}-/i.test(plan.name)
            ? plan.name
            : undefined;
    const ref = plan?.planId ?? plan?.id ?? sqliteNameRef ?? plan?.uuid ?? plan?.path;
    if (typeof ref === 'string' && ref.trim()) {
        return ref.trim();
    }
    return undefined;
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
