import type { Clock } from '$lib/ports/clock';

export const systemClock: Clock = {
	now: () => new Date()
};
