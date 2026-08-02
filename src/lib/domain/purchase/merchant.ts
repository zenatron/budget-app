/**
 * How a merchant name is folded for identity.
 *
 * Merchants are per-workspace and case-insensitive, so "Whole Foods", "whole
 * foods" and "Whole  Foods" have to be the same row. This is the single
 * definition of that folding: `findOrCreateMerchant` writes `normalized_name`
 * with it, and anything looking a merchant up by name must use it too, or it
 * will miss rows that are already there.
 */
export function normalizeMerchantName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
