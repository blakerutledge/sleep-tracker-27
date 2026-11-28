import { useEffect, useMemo, useState } from 'react'
import { ModalDialog } from '#src/components/ModalDialog/index.tsx'
import type { ScheduleEvent } from '#src/data/schedule.ts'
import { formatAutoScheduleName, type SavedSchedule } from '#src/lib/scheduleStore.ts'
import styles from './SchedulePicker.module.scss'

interface SchedulePickerProps {
    open: boolean
    childName: string
    childBirthDate: string
    draftEvents: readonly ScheduleEvent[]
    schedules: readonly SavedSchedule[]
    activeScheduleId: string
    isDirty: boolean
    onClose: () => void
    onLoad: (scheduleId: string) => Promise<void>
    onSaveAsNew: () => Promise<void>
    onDelete: (scheduleId: string) => Promise<void>
}

const formatCreatedDate = (epochMs: number): string => {
    const date = new Date(epochMs)
    const sameYear = date.getFullYear() === new Date().getFullYear()
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(sameYear ? {} : { year: 'numeric' }),
    })
}

export const SchedulePicker = ({
    open,
    childName,
    childBirthDate,
    draftEvents,
    schedules,
    activeScheduleId,
    isDirty,
    onClose,
    onLoad,
    onSaveAsNew,
    onDelete,
}: SchedulePickerProps) => {
    const [editing, setEditing] = useState(false)
    const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const autoName = useMemo(
        () => formatAutoScheduleName(childBirthDate, draftEvents),
        [childBirthDate, draftEvents],
    )

    useEffect(() => {
        if (!open) {
            setEditing(false)
            setConfirmingDeleteId(null)
        }
    }, [open])

    useEffect(() => {
        if (schedules.length <= 1 && editing) {
            setEditing(false)
            setConfirmingDeleteId(null)
        }
    }, [editing, schedules.length])

    const handleSaveAsNew = async () => {
        if (busy) return
        setBusy(true)
        try {
            await onSaveAsNew()
            onClose()
        } finally {
            setBusy(false)
        }
    }

    const handleLoad = async (scheduleId: string) => {
        if (busy || editing) return
        setBusy(true)
        try {
            await onLoad(scheduleId)
            onClose()
        } finally {
            setBusy(false)
        }
    }

    const handleConfirmDelete = async (scheduleId: string) => {
        if (busy || schedules.length <= 1) return
        setBusy(true)
        try {
            await onDelete(scheduleId)
            setConfirmingDeleteId(null)
        } finally {
            setBusy(false)
        }
    }

    return (
        <ModalDialog open={open} onClose={onClose} title={`${childName} · Schedules`}>
            <div className={styles.body}>
                {(isDirty || schedules.length > 1) && (
                    <div className={styles.subHeader}>
                        {isDirty ? (
                            <p className={styles.dirtyNote}>
                                Unsaved edits will be lost if you switch.
                            </p>
                        ) : (
                            <span />
                        )}
                        {schedules.length > 1 && (
                            <button
                                type='button'
                                className={styles.editToggle}
                                onClick={() => {
                                    setEditing((prev) => !prev)
                                    setConfirmingDeleteId(null)
                                }}>
                                {editing ? 'Done' : 'Edit'}
                            </button>
                        )}
                    </div>
                )}

                <ul className={styles.list}>
                    {schedules.map((schedule) => {
                        const isActive = schedule.id === activeScheduleId
                        const isConfirmingDelete = confirmingDeleteId === schedule.id

                        if (isConfirmingDelete) {
                            return (
                                <li key={schedule.id} className={styles.confirmRow}>
                                    <span className={styles.confirmText}>
                                        Delete {schedule.name}?
                                    </span>
                                    <div className={styles.confirmButtons}>
                                        <button
                                            type='button'
                                            className={styles.confirmCancel}
                                            disabled={busy}
                                            onClick={() => setConfirmingDeleteId(null)}>
                                            Cancel
                                        </button>
                                        <button
                                            type='button'
                                            className={styles.confirmDelete}
                                            disabled={busy}
                                            onClick={() => void handleConfirmDelete(schedule.id)}>
                                            Delete
                                        </button>
                                    </div>
                                </li>
                            )
                        }

                        return (
                            <li key={schedule.id} className={styles.row} data-active={isActive}>
                                <button
                                    type='button'
                                    className={styles.rowButton}
                                    disabled={busy || editing}
                                    onClick={() => void handleLoad(schedule.id)}>
                                    <span className={styles.rowLeft}>
                                        <span className={styles.rowName}>{schedule.name}</span>
                                        {isActive && (
                                            <svg
                                                className={styles.activeCheck}
                                                width='15'
                                                height='15'
                                                viewBox='0 0 24 24'
                                                fill='none'
                                                aria-label='Active schedule'>
                                                <path
                                                    d='M5 13l4 4L19 7'
                                                    stroke='currentColor'
                                                    strokeWidth='2.5'
                                                    strokeLinecap='round'
                                                    strokeLinejoin='round'
                                                />
                                            </svg>
                                        )}
                                    </span>
                                    {!editing && (
                                        <span className={styles.rowDate}>
                                            {formatCreatedDate(schedule.createdAt)}
                                        </span>
                                    )}
                                </button>

                                {editing && schedules.length > 1 && (
                                    <button
                                        type='button'
                                        className={styles.deleteAction}
                                        aria-label={`Delete ${schedule.name}`}
                                        title={`Delete ${schedule.name}`}
                                        disabled={busy}
                                        onClick={() => setConfirmingDeleteId(schedule.id)}>
                                        <svg
                                            width='16'
                                            height='16'
                                            viewBox='0 0 24 24'
                                            fill='none'
                                            aria-hidden='true'>
                                            <path
                                                d='M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6'
                                                stroke='currentColor'
                                                strokeWidth='2'
                                                strokeLinecap='round'
                                                strokeLinejoin='round'
                                            />
                                        </svg>
                                    </button>
                                )}
                            </li>
                        )
                    })}
                </ul>

                <div className={styles.footer}>
                    <button
                        type='button'
                        className={styles.saveCopyButton}
                        disabled={busy}
                        onClick={() => void handleSaveAsNew()}>
                        <span>Save Copy</span>
                        <span className={styles.saveCopyMeta}>{autoName}</span>
                    </button>
                </div>
            </div>
        </ModalDialog>
    )
}
