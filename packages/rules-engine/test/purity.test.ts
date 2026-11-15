import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

describe('rules-engine purity (CLAUDE.md, SPEC §4.2)', () => {
  it('has zero runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg.dependencies === undefined || Object.keys(pkg.dependencies as object).length === 0).toBe(true);
  });

  it('source imports only its own modules, JSON scheme data and type-only shared types', () => {
    const files = readdirSync(join(root, 'src'), { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(join(root, 'src', f), 'utf8');
      for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?[^'"]*?from\s+'([^']+)'/gm)) {
        const isType = Boolean(m[2]) || /^export type \*/.test(m[0].trim());
        const spec = m[3]!;
        expect(spec.startsWith('.') || (spec === '@logmate/shared' && isType), `${f}: ${m[0].trim()}`).toBe(true);
      }
      expect(src, f).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random\(|performance\.now|process\.|fetch\(/);
    }
  });
});
