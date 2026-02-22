/**
 * Plans Tree Provider
 *
 * Provides tree view of plans from RiotPlan HTTP MCP server
 */

import * as vscode from 'vscode';
import { HttpMcpClient } from './mcp-client';

export class PlanItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly path?: string,
        public readonly uuid?: string,
        public readonly planId?: string,
        public readonly stage?: string,
        public readonly progress?: { completed: number; total: number; percentage: number },
        public readonly project?: any
    ) {
        super(label, collapsibleState);

        if (path || uuid || planId) {
            const idSuffix = planId || uuid;
            this.tooltip = idSuffix ? `${label} (${idSuffix.substring(0, 8)})` : label;
            this.description = stage;
            this.contextValue = 'plan';
            this.command = {
                command: 'riotplan.openPlan',
                title: 'Open Plan',
                arguments: [this],
            };

            if (progress) {
                this.description = `${stage} - ${progress.percentage}%`;
            }
        }
    }
}

export class PlansTreeProvider implements vscode.TreeDataProvider<PlanItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PlanItem | undefined | null | void> =
        new vscode.EventEmitter<PlanItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PlanItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    constructor(private mcpClient: HttpMcpClient) {}

    updateClient(client: HttpMcpClient): void {
        this.mcpClient = client;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PlanItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PlanItem): Promise<PlanItem[]> {
        if (!element) {
            // Root level - show categories
            return [
                new PlanItem('Active', vscode.TreeItemCollapsibleState.Expanded),
                new PlanItem('Done', vscode.TreeItemCollapsibleState.Collapsed),
                new PlanItem('Hold', vscode.TreeItemCollapsibleState.Collapsed),
            ];
        }

        // Category level - show plans
        const category = element.label.toLowerCase();
        const filter = category === 'active' ? 'active' : category === 'done' ? 'done' : 'hold';

        try {
            const response = await this.mcpClient.listPlans(filter);

            // Parse MCP response
            let plans: any[] = [];
            if (response && response.content && response.content.length > 0) {
                const content = response.content[0];
                if (content.type === 'text') {
                    const data = JSON.parse(content.text);
                    plans = data.plans || [];
                }
            }

            return plans.map(
                (plan: any) =>
                    new PlanItem(
                        plan.name || plan.title || plan.id,
                        vscode.TreeItemCollapsibleState.None,
                        plan.path,
                        plan.uuid,
                        plan.planId || plan.id,
                        plan.stage,
                        plan.progress,
                        plan.project
                    )
            );
        } catch (error) {
            console.error('Failed to load plans:', error);
            return [];
        }
    }
}
