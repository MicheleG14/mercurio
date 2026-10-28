/**
 * What another module records in the warehouse (B35, docs/adr/0024): the kind of document
 * ("order"), its id and how people refer to it ("OC-2026/0012"). The warehouse keeps it as given,
 * without a foreign key and without knowing that module: the dependency goes the other way.
 */
export interface Origin {
  type: string;
  id: string;
  reference: string;
}

/** Options of a document recorded through the public service. */
export interface PostOptions {
  /** The day the document counts as recorded on (the demo seed); today by default. */
  today?: string;
  origin?: Origin;
  /**
   * Per line of the document, the origin line whose reservation it takes goods from first, or
   * null. Only for issues, and only with an origin (reservations belong to one).
   */
  reservations?: readonly (string | null)[];
}

export interface ReverseOptions {
  today?: string;
  /** The origin of the document: only its owner may reverse a document that has one. */
  origin?: Origin;
}
