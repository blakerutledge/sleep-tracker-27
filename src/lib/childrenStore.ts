import { onAuthStateChanged, type User } from 'firebase/auth'
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { auth, db, isAllowedEmail } from './firebase.ts'

export const MAX_CHILDREN = 10

export const CHILD_PRONOUNS_OPTIONS = ['she/her', 'he/him', 'they/them'] as const
export type ChildPronouns = (typeof CHILD_PRONOUNS_OPTIONS)[number]

export interface ChildProfile {
    id: string
    name: string
    pronouns: ChildPronouns
    birthDate: string
    activeScheduleId: string | null
    createdAt: number
    updatedAt: number
}

const CHILDREN_KEY = 'sleep-tracker-27:children'
const ACTIVE_CHILD_KEY = 'sleep-tracker-27:active-child-id'
const CHILDREN_EVENT = 'sleep-27:children-changed'
const ACTIVE_CHILD_EVENT = 'sleep-27:active-child-changed'

const isChildPronouns = (value: unknown): value is ChildPronouns =>
    value === 'she/her' || value === 'he/him' || value === 'they/them'

const generateId = (prefix: string): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

const createDefaultChild = (): ChildProfile => {
    const now = Date.now()
    return {
        id: 'child-default',
        name: 'Baby',
        pronouns: 'they/them',
        birthDate: '2027-01-01',
        activeScheduleId: null,
        createdAt: now,
        updatedAt: now,
    }
}

const parseChildProfile = (item: unknown): ChildProfile | null => {
    if (typeof item !== 'object' || item === null) return null
    const raw = item as Partial<ChildProfile>
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
    return {
        id: raw.id,
        name: raw.name.trim() || 'Baby',
        pronouns: isChildPronouns(raw.pronouns) ? raw.pronouns : 'they/them',
        birthDate:
            typeof raw.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.birthDate)
                ? raw.birthDate
                : '2027-01-01',
        activeScheduleId: typeof raw.activeScheduleId === 'string' ? raw.activeScheduleId : null,
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    }
}

const readLocalChildren = (): ChildProfile[] => {
    try {
        const raw = localStorage.getItem(CHILDREN_KEY)
        if (!raw) return [createDefaultChild()]
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return [createDefaultChild()]
        const valid = parsed
            .map(parseChildProfile)
            .filter((item): item is ChildProfile => item !== null)
            .sort((a, b) => a.createdAt - b.createdAt)
        return valid.length > 0 ? valid.slice(0, MAX_CHILDREN) : [createDefaultChild()]
    } catch {
        return [createDefaultChild()]
    }
}

const writeLocalChildren = (children: readonly ChildProfile[]): void => {
    try {
        localStorage.setItem(CHILDREN_KEY, JSON.stringify(children))
        window.dispatchEvent(new Event(CHILDREN_EVENT))
    } catch {
        // Ignore storage quota errors
    }
}

const readActiveChildId = (): string | null => {
    try {
        return localStorage.getItem(ACTIVE_CHILD_KEY)
    } catch {
        return null
    }
}

const writeActiveChildId = (childId: string): void => {
    try {
        localStorage.setItem(ACTIVE_CHILD_KEY, childId)
        window.dispatchEvent(new Event(ACTIVE_CHILD_EVENT))
    } catch {
        // Ignore storage quota errors
    }
}

export interface ChildrenStoreState {
    children: ChildProfile[]
    activeChild: ChildProfile
    activeChildId: string
    syncMode: 'cloud' | 'local'
    setActiveChildId: (childId: string) => void
    addChild: (input: { name: string; pronouns: ChildPronouns; birthDate: string }) => Promise<void>
    updateChild: (
        childId: string,
        patch: Partial<Pick<ChildProfile, 'name' | 'pronouns' | 'birthDate'>>,
    ) => Promise<void>
    deleteChild: (childId: string) => Promise<void>
    setChildActiveScheduleId: (childId: string, scheduleId: string | null) => Promise<void>
}

