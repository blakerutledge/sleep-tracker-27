import { type ReactNode, useEffect, useId, useRef } from 'react'
import styles from './ModalDialog.module.scss'

interface ModalDialogProps {
    open: boolean
    onClose: () => void
    title: string
    children: ReactNode
}

export const ModalDialog = ({ open, onClose, title, children }: ModalDialogProps) => {
    const dialogRef = useRef<HTMLDialogElement | null>(null)
    const titleId = useId()

    useEffect(() => {
        const dialog = dialogRef.current
        if (!dialog) return

        if (open && !dialog.open) {
            dialog.showModal()
        } else if (!open && dialog.open) {
            dialog.close()
        }
    }, [open])

    useEffect(() => {
        const dialog = dialogRef.current
        if (!dialog) return

        const handleClose = () => {
            dialog.returnValue = ''
            onClose()
        }

        dialog.addEventListener('close', handleClose)

        // Light-dismiss fallback for browsers without <dialog closedby="any"> (e.g., Safari)
        let cleanupBackdrop: (() => void) | undefined
        if (!('closedBy' in HTMLDialogElement.prototype)) {
            let pressedOutside = false
            const isOutside = (e: PointerEvent): boolean => {
                const rect = dialog.getBoundingClientRect()
                return (
                    e.clientX < rect.left ||
                    e.clientX > rect.right ||
                    e.clientY < rect.top ||
                    e.clientY > rect.bottom
                )
            }
            const onPointerDown = (e: PointerEvent) => {
                pressedOutside = dialog.open && isOutside(e)
            }
            const onPointerUp = (e: PointerEvent) => {
                if (dialog.open && pressedOutside && isOutside(e)) {
                    dialog.close()
                }
                pressedOutside = false
            }
            dialog.addEventListener('pointerdown', onPointerDown)
            dialog.addEventListener('pointerup', onPointerUp)
            cleanupBackdrop = () => {
                dialog.removeEventListener('pointerdown', onPointerDown)
                dialog.removeEventListener('pointerup', onPointerUp)
            }
        }

        return () => {
            dialog.removeEventListener('close', handleClose)
            cleanupBackdrop?.()
        }
    }, [onClose])

    return (
        <dialog
            ref={dialogRef}
            {...({ closedby: 'any' } as Record<string, string>)}
            aria-labelledby={titleId}
            className={styles.appDialog}>
            <div className={styles.dialogHead}>
                <h2 id={titleId} className={styles.dialogTitle}>
                    {title}
                </h2>
                <button
                    type='button'
                    className={styles.closeButton}
                    onClick={onClose}
                    aria-label='Close dialog'
                    title='Close'>
                    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
                        <path
                            d='M18 6 6 18M6 6l12 12'
                            stroke='currentColor'
                            strokeWidth='2.2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                        />
                    </svg>
                </button>
            </div>
            <div className={styles.dialogBody}>{children}</div>
        </dialog>
    )
}
