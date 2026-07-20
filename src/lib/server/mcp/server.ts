/**
 * A minimal MCP server over JSON-RPC 2.0, implemented directly against
 * SvelteKit's Web Request/Response rather than the Node-transport MCP SDK — the
 * app already speaks Web-standard fetch, and a tools-only server needs nothing
 * the SDK's streaming transport would add. Responses are single JSON objects
 * (the spec permits this in place of an SSE stream when the server never
 * initiates messages), so the endpoint stays an ordinary POST handler.
 */
import pkg from '../../../../package.json';
import { TOOLS, TOOLS_BY_NAME, toToolError, type ToolContext } from './tools';

/** The protocol revision we implement; we echo the client's if we recognize it. */
export const SUPPORTED_PROTOCOL = '2025-06-18';
const KNOWN_PROTOCOLS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: string | number | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
	return { jsonrpc: '2.0', id, result };
}
function err(id: string | number | null, code: number, message: string): JsonRpcResponse {
	return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Handle one JSON-RPC message. Returns the response object, or null for
 * notifications (messages with no `id`), which get no reply.
 */
export async function dispatch(
	ctx: ToolContext,
	msg: JsonRpcRequest
): Promise<JsonRpcResponse | null> {
	const isNotification = msg.id === undefined;
	const id = msg.id ?? null;

	// Notifications (initialized, cancelled, …) are acknowledged with no body.
	if (isNotification) {
		return null;
	}

	switch (msg.method) {
		case 'initialize': {
			const requested = (msg.params?.protocolVersion as string) || SUPPORTED_PROTOCOL;
			const protocolVersion = KNOWN_PROTOCOLS.has(requested) ? requested : SUPPORTED_PROTOCOL;
			return ok(id, {
				protocolVersion,
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: 'ledger', title: 'Ledger — shared budget', version: pkg.version },
				instructions:
					'This is a shared household budget. You act as one member; approvals, gift-mode seals and per-member visibility all apply to you. Use whoami to confirm the workspace, search_purchases and spending_summary to read, log_purchase/request_purchase to record spending, and approve_purchase/deny_purchase for items awaiting your decision.'
			});
		}
		case 'ping':
			return ok(id, {});
		case 'tools/list': {
			// Only advertise tools this token can actually call.
			const tools = TOOLS.filter((t) => ctx.authed.scopes.includes(t.scope)).map((t) => ({
				name: t.name,
				description: t.description,
				inputSchema: t.inputSchema
			}));
			return ok(id, { tools });
		}
		case 'tools/call': {
			const name = msg.params?.name as string | undefined;
			const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
			const tool = name ? TOOLS_BY_NAME.get(name) : undefined;
			if (!tool) return err(id, -32602, `Unknown tool: ${name ?? '(none)'}`);
			if (!ctx.authed.scopes.includes(tool.scope)) {
				return ok(
					id,
					toolError(`This token does not have the "${tool.scope}" scope required by ${tool.name}.`)
				);
			}
			try {
				const result = await tool.handler(ctx, args);
				return ok(id, {
					content: [{ type: 'text', text: result.text }],
					...(result.data !== undefined ? { structuredContent: { result: result.data } } : {}),
					isError: result.isError ?? false
				});
			} catch (e) {
				const friendly = toToolError(e);
				if (friendly) return ok(id, toolError(friendly));
				throw e; // unexpected — let the endpoint turn it into a 500
			}
		}
		default:
			return err(id, -32601, `Method not found: ${msg.method}`);
	}
}

function toolError(text: string) {
	return { content: [{ type: 'text', text }], isError: true };
}
