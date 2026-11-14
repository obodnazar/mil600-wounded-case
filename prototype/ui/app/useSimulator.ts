import {useCallback, useState} from 'react';
import type {AnalyticsSnapshotId, IngestStatus, SessionView, SimulatorMode} from '../../shared/api';
import {api} from '../api/client';
import {INGEST_RESULTS, INGEST_STILL_PENDING, SNAPSHOT_RESULT} from '../content/actions';
import {useLatest} from '../lib/hooks';
import type {RunMutation} from './useMutation';

/** Останній результат симулятора: статус потрібен для тону повідомлення. */
export type SimulatorOutcome = IngestStatus | 'snapshot' | null;

const SENT_KEY = 'demo-sent-fixtures';

function readSent(): string[] {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(SENT_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeSent(ids: readonly string[]): void {
  try {
    window.sessionStorage.setItem(SENT_KEY, JSON.stringify(ids));
  } catch {
    // Позначки — лише зручність цієї вкладки; без сховища працюємо далі.
  }
}

export interface SimulatorController {
  outcome: SimulatorOutcome;
  /** Події, які сервер прийняв із цієї вкладки (позначки шпаргалки, не стан сервера). */
  sent: readonly string[];
  clearSent: () => void;
  sendEvent: (fixture: string, mode: SimulatorMode) => void;
  selectSnapshot: (snapshot: AnalyticsSnapshotId) => void;
}

/** Дії dev-симулятора: фіксовані події через шлюз і вибір зрізу аналітики. */
export function useSimulator(session: SessionView | null, run: RunMutation): SimulatorController {
  const [outcome, setOutcome] = useState<SimulatorOutcome>(null);
  const [sent, setSent] = useState<readonly string[]>(readSent);

  const markSent = useCallback((fixture: string) => {
    setSent(previous => {
      const next = previous.includes(fixture) ? previous : [...previous, fixture];
      writeSent(next);
      return next;
    });
  }, []);

  const clearSent = useCallback(() => {
    writeSent([]);
    setSent([]);
  }, []);
  const latest = useLatest({session, run});

  const sendEvent = useCallback(
    (fixture: string, mode: SimulatorMode): void => {
      const {session: active, run: runMutation} = latest.current;
      if (!active) return;
      setOutcome(null);
      void runMutation({
        send: () => api.sendEvent(latest.current.session?.csrf ?? active.csrf, fixture, mode),
        describe: result => {
          setOutcome(result.status);
          if (result.status === 'accepted' || result.status === 'duplicate') markSent(fixture);
          const stillPending = result.status === 'pending_review' && result.httpStatus === 200;
          return stillPending ? INGEST_STILL_PENDING : INGEST_RESULTS[result.status];
        },
        retry: () => sendEvent(fixture, mode),
      });
    },
    [latest, markSent],
  );

  const selectSnapshot = useCallback(
    (snapshot: AnalyticsSnapshotId): void => {
      const {session: active, run: runMutation} = latest.current;
      if (!active) return;
      setOutcome(null);
      void runMutation({
        send: () => api.selectSnapshot(latest.current.session?.csrf ?? active.csrf, snapshot),
        describe: () => {
          setOutcome('snapshot');
          return SNAPSHOT_RESULT;
        },
        retry: () => selectSnapshot(snapshot),
      });
    },
    [latest],
  );

  return {outcome, sent, clearSent, sendEvent, selectSnapshot};
}