export const useChildren = (): ChildrenStoreState => {
    const [authUser, setAuthUser] = useState<User | null>(null)
    const [localChildren, setLocalChildren] = useState<ChildProfile[]>(() => readLocalChildren())
    const [cloudChildren, setCloudChildren] = useState<ChildProfile[] | null>(null)
    const [storedActiveId, setStoredActiveId] = useState<string | null>(() => readActiveChildId())
    const seededRef = useRef(false)

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user && isAllowedEmail(user.email)) {
                setAuthUser(user)
            } else {
                setAuthUser(null)
                setCloudChildren(null)
                seededRef.current = false
            }
        })
        return unsubscribe
    }, [])

    useEffect(() => {
        const handleLocalSync = () => setLocalChildren(readLocalChildren())
        const handleActiveSync = () => setStoredActiveId(readActiveChildId())
        window.addEventListener(CHILDREN_EVENT, handleLocalSync)
        window.addEventListener(ACTIVE_CHILD_EVENT, handleActiveSync)
        return () => {
            window.removeEventListener(CHILDREN_EVENT, handleLocalSync)
            window.removeEventListener(ACTIVE_CHILD_EVENT, handleActiveSync)
        }
    }, [])

    useEffect(() => {
        if (!authUser) return
        const childrenRef = collection(db, 'households', 'family', 'children')
        const q = query(childrenRef, orderBy('createdAt', 'asc'))
        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                if (!seededRef.current) {
                    seededRef.current = true
                    const initial = readLocalChildren()
                    for (const child of initial) {
                        void setDoc(doc(db, 'households', 'family', 'children', child.id), child)
                    }
                }
                return
            }
            const next = snapshot.docs
                .map((snap) => parseChildProfile({ id: snap.id, ...snap.data() }))
                .filter((item): item is ChildProfile => item !== null)
                .slice(0, MAX_CHILDREN)
            if (next.length > 0) {
                setCloudChildren(next)
                writeLocalChildren(next)
            }
        })
        return unsubscribe
    }, [authUser])

    const syncMode: 'cloud' | 'local' = authUser ? 'cloud' : 'local'
    const children = useMemo(
        () => (cloudChildren && cloudChildren.length > 0 ? cloudChildren : localChildren),
        [cloudChildren, localChildren],
    )

    const activeChild = useMemo(() => {
        const matched = storedActiveId
            ? children.find((child) => child.id === storedActiveId)
            : undefined
        return matched ?? children[0] ?? createDefaultChild()
    }, [children, storedActiveId])

    const setActiveChildId = useCallback((childId: string) => {
        setStoredActiveId(childId)
        writeActiveChildId(childId)
    }, [])

    const persistChild = useCallback(
        async (child: ChildProfile) => {
            const current = cloudChildren ?? readLocalChildren()
            const exists = current.some((item) => item.id === child.id)
            const next = exists
                ? current.map((item) => (item.id === child.id ? child : item))
                : [...current, child].slice(0, MAX_CHILDREN)

            writeLocalChildren(next)
            setLocalChildren(next)

            if (authUser) {
                await setDoc(doc(db, 'households', 'family', 'children', child.id), child)
            }
        },
        [authUser, cloudChildren],
    )

    const addChild = useCallback(
        async (input: { name: string; pronouns: ChildPronouns; birthDate: string }) => {
            if (children.length >= MAX_CHILDREN) return
            const now = Date.now()
            const child: ChildProfile = {
                id: generateId('child'),
                name: input.name.trim() || 'Baby',
                pronouns: input.pronouns,
                birthDate: input.birthDate || '2027-01-01',
                activeScheduleId: null,
                createdAt: now,
                updatedAt: now,
            }
            await persistChild(child)
            setActiveChildId(child.id)
        },
        [children.length, persistChild, setActiveChildId],
    )

    const updateChild = useCallback(
        async (
            childId: string,
            patch: Partial<Pick<ChildProfile, 'name' | 'pronouns' | 'birthDate'>>,
        ) => {
            const target = children.find((item) => item.id === childId)
            if (!target) return
            const updated: ChildProfile = {
                ...target,
                ...(patch.name !== undefined ? { name: patch.name.trim() || target.name } : {}),
                ...(patch.pronouns !== undefined ? { pronouns: patch.pronouns } : {}),
                ...(patch.birthDate !== undefined ? { birthDate: patch.birthDate } : {}),
                updatedAt: Date.now(),
            }
            await persistChild(updated)
        },
        [children, persistChild],
    )

    const deleteChild = useCallback(
        async (childId: string) => {
            if (children.length <= 1) return
            const next = children.filter((item) => item.id !== childId)
            writeLocalChildren(next)
            setLocalChildren(next)
            if (activeChild.id === childId && next[0]) {
                setActiveChildId(next[0].id)
            }
            if (authUser) {
                await deleteDoc(doc(db, 'households', 'family', 'children', childId))
            }
        },
        [activeChild.id, authUser, children, setActiveChildId],
    )

    const setChildActiveScheduleId = useCallback(
        async (childId: string, scheduleId: string | null) => {
            const target = children.find((item) => item.id === childId)
            if (!target || target.activeScheduleId === scheduleId) return
            await persistChild({
                ...target,
                activeScheduleId: scheduleId,
                updatedAt: Date.now(),
            })
        },
        [children, persistChild],
    )

    return {
        children,
        activeChild,
        activeChildId: activeChild.id,
        syncMode,
        setActiveChildId,
        addChild,
        updateChild,
        deleteChild,
        setChildActiveScheduleId,
    }
}
