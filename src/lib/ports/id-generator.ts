/** Generates UUIDv7 (time-sortable) identifiers. */
export interface IdGenerator {
	newId(): string;
}
