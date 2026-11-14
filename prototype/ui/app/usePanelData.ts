import {useCallback, useEffect, useState} from 'react';
import type {AnalyticsView, DemoProfile, DevView, PatientCaseView, StaffView} from '../../shared/api';
import {api} from '../api/client';
import {describeProblem, isSessionEnded, type Problem} from '../content/errors';
import {useLatest} from '../lib/hooks';

export type PanelData =
  | {panel: 'patient'; view: PatientCaseView}
  | {panel: 'staff'; view: StaffView}
  | {panel: 'analytics'; view: AnalyticsView}
  | {panel: 'dev'; view: DevView};

export type PanelState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'failed'; problem: Problem}
  | {status: 'ready'; data: PanelData; loadedAt: number; refreshing: boolean; stale: boolean};

async function fetchPanel(profile: DemoProfile): Promise<PanelData> {
  switch (profile) {
    case 'patient':
      return {panel: 'patient', view: await api.patient()};
    case 'support':
    case 'commander':
      return {panel: 'staff', view: await api.staff()};
    case 'analyst':
      return {panel: 'analytics', view: await api.analytics()};
    case 'dev':
      return {panel: 'dev', view: await api.dev()};
  }
}

interface Stored {
  key: string;
  state: PanelState;
}

const ready = (data: PanelData): PanelState => ({
  status: 'ready',
  data,
  loadedAt: Date.now(),
  refreshing: false,
  stale: false,
});

export interface PanelController {
  state: PanelState;
  /** Перезавантажує дані поточної ролі; наявні дані лишаються на екрані. Кидає помилку при збої. */
  reload: () => Promise<void>;
}

/**
 * Дані панелі поточної ролі. Ключ — сесія й роль: щойно він змінюється, попередні
 * дані перестають показуватися ще до відповіді сервера (і якщо завантаження впаде).
 */
export function usePanelData(profile: DemoProfile | null, epoch: number, onSessionEnded: () => void): PanelController {
  const key = profile ? `${epoch}:${profile}` : '';
  const [stored, setStored] = useState<Stored>({key: '', state: {status: 'idle'}});
  const latest = useLatest({key, profile, onSessionEnded});

  const load = useCallback(
    async (target: DemoProfile, targetKey: string) => {
      const isCurrent = () => latest.current.key === targetKey;
      try {
        const data = await fetchPanel(target);
        if (isCurrent()) setStored({key: targetKey, state: ready(data)});
      } catch (error) {
        if (!isCurrent()) return;
        if (isSessionEnded(error)) return latest.current.onSessionEnded();
        setStored(previous => {
          if (previous.key === targetKey && previous.state.status === 'ready') {
            return {key: targetKey, state: {...previous.state, refreshing: false, stale: true}};
          }
          return {key: targetKey, state: {status: 'failed', problem: describeProblem(error, 'read')}};
        });
        throw error;
      }
    },
    [latest],
  );

  useEffect(() => {
    if (profile) void load(profile, key).catch(() => undefined);
  }, [profile, key, load]);

  const reload = useCallback(async () => {
    const {key: targetKey, profile: target} = latest.current;
    if (!target) return;
    setStored(previous =>
      previous.key === targetKey && previous.state.status === 'ready'
        ? {key: targetKey, state: {...previous.state, refreshing: true}}
        : {key: targetKey, state: {status: 'loading'}},
    );
    await load(target, targetKey);
  }, [latest, load]);

  const state: PanelState = !profile ? {status: 'idle'} : stored.key === key ? stored.state : {status: 'loading'};
  return {state, reload};
}
