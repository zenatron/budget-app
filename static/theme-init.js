/*
 * Pre-paint theme application. Loaded as a same-origin, render-blocking script
 * in app.html <head> (an inline script would trip the app's strict CSP, which
 * has no unsafe-inline for good reason). Runs before first paint so there's no
 * flash. Theme is a per-device preference: default follows the OS, an explicit
 * choice lives in localStorage as data-theme. Kept in sync at runtime by
 * $lib/theme; the tokens themselves switch in CSS via color-scheme.
 */
(function () {
	try {
		var t = localStorage.getItem('theme'); // 'light' | 'dark' | null (system)
		if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
		var dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
		var m = document.querySelector('meta[name="theme-color"]');
		if (m) m.setAttribute('content', dark ? '#201c17' : '#F4EEE1');
	} catch (e) {
		/* localStorage/matchMedia unavailable — fall through to the light default */
	}
})();
