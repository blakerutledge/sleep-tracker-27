import type { Ref } from 'react'
import { DIAL_COLORS } from '#src/styles/palette.ts'
import styles from './DialKey.module.scss'

interface DialKeyProps {
    ref?: Ref<HTMLUListElement>
    exiting?: boolean
    hidden?: boolean
}

const awakeSwatchStyle = {
    backgroundColor: DIAL_COLORS.awakeWedge.fillInnerColor,
    color: DIAL_COLORS.keyIcon,
}

const sleepSwatchStyle = {
    backgroundColor: DIAL_COLORS.sleepWedge.fillInnerColor,
    color: DIAL_COLORS.keyIcon,
}

export const DialKey = ({ ref, exiting = false, hidden = false }: DialKeyProps) => (
    <ul
        ref={ref}
        className={styles.key}
        data-exiting={exiting}
        data-hidden={hidden}
        aria-hidden={hidden}
        aria-label='Dial key'>
        <li className={styles.item} aria-label='Awake' title='Awake'>
            <span className={styles.swatch} style={awakeSwatchStyle} aria-hidden='true'>
                <svg className={styles.icon} viewBox='14 17 72 65' fill='none'>
                    <path
                        d='M57.7498 62.5101C56.8198 61.4101 55.3298 60.9501 54.0398 61.3701C52.9698 61.7101 52.3298 61.7701 52.0798 61.7601C51.4898 61.7601 50.9098 61.7001 50.3398 61.6401C48.8998 61.4801 47.0998 61.2901 46.0198 62.8401C45.3198 63.8401 45.3098 65.0701 46.0098 66.4801C47.1798 68.8601 49.1598 70.2301 51.4498 70.2601H51.5198C54.1298 70.2601 56.7998 68.4801 58.1798 65.8201C58.7398 64.7501 58.5698 63.4801 57.7498 62.5101Z'
                        fill='currentColor'
                    />
                    <path
                        d='M23.8299 61.0101C16.1699 58.2101 12.7699 45.3901 25.4699 46.4401'
                        stroke='currentColor'
                        strokeWidth='4.5'
                        strokeMiterlimit='10'
                        strokeLinecap='round'
                    />
                    <path
                        d='M74.5398 66.1901C82.6898 66.4801 87.7298 55.4401 76.9998 52.6301'
                        stroke='currentColor'
                        strokeWidth='4.5'
                        strokeMiterlimit='10'
                        strokeLinecap='round'
                    />
                    <path
                        d='M50.3978 32.5929C65.3368 32.6998 77.3724 43.2314 77.2802 56.1158C77.188 69.0003 65.0029 79.3586 50.064 79.2517C35.125 79.1448 23.0894 68.6132 23.1816 55.7287C23.2738 42.8442 35.4589 32.486 50.3978 32.5929Z'
                        stroke='currentColor'
                        strokeWidth='4.5'
                        strokeMiterlimit='10'
                        strokeLinecap='round'
                    />
                    <path
                        d='M50.74 36.7001C43.6 28.4501 50.74 17.7601 56.25 20.4101C60.24 22.3301 59.97 27.2401 55.39 26.7001'
                        stroke='currentColor'
                        strokeWidth='4.5'
                        strokeMiterlimit='10'
                        strokeLinecap='round'
                    />
                    <path
                        d='M57.1199 57.1C59.1799 57.1 60.8499 54.9062 60.8499 52.2001C60.8499 49.4939 59.1799 47.3 57.1199 47.3C55.0599 47.3 53.3899 49.4939 53.3899 52.2001C53.3899 54.9062 55.0599 57.1 57.1199 57.1Z'
                        fill='currentColor'
                    />
                    <path
                        d='M40.3001 56.9101C42.3601 56.9101 44.0301 54.7163 44.0301 52.0101C44.0301 49.3039 42.3601 47.1101 40.3001 47.1101C38.24 47.1101 36.5701 49.3039 36.5701 52.0101C36.5701 54.7163 38.24 56.9101 40.3001 56.9101Z'
                        fill='currentColor'
                    />
                </svg>
            </span>
        </li>

        <li className={styles.item} aria-label='Sleep' title='Sleep'>
            <span className={styles.swatch} style={sleepSwatchStyle} aria-hidden='true'>
                <svg className={styles.icon} viewBox='19 19 62 62' fill='none'>
                    <path
                        d='M38.99 61.28C39.23 63.57 42.54 66.42 46.4 64.93'
                        stroke='currentColor'
                        strokeWidth='4.5'
                        strokeMiterlimit='10'
                        strokeLinecap='round'
                    />
                    <path
                        d='M50.3699 50.23C48.5799 54.17 52.0999 58.6 56.6299 58.77'
                        stroke='currentColor'
                        strokeWidth='4.5'
                        strokeMiterlimit='10'
                        strokeLinecap='round'
                    />
                    <path
                        d='M45.2199 44.7101C41.1599 46.2201 36.9899 42.3901 37.1399 37.8601'
                        stroke='currentColor'
                        strokeWidth='4.5'
                        strokeMiterlimit='10'
                        strokeLinecap='round'
                    />
                    <path
                        d='M25.65 36.0301C21.99 28.7401 28.31 17.0801 36.84 26.5601'
                        stroke='currentColor'
                        strokeWidth='4.5'
                        strokeMiterlimit='10'
                        strokeLinecap='round'
                    />
                    <path
                        d='M58.99 74.5899C64.72 80.3899 75.96 75.8199 70.08 66.4099'
                        stroke='currentColor'
                        strokeWidth='4.5'
                        strokeMiterlimit='10'
                        strokeLinecap='round'
                    />
                    <path
                        d='M64.4665 33.5724C75.2636 43.8975 76.7972 59.8166 67.8921 69.1288C58.987 78.441 43.0152 77.6199 32.2182 67.2948C21.4212 56.9697 19.8875 41.0506 28.7926 31.7384C37.6978 22.4262 53.6695 23.2473 64.4665 33.5724Z'
                        stroke='currentColor'
                        strokeWidth='4.5'
                        strokeMiterlimit='10'
                        strokeLinecap='round'
                    />
                    <path
                        d='M61.8999 36.8001C62.3599 25.9001 74.8899 23.0101 77.0799 28.7301C78.6699 32.8701 75.0999 36.2501 72.1399 32.7201'
                        stroke='currentColor'
                        strokeWidth='4.5'
                        strokeMiterlimit='10'
                        strokeLinecap='round'
                    />
                </svg>
            </span>
        </li>
    </ul>
)
