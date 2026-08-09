'use client'

import { useState } from 'react'

interface FriendLink {
  label: string
  url: string
}

interface Props {
  initialValue: string
  onSave: (value: string) => void
  saving: boolean
}

const defaultLinks: FriendLink[] = [
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

export function FriendLinksEditor({ initialValue, onSave, saving }: Props) {
  const parsed = initialValue ? (() => { try { return JSON.parse(initialValue) } catch { return null } })() : null
  const [links, setLinks] = useState<FriendLink[]>(parsed && Array.isArray(parsed) ? parsed : defaultLinks)

  const update = (idx: number, field: keyof FriendLink, value: string) => {
    setLinks((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)))
  }

  const remove = (idx: number) => setLinks((prev) => prev.filter((_, i) => i !== idx))

  const add = () => setLinks((prev) => [...prev, { label: '', url: '' }])

  const moveUp = (idx: number) => {
    if (idx <= 0) return
    setLinks((prev) => { const n = [...prev]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; return n })
  }

  const moveDown = (idx: number) => {
    if (idx >= links.length - 1) return
    setLinks((prev) => { const n = [...prev]; [n[idx], n[idx + 1]] = [n[idx + 1], n[idx]]; return n })
  }

  const inputCls = 'h-9 rounded-lg border border-[var(--editor-line)] bg-[var(--background)] px-3 text-sm text-[var(--editor-ink)] placeholder:text-[var(--editor-muted)] outline-none focus:border-[var(--editor-accent)] transition-colors'
  const btnCls = 'h-9 px-3 rounded-lg text-sm font-medium transition-colors'

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--editor-muted)]">
        管理页脚显示的友情链接。所有链接都将在新窗口打开。
      </p>
      {links.map((link, idx) => (
        <div key={idx} className="flex items-center gap-2 flex-wrap">
          <input
            className={`${inputCls} w-28`}
            placeholder="名称"
            value={link.label}
            onChange={(e) => update(idx, 'label', e.target.value)}
          />
          <input
            className={`${inputCls} flex-1 min-w-[180px]`}
            placeholder="https://"
            value={link.url}
            onChange={(e) => update(idx, 'url', e.target.value)}
          />
          <button onClick={() => moveUp(idx)} disabled={idx === 0} className={`${btnCls} bg-[var(--editor-soft)] text-[var(--editor-muted)] hover:text-[var(--editor-ink)] disabled:opacity-30`}>↑</button>
          <button onClick={() => moveDown(idx)} disabled={idx === links.length - 1} className={`${btnCls} bg-[var(--editor-soft)] text-[var(--editor-muted)] hover:text-[var(--editor-ink)] disabled:opacity-30`}>↓</button>
          <button onClick={() => remove(idx)} className={`${btnCls} text-red-500 hover:bg-rose-500/10`}>删除</button>
        </div>
      ))}

      <div className="flex items-center gap-3 pt-2">
        <button onClick={add} className={`${btnCls} bg-[var(--editor-soft)] text-[var(--editor-ink)] hover:bg-[var(--border-warm)]`}>
          + 添加链接
        </button>
        <button
          onClick={() => onSave(JSON.stringify(links))}
          disabled={saving}
          className={`${btnCls} bg-[var(--editor-accent)] text-[var(--editor-accent-ink)] hover:brightness-105 disabled:opacity-60`}
        >
          {saving ? '保存中…' : '保存友情链接'}
        </button>
      </div>
    </div>
  )
}
