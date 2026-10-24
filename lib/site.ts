import { normalizeTheme, type Theme } from '@/lib/appearance'
import { getPublicCategories, getSetting } from '@/lib/db'
import { memoize } from '@/lib/server/memory-cache'

// 每个公开页面都要渲染页头，而 getPublicCategories 是一次 JOIN + GROUP BY，
// 会扫过整张 posts 表。这里在 isolate 内做 60 秒记忆化，避免同一个 isolate 里
// 反复全表扫描。（针对 D1 每日行读取超限问题的第二道防线）
const HEADER_CACHE_TTL_MS = 60_000

export interface SiteNavLink {
  label: string
  url: string
  openInNewTab: boolean
}

export interface SiteCategoryLink {
  name: string
  slug: string
}

export interface SiteHeaderData {
  navLinks: SiteNavLink[]
  categories: SiteCategoryLink[]
  defaultTheme: Theme
}

export function getSiteHeaderData(db: D1Database): Promise<SiteHeaderData> {
  return memoize('site:header', HEADER_CACHE_TTL_MS, () => loadSiteHeaderData(db))
}

async function loadSiteHeaderData(db: D1Database): Promise<SiteHeaderData> {
  let navLinks: SiteNavLink[] = []
  let categories: SiteCategoryLink[] = []
  let defaultTheme: Theme = 'default'

  try {
    const [navJson, categoryRows, themeValue] = await Promise.all([
      getSetting(db, 'nav_links'),
      getPublicCategories(db),
      getSetting(db, 'default_theme'),
    ])

    if (navJson) {
      try {
        const parsed = JSON.parse(navJson)
        if (Array.isArray(parsed)) {
          navLinks = parsed
        }
      } catch {}
    }

    categories = categoryRows
      .filter((category) => category.slug && category.name && category.name !== '未分类')
      .map((category) => ({
        name: category.name,
        slug: category.slug,
      }))

    defaultTheme = normalizeTheme(themeValue)
  } catch {
    // Keep graceful fallback behavior for public pages
  }

  return { navLinks, categories, defaultTheme }
}
