import { type FormEvent, useState } from 'react'
import { ModalDialog } from '#src/components/ModalDialog/index.tsx'
import type { SavedSchedule } from '#src/lib/scheduleStore.ts'
import styles from './SchedulePicker.module.scss'

interface SchedulePickerProps {
    open: boolean
    childName: string
    schedules: readonly SavedSchedule[]
    activeScheduleId: string
    isDirty: boolean
    onClose: () => void
    onLoad: (scheduleId: string) => Promise<void>
    onSaveAsNew: (name: string) => Promise<void>
    onRename: (scheduleId: string, name: string) => Promise<void>
    onDelete: (scheduleId: string) => Promise<void>
}

export const SchedulePicker = ({
    open,
    childName,
    schedules,
    activeScheduleId,
    isDirty,
    onClose,
    onLoad,
    onSaveAsNew,
    onRename,
    onDelete,
}: SchedulePickerProps) => {
    const [newName, setNewName] = useState('')
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [busy, setBusy] = useState(false)

    const handleSaveAsNew = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const trimmed = newName.trim()
        if (!trimmed || busy) return
        setBusy(true)
        try {
            await onSaveAsNew(trimmed)
            setNewName('')
            onClose()
        } finally {
            setBusy(false)
        }
    }

    const handleCommitRename = async (event: FormEvent<HTMLFormElement>, scheduleId: string) => {
        event.preventDefault()
        const trimmed = renameValue.trim()
        if (!trimmed || busy) return
        setBusy(true)
        try {
            await onRename(scheduleId, trimmed)
            setRenamingId(null)
            setRenameValue('')
        } finally {
            setBusy(false)
        }
    }

    const handleLoad = async (scheduleId: string) => {
        if (busy) return
        setBusy(true)
        try {
            await onLoad(scheduleId)
            onClose()
        } finally {
            setBusy(false)
        }
    }

    const handleDelete = async (scheduleId: string) => {
        if (busy || schedules.length <= 1) return
        setBusy(true)
        try {
            await onDelete(scheduleId)
        } finally {
            setBusy(false)
        }
    }

    return (
        <ModalDialog open={open} onClose={onClose} title={`${childName} · Schedules`}>
            <div className={styles.body}>
                {isDirty && (
                    <p className={styles.dirtyNote}>
                        Unsaved edits will be discarded if you load another schedule, or save them
                        as a new schedule below.
                    </p>
                )}

                <div className={styles.list}>
                    {schedules.map((schedule) => {
                        const isActive = schedule.id === activeScheduleId
                        const isRenaming = renamingId === schedule.id

                        if (isRenaming) {
                            return (
                                <form
                                    key={schedule.id}
                                    className={styles.renameRow}
                                    onSubmit={(e) => handleCommitRename(e, schedule.id)}>
                                    <input
                                        type='text'
                                        className={styles.input}
                                        value={renameValue}
                                        onChange={(e) => setRenameValue(e.target.value)}
                                        maxLength={40}
                                        aria-label='Schedule name'
                                        required
                                    />
                                    <button
                                        type='submit'
                                        className={styles.smallPrimary}
                                        aria-label='Save schedule name'
                                        title='Save'
                                        disabled={busy}>
                                        <svg
                                            width='16'
                                            height='16'
                                            viewBox='0 0 24 24'
                                            fill='none'
                                            aria-hidden='true'>
                                            <path
                                                d='M20 6 9 17l-5-5'
                                                stroke='currentColor'
                                                strokeWidth='2.3'
                                                strokeLinecap='round'
                                                strokeLinejoin='round'
                                            />
                                        </svg>
                                    </button>
                                    <button
                                        type='button'
                                        className={styles.smallSecondary}
                                        aria-label='Cancel rename'
                                        title='Cancel'
                                        onClick={() => setRenamingId(null)}>
                                        <svg
                                            width='16'
                                            height='16'
                                            viewBox='0 0 24 24'
                                            fill='none'
                                            aria-hidden='true'>
                                            <path
                                                d='M18 6 6 18M6 6l12 12'
                                                stroke='currentColor'
                                                strokeWidth='2.2'
                                                strokeLinecap='round'
                                                strokeLinejoin='round'
                                            />
                                        </svg>
                                    </button>
                                </form>
                            )
                        }

                        return (
                            <div key={schedule.id} className={styles.item} data-active={isActive}>
                                <button
                                    type='button'
                                    className={styles.itemMain}
                                    disabled={busy}
                                    onClick={() => handleLoad(schedule.id)}>
                                    <span className={styles.itemName}>{schedule.name}</span>
                                    {isActive && <span className={styles.activeBadge}>Active</span>}
                                </button>
                                <div className={styles.itemActions}>
                                    <button
                                        type='button'
                                        className={styles.linkAction}
                                        onClick={() => {
                                            setRenamingId(schedule.id)
                                            setRenameValue(schedule.name)
                                        }}>
                                        Rename
                                    </button>
                                    {schedules.length > 1 && (
                                        <button
                                            type='button'
                                            className={styles.dangerAction}
                                            disabled={busy}
                                            onClick={() => handleDelete(schedule.id)}>
                                            Delete
                                        </button>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>

                <form className={styles.saveAsForm} onSubmit={handleSaveAsNew}>
                    <input
                        type='text'
                        className={styles.input}
                        placeholder='New schedule name...'
                        aria-label='New schedule name'
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        maxLength={40}
                        required
                    />
                    <button
                        type='submit'
                        className={styles.primaryButton}
                        aria-label='Save as new schedule'
                        title='Save as new schedule'
                        disabled={busy || newName.trim().length === 0}>
                        <svg
                            width='18'
                            height='18'
                            viewBox='0 0 24 24'
                            fill='none'
                            aria-hidden='true'>
                            <path
                                d='M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z'
                                stroke='currentColor'
                                strokeWidth='2.1'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                            />
                            <path
                                d='M17 21v-7H7v7M7 3v5h8'
                                stroke='currentColor'
                                strokeWidth='2.1'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                            />
                        </svg>
                    </button>
                </form>
            </div>
        </ModalDialog>
    )
}
