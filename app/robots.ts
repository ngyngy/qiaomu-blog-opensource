import type { MetadataRoute } from 'next'
import { getSiteUrl } from '@/lib/site-config'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getSiteUrl()
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // /search 每次都要 LIKE 全表扫描（还要读 content 正文），
        // 让爬虫去爬它等于白送 D1 行读取配额
        disallow: ['/admin/', '/editor', '/api/', '/search'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
