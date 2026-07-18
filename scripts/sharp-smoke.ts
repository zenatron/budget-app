/**
 * Phase 0 gate: prove sharp can decode → rotate → strip metadata → encode WebP
 * under Bun inside the production container. Exits non-zero on any failure.
 *
 *   docker run --rm -v ./scripts/sharp-smoke.ts:/app/sharp-smoke.ts \
 *     --entrypoint bun budget-app-app /app/sharp-smoke.ts
 */
import sharp from 'sharp';

// Render a small PNG in-process so the test needs no fixture file.
const png = await sharp({
	create: { width: 640, height: 480, channels: 3, background: { r: 200, g: 60, b: 40 } }
})
	.png()
	.toBuffer();

// The real pipeline: rotate first (bakes EXIF orientation in), then WebP.
const webp = await sharp(png, { limitInputPixels: 4096 * 4096 })
	.rotate()
	.resize(400, undefined, { withoutEnlargement: true })
	.webp({ quality: 78 })
	.toBuffer();

const isRiff = webp.subarray(0, 4).toString('ascii') === 'RIFF';
const isWebp = webp.subarray(8, 12).toString('ascii') === 'WEBP';
if (!isRiff || !isWebp) {
	console.error('FAIL: output is not a WebP container', webp.subarray(0, 12));
	process.exit(1);
}

const meta = await sharp(webp).metadata();
if (meta.format !== 'webp' || meta.width !== 400) {
	console.error('FAIL: unexpected metadata', meta);
	process.exit(1);
}

console.log(
	`OK sharp@${sharp.versions.sharp} libvips@${sharp.versions.vips} on ${process.platform}/${process.arch} under Bun ${Bun.version}: ${webp.byteLength} byte WebP, ${meta.width}x${meta.height}`
);
