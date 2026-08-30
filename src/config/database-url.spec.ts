import { describe, expect, it } from 'vitest';
import { secureDatabaseUrl } from './database-url';

describe('secureDatabaseUrl', () => {
  it('leaves local development URLs unchanged', () => {
    const local = 'postgresql://postgres:password@localhost:5432/loyalloop?schema=public';
    expect(secureDatabaseUrl(local)).toBe(local);
  });

  it('forces explicit hostname verification for remote databases', () => {
    const secured = new URL(secureDatabaseUrl(
      'postgresql://user:password@example.neon.tech/database?sslmode=require&uselibpqcompat=true',
    ));
    expect(secured.searchParams.get('sslmode')).toBe('verify-full');
    expect(secured.searchParams.has('uselibpqcompat')).toBe(false);
  });

  it('rejects non-PostgreSQL URLs', () => {
    expect(() => secureDatabaseUrl('mysql://user:password@example.com/database')).toThrow(
      'DATABASE_URL must use PostgreSQL',
    );
  });
});
