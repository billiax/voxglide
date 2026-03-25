/**
 * Matches a URL pathname against a simple glob-like pattern.
 *
 * Supported patterns:
 *   "*"                  — matches everything
 *   "/exact/path"        — exact match
 *   "/prefix/*"          — matches any path starting with "/prefix/"
 *   "/path/to/page*"     — matches paths that start with "/path/to/page"
 */
export function matchUrlPattern(pattern: string, urlPath: string): boolean {
  if (pattern === '*') return true;

  // Trailing wildcard: "/foo/bar*" → prefix match
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return urlPath.startsWith(prefix);
  }

  // Exact match
  return urlPath === pattern;
}

/**
 * Test a URL path against an array of patterns.
 * Returns true if ANY pattern matches.
 */
export function matchesAnyPattern(patterns: string[], urlPath: string): boolean {
  return patterns.some((p) => matchUrlPattern(p, urlPath));
}
