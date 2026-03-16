/**
 * Simple string hash function (DJB2 variant).
 * Used for change detection fingerprinting across the SDK.
 */
export function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
