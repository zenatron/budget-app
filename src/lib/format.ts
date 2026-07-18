export function formatPct(pct: number): string {
	if (pct >= 1_000_000) {
		return (pct / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M%';
	}
	if (pct >= 1000) {
		return (pct / 1000).toFixed(1).replace(/\.0$/, '') + 'k%';
	}
	return pct.toFixed(0) + '%';
}
