import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface OllamaTag {
	name: string;
	model?: string;
	size?: number;
}

export const GET: RequestHandler = async ({ locals, url }) => {
	if (locals.member!.role !== 'owner') error(403, 'Only the owner can list models');
	const endpoint = url.searchParams.get('endpoint');
	if (!endpoint) error(400, 'Endpoint is required');

	let base: string;
	try {
		const u = new URL(endpoint);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') {
			error(400, 'Endpoint must be http or https');
		}
		base = `${u.protocol}//${u.host}`;
	} catch {
		error(400, 'Endpoint is not a valid URL');
	}

	try {
		const res = await fetch(`${base}/api/tags`, {
			method: 'GET',
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			error(502, `Ollama returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
		}
		const data = (await res.json()) as { models?: OllamaTag[] };
		const models = (data.models ?? [])
			.map((m) => m.name)
			.filter((name): name is string => typeof name === 'string' && name.length > 0)
			.sort();
		return json({ models });
	} catch (e) {
		if (e instanceof Error && 'status' in e && typeof e.status === 'number') throw e;
		error(502, e instanceof Error ? e.message : 'Could not reach Ollama');
	}
};
