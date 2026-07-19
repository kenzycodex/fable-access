// Plain shared constants — deliberately NOT a "use client" module.
//
// Server components (the /demo redirect, the [institution] layout) need these
// values as real strings. Importing them from a "use client" module hands the
// server a client-reference proxy instead, which produced an invalid Location
// header when the /demo redirect tried to interpolate one.

/** The tenant that pre-multi-tenant data belongs to, and where an un-scoped
 * /demo visit lands. Mirrors DEFAULT_INSTITUTION_ID in api/db.py. */
export const DEFAULT_INSTITUTION = "meridian";
