import { isConcealedFrom } from '$lib/domain/visibility/seal';

/**
 * In-process pub/sub for SSE. Single app container — no Redis, no queue.
 * Seal filtering happens here, per subscriber: a concealed member's stream
 * simply never carries the event.
 */

export interface WorkspaceEvent {
	type: 'purchase';
	purchaseId: string;
	sealedUntil: Date | null;
	sealedFromMemberIds: string[];
}

interface Subscriber {
	memberId: string;
	send: (json: string) => void;
}

const subscribers = new Map<string, Set<Subscriber>>();

export function subscribe(workspaceId: string, subscriber: Subscriber): () => void {
	let set = subscribers.get(workspaceId);
	if (!set) {
		set = new Set();
		subscribers.set(workspaceId, set);
	}
	set.add(subscriber);
	return () => {
		set.delete(subscriber);
		if (set.size === 0) subscribers.delete(workspaceId);
	};
}

export function publish(workspaceId: string, event: WorkspaceEvent, now: Date): void {
	const set = subscribers.get(workspaceId);
	if (!set) return;
	const payload = JSON.stringify({ type: event.type, id: event.purchaseId });
	for (const sub of set) {
		if (isConcealedFrom(event, sub.memberId, now)) continue;
		try {
			sub.send(payload);
		} catch {
			// Dead stream; its abort handler will unsubscribe it.
		}
	}
}
