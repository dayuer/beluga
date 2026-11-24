/**
 * What went wrong, as words for the window (docs/design.md, "Building it once"). Browser-safe: the
 * Mac app's web view imports it.
 */

/** An error's message, or the thing itself as text when it isn't an Error. */
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The same, without the prefixes that only say it's an error or name the call: "Error: …" (from a
 * stringified error) and "Bad arguments for <method>: …" (the daemon's check of a call's input).
 */
export const errorWords = (err: unknown): string => errorText(err).replace(/^Error:\s*/, '').replace(/^Bad arguments for [\w.]+: /, '');
