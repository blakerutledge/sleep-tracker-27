import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import type { BabySettings, SleepEvent, SleepEventType } from '../types.ts';
import { auth, db, isAllowedEmail, signInWithGoogle, signOutUser } from './firebase.ts';
import { getTimeZoneId } from './temporal.ts';

const EVENTS_KEY = 'sleep-tracker-27:events';
const SETTINGS_KEY = 'sleep-tracker-27:settings';

export const DEFAULT_SETTINGS: BabySettings = {
  babyName: 'Baby',
  birthDate: '2027-01-01',
  dayStartHour: 7,
  nightStartHour: 19,
  includeInterpolatedInStats: false,
  theme: 'dark',
  isDemoMode: false,
};

function readLocalEvents(): SleepEvent[] {
  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is SleepEvent =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as SleepEvent).id === 'string' &&
          ((item as SleepEvent).type === 'asleep' || (item as SleepEvent).type === 'awake') &&
          typeof (item as SleepEvent).timestamp === 'number',
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

function writeLocalEvents(events: SleepEvent[]): void {
  try {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  } catch {
    // Ignore storage quota errors
  }
}

function readLocalSettings(): BabySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<BabySettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeLocalSettings(settings: BabySettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Generates 14 days of realistic ~4.5-month infant sleep events ending earlier today,
 * deliberately omitting 3 realistic taps so interpolation, hatching, and PLS alerts
 * can be inspected immediately.
 */
export function generateDemoDataset(nowMs: number = Date.now()): {
  events: SleepEvent[];
  demoBirthDate: string;
} {
  const tz = getTimeZoneId();
  const nowZdt = Temporal.Instant.fromEpochMilliseconds(Math.round(nowMs)).toZonedDateTimeISO(tz);
  const todayPlain = nowZdt.toPlainDate();
  const demoBirthDate = todayPlain.subtract({ days: 138 }).toString(); // ~4.5 months old

  const out: SleepEvent[] = [];
  const push = (dayOffset: number, hour: number, minute: number, type: SleepEventType, comment?: string) => {
    const day = dayOffset < 0 ? todayPlain.subtract({ days: Math.abs(dayOffset) }) : todayPlain.add({ days: dayOffset });
    const zdt = day.toPlainDateTime(Temporal.PlainTime.from({ hour, minute })).toZonedDateTime(tz);
    const ts = zdt.epochMilliseconds;
    if (ts > nowMs - 60_000) return;
    out.push({
      id: `demo-${dayOffset}-${hour}-${minute}-${type}`,
      type,
      timestamp: ts,
      comment,
      createdBy: 'demo',
      updatedAt: ts,
    });
  };

  for (let d = -13; d <= 0; d++) {
    // Day -6 (6 days ago): unlogged afternoon/evening gap after Nap 1 ends
    if (d === -6) {
      push(d, 6, 52, 'awake');
      push(d, 8, 50, 'asleep', 'Nap 1');
      push(d, 10, 15, 'awake', 'Left for family afternoon — forgot phone');
      continue;
    }

    // Morning wake: omit on Day -2 to test asleep -> asleep morning interpolation
    if (d !== -2) {
      const wakeMin = 40 + ((Math.abs(d) * 7) % 25); // 6:40..7:04
      push(d, 6, wakeMin, 'awake');
    }

    if (d === 0) {
      // Today: make it end realistically before nowMs
      push(0, 8, 50, 'asleep', 'Morning crib nap');
      push(0, 10, 5, 'awake');
      push(0, 12, 15, 'asleep');
      break;
    }

    // Nap 1 (~1h 15m)
    const n1StartMin = 45 + ((Math.abs(d) * 5) % 15);
    push(d, 8, n1StartMin, 'asleep', d === -2 ? 'Nap 1 (forgot morning wake tap)' : undefined);
    push(d, 10, (n1StartMin + 15) % 55, 'awake');

    // Nap 2 (~1h 20m)
    push(d, 12, 15 + (Math.abs(d) % 15), 'asleep');
    push(d, 13, 35 + (Math.abs(d) % 18), 'awake');

    // Nap 3 (catnap; on d === -1, late 4:40pm micro-nap to trigger post-4pm alert)
    if (d === -1) {
      push(d, 16, 40, 'asleep', 'Quick car catnap on drive home');
      push(d, 16, 50, 'awake');
    } else {
      push(d, 15, 50 + (Math.abs(d) % 10), 'asleep');
      push(d, 16, 25 + (Math.abs(d) % 10), 'awake');
    }

    // Bedtime (~7:30-7:45 PM)
    const bedMin = 30 + ((Math.abs(d) * 6) % 20);
    push(d, 19, bedMin, 'asleep', d === -1 ? 'Bedtime (felt tired)' : undefined);

    // False starts on d === -1 and d === -3 (45 mins after bedtime)
    if (d === -1 || d === -3) {
      push(d, 20, (bedMin + 45) % 60, 'awake', 'False start wakeup');
      push(d, 20, ((bedMin + 45) % 60) + 12, 'asleep', 'Settled back down');
    }

    // Night wake around 2:00 AM
    if (d === -4) {
      // Omit return-to-sleep tap on Day -4 to test awake -> awake interpolation!
      push(d + 1, 2, 20, 'awake', '2am wake (forgot to tap back asleep)');
    } else if (d % 2 !== 0) {
      push(d + 1, 1, 50 + (Math.abs(d) % 20), 'awake');
      push(d + 1, 2, 15 + (Math.abs(d) % 20), 'asleep');
    }
  }

  out.sort((a, b) => a.timestamp - b.timestamp);
  return { events: out, demoBirthDate };
}

export interface SleepStore {
  events: SleepEvent[];
  settings: BabySettings;
  authUser: User | null;
  authReady: boolean;
  authError: string | null;
  syncMode: 'cloud' | 'local';
  isOnline: boolean;
  pendingMigrationCount: number;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  addEvent: (type: SleepEventType, timestamp: number, comment?: string) => Promise<SleepEvent>;
  updateEvent: (id: string, patch: Partial<Omit<SleepEvent, 'id'>>) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<BabySettings>) => Promise<void>;
  loadDemoData: () => Promise<void>;
  resetToCleanSlate: () => Promise<void>;
  migrateLocalToCloud: () => Promise<void>;
  dismissMigrationBanner: () => void;
  exportJson: () => string;
}

