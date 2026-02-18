/**
 * HTTP MCP Client for RiotPlan
 *
 * Implements JSON-RPC 2.0 over HTTP POST to communicate with RiotPlan HTTP MCP server
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

interface McpRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: any;
}

interface McpResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

export class HttpMcpClient {
    private sessionId?: string;
    private initialized = false;

    constructor(private serverUrl: string) {}

    async sendRequest(method: string, params?: any): Promise<any> {
        // MCP protocol requires initialize handshake before any other requests
        if (!this.initialized && method !== 'initialize') {
            await this.initialize();
        }

        const request: McpRequest = {
            jsonrpc: '2.0',
            id: Math.random().toString(36).substring(2),
            method,
            params,
        };

        const response = await this.httpPost('/mcp', request);

        // Update session ID from response headers
        if (response.headers['mcp-session-id']) {
            this.sessionId = response.headers['mcp-session-id'];
        }

        if (response.data.error) {
            throw new Error(response.data.error.message || 'MCP request failed');
        }

        return response.data.result;
    }

    private async initialize(): Promise<void> {
        const request: McpRequest = {
            jsonrpc: '2.0',
            id: 'init-1',
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'riotplan-vscode', version: '1.0.0' },
            },
        };

        const response = await this.httpPost('/mcp', request);

        if (response.headers['mcp-session-id']) {
            this.sessionId = response.headers['mcp-session-id'];
        }

        if (response.data.error) {
            throw new Error(`MCP initialization failed: ${response.data.error.message}`);
        }

        this.initialized = true;
    }

    private async httpPost(path: string, body: any): Promise<{ data: McpResponse; headers: any }> {
        return new Promise((resolve, reject) => {
            const url = new URL(this.serverUrl + path);
            const isHttps = url.protocol === 'https:';
            const client = isHttps ? https : http;

            const postData = JSON.stringify(body);

            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Both required by MCP Streamable HTTP transport spec
                    'Accept': 'application/json, text/event-stream',
                    'Content-Length': Buffer.byteLength(postData),
                    ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
                },
            };

            const req = client.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve({ data: parsed, headers: res.headers });
                    } catch (error) {
                        reject(new Error(`Failed to parse response: ${error}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(postData);
            req.end();
        });
    }

    async listPlans(filter?: 'all' | 'active' | 'done' | 'hold'): Promise<any> {
        return await this.sendRequest('tools/call', {
            name: 'riotplan_list_plans',
            arguments: { filter },
        });
    }

    async getPlanStatus(planId: string): Promise<any> {
        return await this.sendRequest('tools/call', {
            name: 'riotplan_status',
            arguments: { planId },
        });
    }

    async updateStep(planId: string, step: number, status: string): Promise<any> {
        return await this.sendRequest('tools/call', {
            name: 'riotplan_step_update',
            arguments: { planId, step, status },
        });
    }

    async healthCheck(): Promise<boolean> {
        try {
            const url = new URL(this.serverUrl + '/health');
            const isHttps = url.protocol === 'https:';
            const client = isHttps ? https : http;

            return new Promise((resolve) => {
                const req = client.get(url, (res) => {
                    resolve(res.statusCode === 200);
                });

                req.on('error', () => {
                    resolve(false);
                });

                req.setTimeout(5000, () => {
                    req.destroy();
                    resolve(false);
                });
            });
        } catch {
            return false;
        }
    }
}
