/**
 * Connection Status Tree Provider
 *
 * Shows RiotPlan server connection status in the sidebar
 */

import * as vscode from 'vscode';
import { HttpMcpClient } from './mcp-client';

type ConnectionState = 'connected' | 'disconnected' | 'checking';

class StatusItem extends vscode.TreeItem {
    constructor(
        label: string,
        description?: string,
        iconId?: string,
        contextValue?: string,
        command?: vscode.Command
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        if (description) {
            this.description = description;
        }
        if (iconId) {
            this.iconPath = new vscode.ThemeIcon(iconId);
        }
        if (contextValue) {
            this.contextValue = contextValue;
        }
        if (command) {
            this.command = command;
        }
    }
}

export class StatusTreeProvider implements vscode.TreeDataProvider<StatusItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<StatusItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private connectionState: ConnectionState = 'checking';
    private serverUrl: string;
    private sessionId?: string;

    constructor(private mcpClient: HttpMcpClient, serverUrl: string) {
        this.serverUrl = serverUrl;
    }

    updateClient(client: HttpMcpClient, serverUrl: string): void {
        this.mcpClient = client;
        this.serverUrl = serverUrl;
        this.connectionState = 'checking';
        this._onDidChangeTreeData.fire();
    }

    setConnectionState(state: ConnectionState, sessionId?: string): void {
        this.connectionState = state;
        this.sessionId = sessionId;
        this._onDidChangeTreeData.fire();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: StatusItem): vscode.TreeItem {
        return element;
    }

    getChildren(): StatusItem[] {
        const items: StatusItem[] = [];
        const configureCommand: vscode.Command = {
            command: 'riotplan.configureServerUrl',
            title: 'Configure RiotPlan Server URL',
        };
        const reconnectCommand: vscode.Command = {
            command: 'riotplan.reconnect',
            title: 'Reconnect RiotPlan',
        };

        if (this.connectionState === 'connected') {
            items.push(
                new StatusItem('Connected', undefined, 'circle-filled', 'status-connected', configureCommand)
            );
        } else if (this.connectionState === 'disconnected') {
            items.push(
                new StatusItem(
                    'Disconnected',
                    undefined,
                    'circle-slash',
                    'status-disconnected',
                    configureCommand
                )
            );
        } else {
            items.push(
                new StatusItem('Checking...', undefined, 'loading~spin', 'status-checking', configureCommand)
            );
        }

        items.push(new StatusItem('Server', this.serverUrl, 'server', 'status-server', configureCommand));

        if (this.sessionId) {
            items.push(
                new StatusItem('Session', this.sessionId.substring(0, 8) + '...', 'key', 'status-session')
            );
        }

        items.push(
            new StatusItem('Reconnect', undefined, 'refresh', 'status-reconnect', reconnectCommand)
        );

        return items;
    }
}
