import { getSetting } from '@/lib/db'
import { getRouteEnvWithDb, jsonOk, jsonError } from '@/lib/server/route-helpers'
import { NextResponse } from 'next/server'

// 默认友情链接（当数据库中未配置时使用）
const DEFAULT_FRIEND_LINKS = [
  { label: '比特币导航站', url: 'https://btc.ngy123.com' },
  { label: '全球法币排行榜', url: 'https://fabi.ngy123.com' },
  { label: '以太坊资源导航', url: 'https://eth.ngy123.com' },
  { label: '高晓松资源下载', url: 'https://gxs.ngy123.com' },
  { label: '比特币资源下载站', url: 'https://btczy.ngy123.com' },
  { label: 'Binance', url: 'https://binance.ngy123.com' },
  { label: 'OKX', url: 'https://okx.ngy123.com' },
  { label: '天涯论坛', url: 'https://tianya.ngy123.com' },
  { label: '美女图库', url: 'https://meinv.ngy123.com' },
  { label: '出海导航', url: 'https://chuhai.ngy123.com' },
]

// 公开接口，无需鉴权 — 供前台页脚渲染友情链接
export async function GET() {
  try {
    const route = await getRouteEnvWithDb('No DB')
    if (!route.ok) {
      // DB 不可用时返回默认链接
      return NextResponse.json({ links: DEFAULT_FRIEND_LINKS }, {
        headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
      })
    }

    const raw = await getSetting(route.db, 'friend_links')
    if (!raw) {
      return NextResponse.json({ links: DEFAULT_FRIEND_LINKS }, {
        headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
      })
    }

    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return jsonOk({ links: parsed }, 200)
    }

    return NextResponse.json({ links: DEFAULT_FRIEND_LINKS }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    })
  } catch {
    return NextResponse.json({ links: DEFAULT_FRIEND_LINKS }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    })
  }
}
