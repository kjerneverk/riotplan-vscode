/**
 * Plans Tree Provider
 *
 * Provides tree view of plans from RiotPlan HTTP MCP server
 */

import * as vscode from 'vscode';
import { HttpMcpClient } from './mcp-client';

type PlanCategory = 'active' | 'done' | 'hold';
const TREE_MIME = 'application/vnd.code.tree.riotplan-plans';

type PlanCategory = 'active' | 'done' | 'hold';
const TREE_MIME = 'application/vnd.code.tree.riotplan-plans';

export class PlanItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly category?: PlanCategory,
        public readonly category?: PlanCategory,
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
        } else if (category) {
            this.contextValue = 'plan-category';
        } else if (category) {
            this.contextValue = 'plan-category';
        }
    }
}

export class PlansTreeProvider implements vscode.TreeDataProvider<PlanItem>, vscode.TreeDragAndDropController<PlanItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PlanItem | undefined | null | void> =
        new vscode.EventEmitter<PlanItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PlanItem | undefined | null | void> =
        this._onDidChangeTreeData.event;
    readonly dragMimeTypes = [TREE_MIME];
    readonly dropMimeTypes = [TREE_MIME];

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
                new PlanItem('Active', vscode.TreeItemCollapsibleState.Expanded, 'active'),
                new PlanItem('Done', vscode.TreeItemCollapsibleState.Collapsed, 'done'),
                new PlanItem('Hold', vscode.TreeItemCollapsibleState.Collapsed, 'hold'),
                new PlanItem('Active', vscode.TreeItemCollapsibleState.Expanded, 'active'),
                new PlanItem('Done', vscode.TreeItemCollapsibleState.Collapsed, 'done'),
                new PlanItem('Hold', vscode.TreeItemCollapsibleState.Collapsed, 'hold'),
            ];
        }

        // Category level - show plans
        const category = this.resolveCategoryFromLabel(element.label);
        const category = this.resolveCategoryFromLabel(element.label);

        try {
            const plans = await this.fetchPlans(category);
            const plans = await this.fetchPlans(category);

            return plans.map(
                (plan: any) =>
                    new PlanItem(
                        plan.name || plan.title || plan.id,
                        vscode.TreeItemCollapsibleState.None,
                        category,
                        category,
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

    async handleDrag(
        source: readonly PlanItem[],
        dataTransfer: vscode.DataTransfer
    ): Promise<void> {
        const draggable = source
            .filter((item) => item.contextValue === 'plan' && item.path)
            .map((item) => ({
                path: item.path!,
                uuid: item.uuid,
                planId: item.uuid || item.planId || item.path!,
                category: item.category || 'active',
                name: item.label,
            }));
        if (draggable.length === 0) {
            return;
        }
        dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(JSON.stringify(draggable)));
    }

    async handleDrop(
        target: PlanItem | undefined,
        dataTransfer: vscode.DataTransfer
    ): Promise<void> {
        const targetCategory = this.resolveDropCategory(target);
        if (!targetCategory) {
            return;
        }

        const transferItem = dataTransfer.get(TREE_MIME);
        if (!transferItem) {
            return;
        }

        const rawText = await this.readTransferText(transferItem);
        if (!rawText) {
            return;
        }
        let dragged: Array<{
            path?: string;
            uuid?: string;
            planId: string;
            category: PlanCategory;
            name: string;
        }> = [];
        try {
            const parsed = JSON.parse(rawText);
            if (Array.isArray(parsed)) {
                dragged = parsed;
            }
        } catch {
            return;
        }

        const moved: string[] = [];
        const skipped: string[] = [];
        const errors: string[] = [];

        for (const item of dragged) {
            if (!item?.planId) {
                continue;
            }
            if (item.category === targetCategory) {
                skipped.push(item.name || item.planId);
                continue;
            }
            try {
                await this.movePlanViaMcp(item, targetCategory);
                moved.push(item.name || item.planId);
            } catch (error) {
                const errText = error instanceof Error ? error.message : String(error);
                errors.push(`${item.name || item.planId}: ${errText}`);
            }
        }

        if (moved.length > 0) {
            const categoryName =
                targetCategory === 'done' ? 'Done' : targetCategory === 'hold' ? 'Hold' : 'Active';
            vscode.window.showInformationMessage(
                `Moved ${moved.length} plan${moved.length === 1 ? '' : 's'} to ${categoryName}.`
            );
            this.refresh();
        }
        if (skipped.length > 0 && moved.length === 0 && errors.length === 0) {
            vscode.window.showInformationMessage('Selected plans are already in that category.');
        }
        if (errors.length > 0) {
            vscode.window.showErrorMessage(`Failed to move ${errors.length} plan(s). Check logs for details.`);
            console.error('Failed to move plans:', errors);
        }
    }

    private async fetchPlans(category: PlanCategory): Promise<any[]> {
        const response = await this.mcpClient.listPlans(category);
        if (!response?.content?.length) {
            return [];
        }
        const content = response.content[0];
        if (content.type !== 'text') {
            return [];
        }
        const data = JSON.parse(content.text);
        const plans = data.plans || [];
        return plans.filter((plan: any) => this.getPlanCategory(plan) === category);
    }

    private resolveCategoryFromLabel(label: string): PlanCategory {
        const normalized = label.toLowerCase();
        if (normalized === 'done') {
            return 'done';
        }
        if (normalized === 'hold') {
            return 'hold';
        }
        return 'active';
    }

    private getPlanCategory(plan: any): PlanCategory {
        const explicitCategory = typeof plan?.category === 'string' ? plan.category.toLowerCase() : '';
        if (explicitCategory === 'done' || explicitCategory === 'hold' || explicitCategory === 'active') {
            return explicitCategory;
        }
        const planPath = typeof plan?.path === 'string' ? plan.path : '';
        const parts = planPath.split(/[\\/]+/).map((segment: string) => segment.toLowerCase());
        if (parts.includes('done')) {
            return 'done';
        }
        if (parts.includes('hold')) {
            return 'hold';
        }
        return 'active';
    }

    private resolveDropCategory(target: PlanItem | undefined): PlanCategory | undefined {
        if (!target?.category) {
            return undefined;
        }
        if (target.category === 'active' || target.category === 'done' || target.category === 'hold') {
            return target.category;
        }
        return undefined;
    }

    private async movePlanViaMcp(
        item: { path?: string; uuid?: string; planId: string },
        destinationCategory: PlanCategory
    ): Promise<void> {
        const candidates = [item.path, item.uuid, item.planId].filter(
            (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0
        );
        const uniqueCandidates = [...new Set(candidates)];
        let lastError: Error | undefined;

        for (const candidate of uniqueCandidates) {
            try {
                const response = await this.mcpClient.movePlan(candidate, destinationCategory);
                if (response?.isError) {
                    const errorText = response?.content?.[0]?.text || 'MCP move tool returned an error.';
                    throw new Error(errorText);
                }
                const content = response?.content?.[0];
                if (content?.type !== 'text') {
                    return;
                }
                try {
                    const parsed = JSON.parse(content.text);
                    if (parsed?.moved === false || parsed?.moved === true) {
                        return;
                    }
                } catch {
                    // Non-JSON text is treated as a successful message from MCP.
                    return;
                }
            } catch (error) {
                const errText = error instanceof Error ? error.message : String(error);
                lastError = error instanceof Error ? error : new Error(errText);
                const missingPlan = /could not find plan/i.test(errText);
                if (!missingPlan) {
                    throw lastError;
                }
            }
        }

        if (lastError) {
            throw lastError;
        }
    }

    private async readTransferText(transferItem: vscode.DataTransferItem): Promise<string | undefined> {
        try {
            const raw = transferItem.value;
            if (typeof raw === 'string' && raw.length > 0) {
                return raw;
            }
        } catch {
            // Some VS Code versions/sources only expose data through asString().
        }

        try {
            const text = await transferItem.asString();
            return typeof text === 'string' && text.length > 0 ? text : undefined;
        } catch {
            return undefined;
        }
    }
}
