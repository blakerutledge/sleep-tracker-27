import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getFunctions } from 'firebase-admin/functions'
import { defineSecret } from 'firebase-functions/params'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onTaskDispatched } from 'firebase-functions/v2/tasks'
import webpush from 'web-push'
import type { AlarmTimer, PushSubscriptionRecord } from '#src/types.ts'

initializeApp()

const db = getFirestore()
const vapidPublicKey = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')

const VAPID_SUBJECT = 'mailto:blake@blakerutledge.com'
const REGION = 'us-central1'

interface AlarmTaskPayload {
    alarmId: string
    fireAt: number
}

const isHttpStatusError = (err: unknown): err is { statusCode: number } =>
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    typeof (err as { statusCode: unknown }).statusCode === 'number'

export const scheduleAlarmPush = onDocumentWritten(
    {
        document: 'households/family/alarms/{alarmId}',
        region: REGION,
        memory: '256MiB',
        maxInstances: 2,
    },
    async (event) => {
        const afterSnap = event.data?.after
        if (!afterSnap?.exists) return

        const alarm = afterSnap.data() as Partial<AlarmTimer>
        if (!alarm.enabled || alarm.fired || typeof alarm.fireAt !== 'number') {
            return
        }

        const beforeData = event.data?.before.exists
            ? (event.data.before.data() as Partial<AlarmTimer>)
            : undefined

        // Skip re-enqueueing when only non-scheduling fields changed.
        if (
            beforeData &&
            beforeData.enabled === true &&
            beforeData.fired === false &&
            beforeData.fireAt === alarm.fireAt
        ) {
            return
        }

        const now = Date.now()
        const scheduleTime = new Date(Math.max(alarm.fireAt, now + 1000))
        const queue = getFunctions().taskQueue(`locations/${REGION}/functions/sendAlarmPush`)

        await queue.enqueue(
            {
                alarmId: event.params.alarmId,
                fireAt: alarm.fireAt,
            } satisfies AlarmTaskPayload,
            {
                scheduleTime,
                dispatchDeadlineSeconds: 60,
            },
        )
    },
)

export const sendAlarmPush = onTaskDispatched(
    {
        region: REGION,
        memory: '256MiB',
        maxInstances: 2,
        secrets: [vapidPublicKey, vapidPrivateKey],
        retryConfig: {
            maxAttempts: 2,
            minBackoffSeconds: 10,
        },
        rateLimits: {
            maxConcurrentDispatches: 2,
        },
    },
    async (req) => {
        const data = req.data as Partial<AlarmTaskPayload>
        if (typeof data.alarmId !== 'string' || typeof data.fireAt !== 'number') {
            return
        }

        const alarmRef = db.doc(`households/family/alarms/${data.alarmId}`)
        const alarmSnap = await alarmRef.get()
        if (!alarmSnap.exists) return

        const alarm = alarmSnap.data() as Partial<AlarmTimer>
        if (!alarm.enabled || alarm.fired || alarm.fireAt !== data.fireAt) {
            return
        }

        webpush.setVapidDetails(VAPID_SUBJECT, vapidPublicKey.value(), vapidPrivateKey.value())

        const subsSnap = await db.collection('households/family/pushSubscriptions').get()
        const payload = JSON.stringify({
            title: alarm.label || 'Sleep Alarm',
            body: '',
            tag: `alarm-${data.alarmId}`,
            url: '/today',
            alarmId: data.alarmId,
        })

        const deliveries = subsSnap.docs.map(async (subDoc) => {
            const sub = subDoc.data() as Partial<PushSubscriptionRecord>
            if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys.auth) return

            try {
                await webpush.sendNotification(
                    {
                        endpoint: sub.endpoint,
                        keys: {
                            p256dh: sub.keys.p256dh,
                            auth: sub.keys.auth,
                        },
                    },
                    payload,
                    {
                        // biome-ignore lint/style/useNamingConvention: web-push RequestOptions requires uppercase TTL
                        TTL: 300,
                        urgency: 'high',
                    },
                )
            } catch (err) {
                if (isHttpStatusError(err) && (err.statusCode === 404 || err.statusCode === 410)) {
                    await subDoc.ref.delete()
                }
            }
        })

        await Promise.all(deliveries)
        await alarmRef.set({ fired: true, enabled: false, updatedAt: Date.now() }, { merge: true })
    },
)
