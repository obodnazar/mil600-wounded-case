import {useEffect, useRef} from 'react';
import type {DemoProfile} from '../../shared/api';
import {panelOf, PANELS, PRODUCT_NAME, type PanelId} from '../content/panels';
import {useCommand} from './useCommand';
import {useMutation} from './useMutation';
import {usePanelData, type PanelState} from './usePanelData';
import {useSession, type SessionController} from './useSession';
import {useSimulator} from './useSimulator';

/** Роль, для якої можна показувати дані: під час перемикання чи після його збою — жодної. */
function settledProfile(session: SessionController): DemoProfile | null {
  const settled = session.phase === 'ready' && !session.switching && session.problem === null;
  return settled ? (session.session?.profile ?? null) : null;
}

/** Що показує каркас: активна панель, роль у шапці, ознаки завантаження. */
export interface ShellState {
  activePanel: PanelId | null;
  headerProfile: DemoProfile | null;
  /** Роль, показана в навігації (ціль перемикання або поточна). */
  shownProfile: DemoProfile | null;
  loading: boolean;
  loadedAt: number | null;
  stale: boolean;
  refreshing: boolean;
}

function shellState(session: SessionController, panel: PanelState, profile: DemoProfile | null): ShellState {
  const shownProfile = session.target !== undefined ? session.target : profile;
  const ready = panel.status === 'ready' ? panel : null;
  return {
    activePanel: panelOf(shownProfile),
    headerProfile: session.switching ? (session.target ?? null) : profile,
    shownProfile,
    loading: session.phase === 'loading' || session.switching || panel.status === 'loading',
    loadedAt: ready?.loadedAt ?? null,
    stale: ready?.stale ?? false,
    refreshing: ready?.refreshing ?? false,
  };
}

/** Заголовок вкладки браузера відповідає відкритій панелі. */
function useDocumentTitle(panel: PanelId | null): void {
  const title = PANELS.find(item => item.id === panel)?.title;
  useEffect(() => {
    document.title = title ? `${title} — ${PRODUCT_NAME}` : `${PRODUCT_NAME} — навчальний концепт`;
  }, [title]);
}

/**
 * Після зміни панелі переводить фокус і прокрутку на початок змісту: кнопки навігації
 * на час завантаження вимкнені, тож фокус інакше губився б. Перше завантаження не чіпає.
 */
function useFocusOnPanelChange(settledEpoch: number | null): void {
  const focusedEpoch = useRef<number | null>(null);
  useEffect(() => {
    if (settledEpoch === null || focusedEpoch.current === settledEpoch) return;
    const first = focusedEpoch.current === null;
    focusedEpoch.current = settledEpoch;
    if (first) return;
    window.scrollTo(0, 0);
    document.getElementById('main')?.focus({preventScroll: true});
  }, [settledEpoch]);
}

/** Увесь стан застосунку: сесія, дані панелі поточної ролі, записи й відгук на них. */
export function useAppState() {
  const session = useSession();
  const profile = settledProfile(session);
  const panel = usePanelData(profile, session.epoch, session.end);
  const mutation = useMutation({reload: panel.reload, onSessionEnded: session.end});
  const runCommand = useCommand(session.session, mutation.run);
  const simulator = useSimulator(session.session, mutation.run);
  const shell = shellState(session, panel.state, profile);
  const busy = mutation.busy || shell.loading || shell.refreshing;

  useDocumentTitle(shell.activePanel);
  useFocusOnPanelChange(shell.loading ? null : session.epoch);

  const choose = (next: DemoProfile | null): void => {
    mutation.reset();
    void session.choose(next);
  };

  return {session, panel, mutation, runCommand, simulator, shell, busy, choose};
}
