/** Injected time source so staleness, seal expiry, and recurrence are testable. */
export interface Clock {
	now(): Date;
}
