import { describe, expect, it } from 'vitest'
import { assertReadOnlyOrAllowed } from '../../src/safety/DbGuard.js'
import { DbWriteBlockedError } from '../../src/util/errors.js'

describe('DbGuard', () => {
  it('allows SELECT', () => {
    expect(() => assertReadOnlyOrAllowed('SELECT * FROM wp_posts', false)).not.toThrow()
  })

  it('allows SHOW', () => {
    expect(() => assertReadOnlyOrAllowed('SHOW TABLES', false)).not.toThrow()
  })

  it('allows DESCRIBE / DESC', () => {
    expect(() => assertReadOnlyOrAllowed('DESCRIBE wp_posts', false)).not.toThrow()
    expect(() => assertReadOnlyOrAllowed('DESC wp_posts', false)).not.toThrow()
  })

  it('allows EXPLAIN', () => {
    expect(() => assertReadOnlyOrAllowed('EXPLAIN SELECT * FROM wp_posts', false)).not.toThrow()
  })

  it('case-insensitive', () => {
    expect(() => assertReadOnlyOrAllowed('select 1', false)).not.toThrow()
    expect(() => assertReadOnlyOrAllowed('Select 1', false)).not.toThrow()
  })

  it('allows leading whitespace', () => {
    expect(() => assertReadOnlyOrAllowed('   \n  SELECT 1', false)).not.toThrow()
  })

  it('strips line comments before checking', () => {
    expect(() => assertReadOnlyOrAllowed('-- a comment\nSELECT 1', false)).not.toThrow()
  })

  it('strips block comments before checking', () => {
    expect(() => assertReadOnlyOrAllowed('/* note */ SELECT 1', false)).not.toThrow()
  })

  it('allows WITH ... SELECT (CTE)', () => {
    expect(() =>
      assertReadOnlyOrAllowed(
        'WITH recent AS (SELECT * FROM wp_posts ORDER BY ID DESC LIMIT 10) SELECT * FROM recent',
        false,
      ),
    ).not.toThrow()
  })

  it('blocks INSERT by default', () => {
    expect(() => assertReadOnlyOrAllowed("INSERT INTO wp_posts (post_title) VALUES ('x')", false)).toThrow(
      DbWriteBlockedError,
    )
  })

  it('blocks UPDATE by default', () => {
    expect(() => assertReadOnlyOrAllowed("UPDATE wp_posts SET post_title='x' WHERE ID=1", false)).toThrow(
      DbWriteBlockedError,
    )
  })

  it('blocks DELETE by default', () => {
    expect(() => assertReadOnlyOrAllowed('DELETE FROM wp_posts WHERE ID=1', false)).toThrow(
      DbWriteBlockedError,
    )
  })

  it('blocks DROP / TRUNCATE / ALTER', () => {
    expect(() => assertReadOnlyOrAllowed('DROP TABLE wp_posts', false)).toThrow(DbWriteBlockedError)
    expect(() => assertReadOnlyOrAllowed('TRUNCATE wp_posts', false)).toThrow(DbWriteBlockedError)
    expect(() => assertReadOnlyOrAllowed('ALTER TABLE wp_posts ADD foo INT', false)).toThrow(
      DbWriteBlockedError,
    )
  })

  it('blocks empty / whitespace-only', () => {
    expect(() => assertReadOnlyOrAllowed('', false)).toThrow(DbWriteBlockedError)
    expect(() => assertReadOnlyOrAllowed('   \n\t  ', false)).toThrow(DbWriteBlockedError)
  })

  it('allows anything when allowWrite=true', () => {
    expect(() =>
      assertReadOnlyOrAllowed('DELETE FROM wp_posts WHERE ID=1', true),
    ).not.toThrow()
    expect(() => assertReadOnlyOrAllowed('DROP TABLE wp_posts', true)).not.toThrow()
  })
})
