import {useCallback, useEffect, useRef, useState} from 'react';
import type {DemoProfile, SessionView} from '../../shared/api';
import {api} from '../api/client';
import {describeProblem, isSessionEnded, type Problem} from '../content/errors';

/** За скільки до кінця сесії попереджати. */
const WARNING_MS = 60_000;

export type SessionPhase = 'loading' | 'ready' | 'ended' | 'unreachable';

interface State {
  phase: SessionPhase;
  session: SessionView | null;
  /** Роль, на яку триває або не вдалося перемикання; undefined — перемикання немає. */
  target: DemoProfile | null | undefined;
  switching: boolean;
  /** Зростає з кожною новою сесією: дані попередньої ролі стають нечинними. */
  epoch: number;
  problem: Problem | null;
  expiringSoon: boolean;
}

const INITIAL: State = {
  phase: 'loading',
  session: null,
  target: undefined,
  switching: false,
  epoch: 0,
  problem: null,
  expiringSoon: false,
};

export interface SessionController extends State {
  start: () => Promise<void>;
  choose: (profile: DemoProfile | null) => Promise<void>;
  renew: () => Promise<boolean>;
  end: () => void;
}

/** Навчальна сесія: отримання, зміна ролі, продовження й завершення (401 або сплив часу). */
export function useSession(): SessionController {
  const [state, setState] = useState<State>(INITIAL);
  const current = useRef<SessionView | null>(null);
  const ended = useRef(false);

  const adopt = useCallback((session: SessionView, fresh: boolean) => {
    current.current = session;
    setState(previous => ({
      ...INITIAL,
      phase: 'ready',
      session,
      epoch: fresh ? previous.epoch + 1 : previous.epoch,
    }));
  }, []);

  const end = useCallback(() => {
    current.current = null;
    ended.current = true;
    setState(previous => ({...INITIAL, phase: 'ended', epoch: previous.epoch + 1}));
  }, []);

  const start = useCallback(async () => {
    setState(previous => ({...INITIAL, epoch: previous.epoch + 1}));
    try {
      const session = await api.session();
      // Після завершення сесії починаємо з вибору ролі, навіть якщо сервер пам’ятає попередню.
      const reset = ended.current && session.profile !== null;
      adopt(reset ? await api.chooseProfile(session.csrf, null) : session, true);
      ended.current = false;
    } catch (error) {
      setState(previous => ({...previous, phase: 'unreachable', problem: describeProblem(error, 'read')}));
    }
  }, [adopt]);

  const choose = useCallback(
    async (profile: DemoProfile | null) => {
      const session = current.current;
      if (!session) return;
      setState(previous => ({...previous, switching: true, target: profile, problem: null}));
      try {
        adopt(await api.chooseProfile(session.csrf, profile), true);
      } catch (error) {
        if (isSessionEnded(error)) return end();
        // Невідомо, чи сервер устиг змінити роль: звіряємо сесію, старі дані не показуємо.
        const actual = await api.session().catch(() => null);
        if (actual) current.current = actual;
        setState(previous => ({
          ...previous,
          session: actual ?? previous.session,
          switching: false,
          problem: describeProblem(error, 'switch'),
          epoch: previous.epoch + 1,
        }));
      }
    },
    [adopt, end],
  );

  const renew = useCallback(async () => {
    const session = current.current;
    if (!session) return false;
    try {
      adopt(await api.chooseProfile(session.csrf, session.profile), false);
      return true;
    } catch (error) {
      if (isSessionEnded(error)) end();
      return false;
    }
  }, [adopt, end]);

  useEffect(() => {
    void start();
  }, [start]);

  const expiresAt = state.phase === 'ready' ? (state.session?.expiresAt ?? null) : null;
  useEffect(() => {
    if (expiresAt === null) return undefined;
    const left = expiresAt - Date.now();
    const warn = window.setTimeout(
      () => setState(previous => ({...previous, expiringSoon: true})),
      Math.max(0, left - WARNING_MS),
    );
    const stop = window.setTimeout(end, Math.max(0, left));
    return () => {
      window.clearTimeout(warn);
      window.clearTimeout(stop);
    };
  }, [expiresAt, end]);

  return {...state, start, choose, renew, end};
}
