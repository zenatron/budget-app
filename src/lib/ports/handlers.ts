/**
 * The slices of SvelteKit's request event that route handlers actually use.
 *
 * Handlers take these rather than `ServerLoadEvent` / `RequestEvent` so the
 * same function is callable from both sides: the server binding passes the real
 * event straight through, and the demo build constructs an equivalent in the
 * browser. Naming only what is used is also what keeps that honest — a handler
 * that reached for `getClientAddress()` would not compile here.
 */
export interface LoadEvent {
	params: Record<string, string>;
	url: URL;
}

export interface ActionEvent {
	request: Request;
	params: Record<string, string>;
	url?: URL;
}
