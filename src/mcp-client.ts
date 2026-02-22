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

    private async callToolWithArgFallback(
        name: string,
        primaryArgs: Record<string, unknown>,
        fallbackArgs: Record<string, unknown>
    ): Promise<any> {
        try {
            return await this.sendRequest('tools/call', {
                name,
                arguments: primaryArgs,
            });
        } catch (primaryError) {
            try {
                return await this.sendRequest('tools/call', {
                    name,
                    arguments: fallbackArgs,
                });
            } catch {
                throw primaryError;
            }
        }
    }

    async getPlanStatus(planPathOrId: string): Promise<any> {
        const result = await this.callToolWithArgFallback(
            'riotplan_status',
            { planId: planPathOrId, verbose: true },
            { path: planPathOrId, verbose: true }
        );
        if (result?.content?.[0]?.type === 'text') {
            return JSON.parse(result.content[0].text);
        }
        return result;
    }

    async readContext(planPath: string): Promise<any> {
        const result = await this.callToolWithArgFallback(
            'riotplan_read_context',
            { planId: planPath, depth: 'full' },
            { path: planPath, depth: 'full' }
        );
        if (result?.content?.[0]?.type === 'text') {
            return JSON.parse(result.content[0].text);
        }
        return result;
    }

    async listSteps(planPath: string): Promise<any> {
        const result = await this.sendRequest('tools/call', {
            name: 'riotplan_step_list',
            arguments: { path: planPath, all: true },
        });
        if (result?.content?.[0]?.type === 'text') {
            try { return JSON.parse(result.content[0].text); } catch { return result.content[0].text; }
        }
        return result;
    }

    async updateStep(planId: string, step: number, status: string): Promise<any> {
        return await this.sendRequest('tools/call', {
            name: 'riotplan_step_update',
            arguments: { planId, step, status },
        });
    }

    async readResource(uri: string): Promise<string> {
        const result = await this.sendRequest('resources/read', { uri });
        if (result?.contents?.[0]?.text) {
            return result.contents[0].text;
        }
        return '';
    }

    async getPlanResource(planPathOrId: string): Promise<any | null> {
        try {
            const content = await this.readResource(`riotplan://plan/${planPathOrId}`);
            if (!content) {
                return null;
            }
            return JSON.parse(content);
        } catch {
            return null;
        }
    }

    async addEvidence(
        planPath: string,
        description: string,
        source: string,
        summary: string,
        content: string
    ): Promise<any> {
        const args: any = { path: planPath, description, gatheringMethod: 'manual' };
        if (source) { args.source = source; }
        if (summary) { args.summary = summary; }
        if (content) { args.content = content; }
        const result = await this.sendRequest('tools/call', {
            name: 'riotplan_idea_add_evidence',
            arguments: args,
        });
        if (result?.content?.[0]?.type === 'text') {
            try { return JSON.parse(result.content[0].text); } catch { return result.content[0].text; }
        }
        return result;
    }

    async setIdeaContent(planPathOrId: string, content: string): Promise<any> {
        const result = await this.callToolWithArgFallback(
            'riotplan_idea_set_content',
            { planId: planPathOrId, content },
            { path: planPathOrId, content }
        );
        if (result?.content?.[0]?.type === 'text') {
            try {
                return JSON.parse(result.content[0].text);
            } catch {
                return result.content[0].text;
            }
        }
        return result;
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