export function useSleepStore(): SleepStore {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [localEvents, setLocalEvents] = useState<SleepEvent[]>(() => readLocalEvents());
  const [localSettings, setLocalSettings] = useState<BabySettings>(() => readLocalSettings());
  const [cloudEvents, setCloudEvents] = useState<SleepEvent[]>([]);
  const [cloudSettings, setCloudSettings] = useState<BabySettings | null>(null);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [migrationDismissed, setMigrationDismissed] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        if (!isAllowedEmail(user.email)) {
          const rejected = user.email ?? 'this account';
          await signOutUser();
          setAuthUser(null);
          setAuthError(
            `Signed-in account (${rejected}) is not allowlisted. Sign in with blake@blakerutledge.com or aliyana.gewirtzman@gmail.com.`,
          );
          setAuthReady(true);
          return;
        }
        setAuthError(null);
        setAuthUser(user);
      } else {
        setAuthUser(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const syncMode: 'cloud' | 'local' = authUser ? 'cloud' : 'local';

  useEffect(() => {
    if (!authUser) {
      setCloudEvents([]);
      setCloudSettings(null);
      return;
    }
    const eventsQuery = query(
      collection(db, 'households/family/events'),
      orderBy('timestamp', 'asc'),
    );
    const unsubEvents = onSnapshot(eventsQuery, (snap) => {
      const next: SleepEvent[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() as Partial<SleepEvent>;
        if (
          (d.type === 'asleep' || d.type === 'awake') &&
          typeof d.timestamp === 'number'
        ) {
          next.push({
            id: docSnap.id,
            type: d.type,
            timestamp: d.timestamp,
            comment: typeof d.comment === 'string' ? d.comment : undefined,
            createdBy: typeof d.createdBy === 'string' ? d.createdBy : undefined,
            updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : d.timestamp,
          });
        }
      });
      next.sort((a, b) => a.timestamp - b.timestamp);
      setCloudEvents(next);
    });

    const settingsRef = doc(db, 'households/family/config/settings');
    const unsubSettings = onSnapshot(settingsRef, (snap) => {
      if (snap.exists()) {
        setCloudSettings({
          ...DEFAULT_SETTINGS,
          ...(snap.data() as Partial<BabySettings>),
        });
      } else {
        setCloudSettings(DEFAULT_SETTINGS);
      }
    });

    return () => {
      unsubEvents();
      unsubSettings();
    };
  }, [authUser]);

  const events = syncMode === 'cloud' ? cloudEvents : localEvents;
  const settings = syncMode === 'cloud' ? (cloudSettings ?? localSettings) : localSettings;

  const pendingMigrationCount = useMemo(() => {
    if (syncMode !== 'cloud' || migrationDismissed) return 0;
    const nonDemoLocal = localEvents.filter((e) => !e.id.startsWith('demo-'));
    if (nonDemoLocal.length === 0) return 0;
    const cloudIds = new Set(cloudEvents.map((e) => e.id));
    return nonDemoLocal.filter((e) => !cloudIds.has(e.id)).length;
  }, [syncMode, migrationDismissed, localEvents, cloudEvents]);

  const signIn = useCallback(async () => {
    setAuthError(null);
    try {
      const res = await signInWithGoogle();
      if (!isAllowedEmail(res.user.email)) {
        const rejected = res.user.email ?? 'this account';
        await signOutUser();
        setAuthError(
          `Signed-in account (${rejected}) is not allowlisted. Use blake@blakerutledge.com or aliyana.gewirtzman@gmail.com.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in was cancelled or blocked.';
      setAuthError(msg);
    }
  }, []);

  const signOut = useCallback(async () => {
    await signOutUser();
    setAuthError(null);
  }, []);

  const addEvent = useCallback(
    async (type: SleepEventType, timestamp: number, comment?: string): Promise<SleepEvent> => {
      const trimmedComment = comment?.trim();
      const event: SleepEvent = {
        id: generateId(),
        type,
        timestamp,
        updatedAt: Date.now(),
        ...(trimmedComment ? { comment: trimmedComment } : {}),
        ...(authUser?.email ? { createdBy: authUser.email } : {}),
      };

      if (syncMode === 'cloud') {
        const ref = doc(db, 'households/family/events', event.id);
        await setDoc(ref, event);
      } else {
        setLocalEvents((prev) => {
          const next = [...prev, event].sort((a, b) => a.timestamp - b.timestamp);
          writeLocalEvents(next);
          return next;
        });
      }
      return event;
    },
    [authUser, syncMode],
  );

  const updateEvent = useCallback(
    async (id: string, patch: Partial<Omit<SleepEvent, 'id'>>) => {
      const existing = events.find((e) => e.id === id);
      if (!existing) return;
      const cleanedComment =
        patch.comment !== undefined ? patch.comment.trim() || undefined : existing.comment;
      const updated: SleepEvent = {
        ...existing,
        ...patch,
        id,
        updatedAt: Date.now(),
      };
      if (cleanedComment) {
        updated.comment = cleanedComment;
      } else {
        delete updated.comment;
      }

      if (syncMode === 'cloud') {
        const ref = doc(db, 'households/family/events', id);
        await setDoc(ref, updated);
      } else {
        setLocalEvents((prev) => {
          const next = prev
            .map((e) => (e.id === id ? updated : e))
            .sort((a, b) => a.timestamp - b.timestamp);
          writeLocalEvents(next);
          return next;
        });
      }
    },
    [events, syncMode],
  );

  const deleteEvent = useCallback(
    async (id: string) => {
      if (syncMode === 'cloud') {
        await deleteDoc(doc(db, 'households/family/events', id));
      } else {
        setLocalEvents((prev) => {
          const next = prev.filter((e) => e.id !== id);
          writeLocalEvents(next);
          return next;
        });
      }
    },
    [syncMode],
  );

  const updateSettings = useCallback(
    async (patch: Partial<BabySettings>) => {
      const next: BabySettings = { ...settings, ...patch };
      if (!next.adjustedBirthDate) {
        delete next.adjustedBirthDate;
      }
      if (syncMode === 'cloud') {
        await setDoc(doc(db, 'households/family/config/settings'), next);
      } else {
        setLocalSettings(next);
        writeLocalSettings(next);
      }
    },
    [settings, syncMode],
  );

  const loadDemoData = useCallback(async () => {
    const { events: demoEvents, demoBirthDate } = generateDemoDataset();
    if (syncMode === 'cloud') {
      const batch = writeBatch(db);
      for (const ev of demoEvents) {
        batch.set(doc(db, 'households/family/events', ev.id), ev);
      }
      batch.set(doc(db, 'households/family/config/settings'), {
        ...settings,
        birthDate: demoBirthDate,
        isDemoMode: true,
      });
      await batch.commit();
    } else {
      setLocalEvents(demoEvents);
      writeLocalEvents(demoEvents);
      const nextSettings: BabySettings = {
        ...localSettings,
        birthDate: demoBirthDate,
        isDemoMode: true,
      };
      setLocalSettings(nextSettings);
      writeLocalSettings(nextSettings);
    }
  }, [syncMode, settings, localSettings]);

  const resetToCleanSlate = useCallback(async () => {
    const cleanSettings: BabySettings = {
      ...settings,
      birthDate: '2027-01-01',
      isDemoMode: false,
    };
    delete cleanSettings.adjustedBirthDate;
    if (syncMode === 'cloud') {
      const batch = writeBatch(db);
      for (const ev of cloudEvents) {
        batch.delete(doc(db, 'households/family/events', ev.id));
      }
      batch.set(doc(db, 'households/family/config/settings'), cleanSettings);
      await batch.commit();
    } else {
      setLocalEvents([]);
      writeLocalEvents([]);
      setLocalSettings(cleanSettings);
      writeLocalSettings(cleanSettings);
    }
  }, [syncMode, settings, cloudEvents]);

  const migrateLocalToCloud = useCallback(async () => {
    if (syncMode !== 'cloud') return;
    const toUpload = localEvents.filter((e) => !e.id.startsWith('demo-'));
    if (toUpload.length === 0) return;
    const batch = writeBatch(db);
    for (const ev of toUpload) {
      batch.set(doc(db, 'households/family/events', ev.id), {
        ...ev,
        createdBy: ev.createdBy ?? authUser?.email ?? 'migrated',
      });
    }
    await batch.commit();
    setLocalEvents([]);
    writeLocalEvents([]);
    setMigrationDismissed(true);
  }, [syncMode, localEvents, authUser]);

  const dismissMigrationBanner = useCallback(() => {
    setMigrationDismissed(true);
  }, []);

  const exportJson = useCallback(() => {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        project: 'sleep-tracker-27',
        settings,
        events,
      },
      null,
      2,
    );
  }, [settings, events]);

  return {
    events,
    settings,
    authUser,
    authReady,
    authError,
    syncMode,
    isOnline,
    pendingMigrationCount,
    signIn,
    signOut,
    addEvent,
    updateEvent,
    deleteEvent,
    updateSettings,
    loadDemoData,
    resetToCleanSlate,
    migrateLocalToCloud,
    dismissMigrationBanner,
    exportJson,
  };
}
