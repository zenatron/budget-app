/**
 * Test fixture: captures outbound notification HTTP calls (web-push + ntfy)
 * so delivery can be asserted without real services. Logs one JSON line per
 * request to stdout. Paths under /gone/ answer 410 (dead push subscription).
 */
const PORT = 9444;
const TLS_PORT = 9446;

async function handle(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const body = await req.arrayBuffer();
	console.log(
		JSON.stringify({
			method: req.method,
			path: url.pathname,
			title: req.headers.get('title'),
			click: req.headers.get('click'),
			auth: req.headers.get('authorization')?.slice(0, 24) ?? null,
			ttl: req.headers.get('ttl'),
			encoding: req.headers.get('content-encoding'),
			bytes: body.byteLength
		})
	);
	if (url.pathname.startsWith('/gone/')) {
		return new Response('gone', { status: 410 });
	}
	return new Response('ok', { status: 201 });
}

Bun.serve({ port: PORT, fetch: handle });

// web-push only speaks https; serve the same handler behind a self-signed cert.
const certPath = process.env.CAPTURE_TLS_CERT;
const keyPath = process.env.CAPTURE_TLS_KEY;
if (certPath && keyPath) {
	Bun.serve({
		port: TLS_PORT,
		tls: { cert: Bun.file(certPath), key: Bun.file(keyPath) },
		fetch: handle
	});
	console.log(`capture: tls listening on :${TLS_PORT}`);
}

console.log(`capture: listening on :${PORT}`);
