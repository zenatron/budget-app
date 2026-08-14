import { describe, expect, it } from 'vitest';
import { parseMapsLink } from './maps-link';

const SF = { lat: 37.7749, lng: -122.4194 };

function expectNear(got: ReturnType<typeof parseMapsLink>, want: { lat: number; lng: number }) {
	expect(got).not.toBeNull();
	expect(got!.lat).toBeCloseTo(want.lat, 6);
	expect(got!.lng).toBeCloseTo(want.lng, 6);
}

describe('parseMapsLink — the forms that carry a coordinate', () => {
	it('reads a geo: URI', () => {
		expectNear(parseMapsLink('geo:37.7749,-122.4194'), SF);
	});

	it('reads a Google place URL', () => {
		expectNear(
			parseMapsLink(
				'https://www.google.com/maps/place/Ferry+Building/@37.7955,-122.3937,17z/data=!4m6!3m5!1s0x8085807ded2f0e0f!8m2!3d37.7749!4d-122.4194!16zL20vMDdiXzQz'
			),
			SF
		);
	});

	it('prefers the resolved place over the camera position', () => {
		// !3d/!4d is the place; @ is only where the map happened to be panned to.
		expectNear(
			parseMapsLink('https://maps.google.com/@1.234,5.678,17z/data=!3d37.7749!4d-122.4194'),
			SF
		);
	});

	it('falls back to the camera position when that is all there is', () => {
		expectNear(parseMapsLink('https://www.google.com/maps/@37.7749,-122.4194,15z'), SF);
	});

	it('reads a Google search query pair', () => {
		expectNear(parseMapsLink('https://www.google.com/maps?q=37.7749,-122.4194'), SF);
	});

	it('reads a percent-encoded comma', () => {
		expectNear(
			parseMapsLink('https://maps.apple.com/?ll=37.7749%2C-122.4194&q=Ferry%20Building'),
			SF
		);
	});

	it('reads an Apple Maps link', () => {
		expectNear(parseMapsLink('https://maps.apple.com/?ll=37.7749,-122.4194&z=16'), SF);
	});

	it('reads Apple directions', () => {
		expectNear(parseMapsLink('https://maps.apple.com/?daddr=37.7749,-122.4194&dirflg=d'), SF);
	});

	it('reads an OpenStreetMap marker', () => {
		expectNear(
			parseMapsLink(
				'https://www.openstreetmap.org/?mlat=37.7749&mlon=-122.4194#map=17/37.7749/-122.4194'
			),
			SF
		);
	});

	it('reads an OpenStreetMap hash', () => {
		expectNear(parseMapsLink('https://www.openstreetmap.org/#map=17/37.7749/-122.4194'), SF);
	});

	it('reads a bare typed pair', () => {
		expectNear(parseMapsLink('  37.7749, -122.4194  '), SF);
		expectNear(parseMapsLink('37.7749;-122.4194'), SF);
	});

	it('handles the southern and eastern hemispheres', () => {
		expectNear(parseMapsLink('geo:-33.8688,151.2093'), { lat: -33.8688, lng: 151.2093 });
	});
});

describe('parseMapsLink — the things it must refuse', () => {
	it('refuses a street address, however coordinate-shaped', () => {
		// The regression this whole module exists to prevent: 1600 is not 16.00°N.
		expect(parseMapsLink('1600 Amphitheatre Pkwy, Mountain View, CA')).toBeNull();
		expect(parseMapsLink('221B Baker Street, London')).toBeNull();
		expect(parseMapsLink('10, 12 Rue de Rivoli')).toBeNull();
	});

	it('refuses a plain place name', () => {
		expect(parseMapsLink("Trader Joe's, Foster City")).toBeNull();
		expect(parseMapsLink('Costco')).toBeNull();
	});

	it('refuses a shortened link — following a redirect is a network call', () => {
		expect(parseMapsLink('https://maps.app.goo.gl/aBcDeFgHiJkLmNoP')).toBeNull();
		expect(parseMapsLink('https://goo.gl/maps/xyz123')).toBeNull();
	});

	it('refuses a plus code', () => {
		expect(parseMapsLink('849VQJQ5+XX')).toBeNull();
	});

	it('refuses an out-of-range pair rather than clamping it', () => {
		// Clamping here would invent a pin on the pole from a typo.
		expect(parseMapsLink('geo:91.0,0.0')).toBeNull();
		expect(parseMapsLink('200.5, 300.5')).toBeNull();
	});

	it('refuses an integer pair that is probably not a coordinate', () => {
		expect(parseMapsLink('5, 10')).toBeNull();
	});

	it('refuses empty and whitespace input', () => {
		expect(parseMapsLink('')).toBeNull();
		expect(parseMapsLink('   ')).toBeNull();
	});

	it('survives a malformed percent escape', () => {
		expect(() => parseMapsLink('https://example.com/?q=%E0%A4%A')).not.toThrow();
	});
});
