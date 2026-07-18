import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { purchase, purchaseImage } from '$lib/server/db/schema';
import { loadPurchase, visibleTo } from '$lib/server/repo/purchases';
import { PurchaseNotFoundError } from '$lib/application/purchases';
import { PurchaseStateError } from '$lib/domain/purchase/purchase';
import { processUpload } from '$lib/infra/images/process';
import type { BlobStore } from '$lib/ports/blob-store';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';

interface Deps {
	clock: Clock;
	ids: IdGenerator;
	blobs: BlobStore;
}

interface Scope {
	workspaceId: string;
	memberId: string;
}

/** Validate → derive → store (content-addressed) → record. Original discarded. */
export async function addPurchaseImage(
	db: Db,
	deps: Deps,
	scope: Scope,
	purchaseId: string,
	upload: Uint8Array
): Promise<void> {
	const now = deps.clock.now();
	const p = await loadPurchase(
		db,
		{ workspaceId: scope.workspaceId, viewerId: scope.memberId },
		purchaseId,
		{ now }
	);
	if (!p) throw new PurchaseNotFoundError();
	if (p.memberId !== scope.memberId) {
		throw new PurchaseStateError('Only the requester can add photos');
	}

	const processed = await processUpload(upload);
	const [display, thumb] = await Promise.all([
		deps.blobs.put(processed.display.data, 'webp'),
		deps.blobs.put(processed.thumb.data, 'webp')
	]);

	const [{ maxPos }] = await db
		.select({ maxPos: sql<number>`coalesce(max(${purchaseImage.position}), -1)::int` })
		.from(purchaseImage)
		.where(eq(purchaseImage.purchaseId, purchaseId));

	await db.insert(purchaseImage).values({
		id: deps.ids.newId(),
		purchaseId,
		blobId: display.id,
		thumbBlobId: thumb.id,
		width: processed.display.width,
		height: processed.display.height,
		byteSize: display.byteSize,
		position: maxPos + 1
	});
}

export async function listImages(db: Db, purchaseId: string) {
	return db
		.select()
		.from(purchaseImage)
		.where(eq(purchaseImage.purchaseId, purchaseId))
		.orderBy(asc(purchaseImage.position));
}

/**
 * Blob authorization for the serving route: the blob must belong to a purchase
 * in this workspace that the viewer may see. Content-addressed paths being
 * unguessable is not authorization — this is.
 */
export async function isBlobVisible(
	db: Db,
	scope: { workspaceId: string; viewerId: string },
	blobId: string,
	now: Date
): Promise<boolean> {
	const rows = await db
		.select({ id: purchaseImage.id })
		.from(purchaseImage)
		.innerJoin(purchase, eq(purchaseImage.purchaseId, purchase.id))
		.where(
			and(
				or(eq(purchaseImage.blobId, blobId), eq(purchaseImage.thumbBlobId, blobId)),
				eq(purchase.workspaceId, scope.workspaceId),
				visibleTo(scope.viewerId, now)
			)
		)
		.limit(1);
	return rows.length > 0;
}
