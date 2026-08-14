-- A purchase can carry a place, and the map that reads them.
--
-- Coordinates are stored as **integer millidegrees**, not floats and not
-- numeric. Pins are rounded to three decimals (~110 m) on the device before the
-- reading ever enters a form field, and again on the server on the way in. An
-- integer column makes that the only precision the schema is capable of
-- holding: a float would have let some later writer store seven decimals
-- without passing through either rounding step, and the privacy decision would
-- have quietly stopped existing. It also makes an eventual `group by lat_e3 / N`
-- a one-line change if clustering ever has to move out of the client, and makes
-- bounding-box comparisons exact.
--
-- Both tables get a pin because they answer different questions. `purchase` is
-- where this transaction happened — the fact. `merchant` is where that vendor
-- usually is — a learned default, so a purchase logged from the sofa still
-- lands on the map and a familiar shop prefills. The map reads the purchase's
-- pin and falls back to the vendor's; the vendor's is never authoritative,
-- because a chain is one merchant row and many places in the world.
--
-- Everything is nullable and stays that way. Capture is opt-in per purchase and
-- never automatic, so null is the normal state, and every row written before
-- today remains valid without touching it.
--
-- The check constraints are here rather than only in the application because
-- the map coalesces lat and lng independently: a half-written pin would put a
-- bubble on the prime meridian rather than fail.
ALTER TABLE "merchant" ADD COLUMN "lat_e3" integer;--> statement-breakpoint
ALTER TABLE "merchant" ADD COLUMN "lng_e3" integer;--> statement-breakpoint
ALTER TABLE "merchant" ADD COLUMN "place_label" text;--> statement-breakpoint
ALTER TABLE "merchant" ADD COLUMN "location_source" text;--> statement-breakpoint
ALTER TABLE "merchant" ADD COLUMN "location_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "lat_e3" integer;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "lng_e3" integer;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "place_label" text;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "location_source" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "location_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant" ADD CONSTRAINT "merchant_latlng_paired" CHECK (("merchant"."lat_e3" is null) = ("merchant"."lng_e3" is null));--> statement-breakpoint
ALTER TABLE "merchant" ADD CONSTRAINT "merchant_lat_range" CHECK ("merchant"."lat_e3" is null or "merchant"."lat_e3" between -90000 and 90000);--> statement-breakpoint
ALTER TABLE "merchant" ADD CONSTRAINT "merchant_lng_range" CHECK ("merchant"."lng_e3" is null or "merchant"."lng_e3" between -180000 and 180000);--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_latlng_paired" CHECK (("purchase"."lat_e3" is null) = ("purchase"."lng_e3" is null));--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_lat_range" CHECK ("purchase"."lat_e3" is null or "purchase"."lat_e3" between -90000 and 90000);--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_lng_range" CHECK ("purchase"."lng_e3" is null or "purchase"."lng_e3" between -180000 and 180000);