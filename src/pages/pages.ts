export const PAGES = [
    { id: 'today', label: 'Today', path: '/today' },
    { id: 'schedule', label: 'Schedule', path: '/schedule' },
    { id: 'history', label: 'History', path: '/history' },
    { id: 'notes', label: 'Notes', path: '/notes' },
    { id: 'settings', label: 'Settings', path: '/settings' },
] as const

export type PageId = (typeof PAGES)[number]['id']

export const DEFAULT_PAGE_ID: PageId = 'today'

export const resolvePageId = (pathname: string): PageId => {
    const normalized = pathname.replace(/\/+$/, '') || '/'
    const match = PAGES.find((page) => page.path === normalized)
    return match ? match.id : DEFAULT_PAGE_ID
}

export const getPagePath = (pageId: PageId): string => {
    const match = PAGES.find((page) => page.id === pageId)
    return match ? match.path : '/today'
}
