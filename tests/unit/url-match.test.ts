import { describe, it, expect } from 'vitest';
import { matchUrlPattern, matchesAnyPattern } from '../../server/url-match';

describe('matchUrlPattern', () => {
  it('wildcard "*" matches everything', () => {
    expect(matchUrlPattern('*', '/')).toBe(true);
    expect(matchUrlPattern('*', '/any/path')).toBe(true);
    expect(matchUrlPattern('*', '/tools/tasks')).toBe(true);
  });

  it('exact match works', () => {
    expect(matchUrlPattern('/tools/tasks', '/tools/tasks')).toBe(true);
    expect(matchUrlPattern('/tools/tasks', '/tools/tasks/')).toBe(false);
    expect(matchUrlPattern('/tools/tasks', '/tools')).toBe(false);
  });

  it('trailing wildcard matches prefix', () => {
    expect(matchUrlPattern('/tools/files/viewer*', '/tools/files/viewer')).toBe(true);
    expect(matchUrlPattern('/tools/files/viewer*', '/tools/files/viewer/doc.md')).toBe(true);
    expect(matchUrlPattern('/tools/files/viewer*', '/tools/files')).toBe(false);
    expect(matchUrlPattern('/tools/files/viewer*', '/other/path')).toBe(false);
  });

  it('trailing /* matches subpaths', () => {
    expect(matchUrlPattern('/tools/*', '/tools/')).toBe(true);
    expect(matchUrlPattern('/tools/*', '/tools/tasks')).toBe(true);
    expect(matchUrlPattern('/tools/*', '/tools/files/viewer')).toBe(true);
    expect(matchUrlPattern('/tools/*', '/tools')).toBe(false);
  });

  it('handles root path', () => {
    expect(matchUrlPattern('/', '/')).toBe(true);
    expect(matchUrlPattern('/', '/other')).toBe(false);
    expect(matchUrlPattern('/*', '/')).toBe(true);
    expect(matchUrlPattern('/*', '/anything')).toBe(true);
  });
});

describe('matchesAnyPattern', () => {
  it('returns true if any pattern matches', () => {
    expect(matchesAnyPattern(['*'], '/any')).toBe(true);
    expect(matchesAnyPattern(['/a', '/b'], '/b')).toBe(true);
  });

  it('returns false if no pattern matches', () => {
    expect(matchesAnyPattern(['/a', '/b'], '/c')).toBe(false);
  });

  it('returns false for empty patterns', () => {
    expect(matchesAnyPattern([], '/any')).toBe(false);
  });
});
