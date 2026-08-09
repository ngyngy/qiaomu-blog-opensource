import { describe, expect, it } from 'vitest'
import { extractTweetId } from '@/lib/twitter-widgets'

describe('twitter-widgets', () => {
  it('extracts tweet id from x.com urls', () => {
    expect(extractTweetId('https://x.com/nangongyuan/status/1914648153460199766')).toBe('1914648153460199766')
  })

  it('extracts tweet id from twitter.com urls', () => {
    expect(extractTweetId('https://twitter.com/nangongyuan/status/1914648153460199766')).toBe('1914648153460199766')
  })

  it('returns null for non-status urls', () => {
    expect(extractTweetId('https://x.com/nangongyuan')).toBeNull()
  })
})
