import type { Types } from 'mongoose';
import type { NotificationDto } from '@spendly/shared';
import type { AuthContext } from '../middleware/context';
import { Notification, type NotificationDoc } from '../models/account';

type Kind = NotificationDoc['type'];

const PREF_FOR: Partial<Record<Kind, 'budgetAlerts' | 'upcomingPayments' | 'importUpdates' | 'insights'>> = {
  budget: 'budgetAlerts',
  upcoming_payment: 'upcomingPayments',
  import: 'importUpdates',
  insight: 'insights',
};

export interface NewNotification {
  type: Kind;
  severity?: NotificationDoc['severity'];
  title: string;
  body?: string;
  link?: string | null;
  /** Same key = same notification: it is created once, however often the condition is re-evaluated. */
  dedupeKey?: string;
}

/** Creates an in-app notification unless the user switched that kind off or it already exists. */
export async function notify(
  auth: Pick<AuthContext, 'userId' | 'prefs'>,
  n: NewNotification,
): Promise<boolean> {
  const pref = PREF_FOR[n.type];
  if (pref && auth.prefs.notifications[pref] === false) return false;
  try {
    await Notification.create({
      userId: auth.userId,
      type: n.type,
      severity: n.severity ?? 'info',
      title: n.title,
      body: n.body ?? '',
      link: n.link ?? null,
      dedupeKey: n.dedupeKey ?? null,
    });
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
}

export const toNotificationDto = (n: NotificationDoc): NotificationDto => ({
  id: n._id.toString(),
  type: n.type,
  severity: n.severity,
  title: n.title,
  body: n.body,
  link: n.link,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

export async function unreadCount(userId: Types.ObjectId): Promise<number> {
  return Notification.countDocuments({ userId, readAt: null });
}
