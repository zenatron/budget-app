/**
 * May this workspace be offered an image-reading feature, and what do we say if
 * not?
 *
 * `gateFor` owns the three-way rule; this puts the workspace's actual model in
 * front of it. The only real work is finding the catalog row, and the only real
 * decision is that a *failure to look* is not evidence of incapability:
 *
 * - **External** has no catalog at all. `/v1/models` returns names, so there is
 *   nothing to consult and never will be. Unknown, so fail open.
 * - **Local** has one, but listing it costs a round trip to Ollama, and it can
 *   be down. A throw here is again unknown, not incapable — so it fails open and
 *   the user meets their provider's own error if the model really can't see.
 *
 * The catalog is cached per endpoint against each model's own timestamp (see
 * `infra/llm/model-catalog`), so on the common path this costs one `/api/tags`
 * and usually nothing else.
 */

import { gateFor, entryFor, type Gate } from '$lib/domain/intelligence/capability-gate';
import { listModels } from '$lib/infra/llm/model-catalog';
import type { WorkspaceRow } from '$lib/server/repo/workspaces';

export async function visionGate(ws: WorkspaceRow): Promise<Gate> {
	if (ws.aiMode === 'off') {
		return { allowed: false, reason: 'AI assist is off, so nothing can read an image.' };
	}
	if (ws.aiMode !== 'local' || !ws.aiEndpoint) return gateFor(null, 'vision');

	try {
		const base = new URL(ws.aiEndpoint);
		const { models } = await listModels(`${base.protocol}//${base.host}`);
		return gateFor(entryFor(models, ws.aiModel), 'vision');
	} catch {
		// Couldn't ask. That is not an answer about the model.
		return gateFor(null, 'vision');
	}
}
