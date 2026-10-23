import { ACK_TIMEOUT_MS } from '@laafia/core'
import * as Notifications from 'expo-notifications'
import type { Db } from './db/db'

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
})

const key = (referralId: string) => `ack_alarm_${referralId}`

/** Fires if the facility has not acknowledged within the urgency timeout, also when the app is closed. */
export async function armAckAlarm(db: Db, referralId: string, shortId: string, urgency: 1 | 2 | 3): Promise<void> {
  const id = await Notifications.scheduleNotificationAsync({
    content: { title: 'No acknowledgement from the facility', body: `Referral ${shortId}: call the facility, resend, or send to a backup number.`, data: { referralId } },
    // The alarm channel the SMS module creates: a missed acknowledgement has to be heard, not just shown.
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(ACK_TIMEOUT_MS[urgency] / 1000), channelId: 'laafia_referrals' },
  })
  await db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key(referralId), id])
}

export async function cancelAckAlarm(db: Db, referralId: string): Promise<void> {
  const row = await db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key(referralId)])
  if (!row) return
  await Notifications.cancelScheduledNotificationAsync(row.value).catch(() => undefined)
  await db.run('DELETE FROM meta WHERE key = ?', [key(referralId)])
}
