import {useCallback, useRef} from 'react';
import type {CommandAction, CommandRequest, SessionView} from '../../shared/api';
import {api} from '../api/client';
import {commandResultMessage} from '../content/actions';
import {useLatest} from '../lib/hooks';
import {newCommandId} from '../lib/ids';
import type {RunMutation} from './useMutation';

/** Команда без ключа ідемпотентності: ключ додає useCommand. */
export interface CommandDraft {
  caseId: string;
  action: CommandAction;
  option?: string | undefined;
}

export type RunCommand = (draft: CommandDraft) => void;

/**
 * Надсилає команду з ключем ідемпотентності. Ключ зберігається до підтвердженого успіху:
 * повтор після мережевого збою йде з тим самим id, і сервер не створить подвійного запису.
 */
export function useCommand(session: SessionView | null, run: RunMutation): RunCommand {
  const pendingIds = useRef(new Map<string, string>());
  const latest = useLatest({session, run});

  const execute = useCallback(
    (draft: CommandDraft): void => {
      const {session: active, run: runMutation} = latest.current;
      if (!active?.profile) return;
      const key = JSON.stringify([active.profile, draft.caseId, draft.action, draft.option ?? null]);
      const id = pendingIds.current.get(key) ?? newCommandId();
      pendingIds.current.set(key, id);
      const request: CommandRequest = {
        id,
        case_id: draft.caseId,
        action: draft.action,
        ...(draft.option ? {option: draft.option} : {}),
      };
      void runMutation({
        // csrf беремо в момент надсилання: після продовження сесії він інший.
        send: () => api.command(latest.current.session?.csrf ?? active.csrf, request),
        describe: result => {
          pendingIds.current.delete(key);
          return commandResultMessage(draft.action, draft.option, result.duplicate === true);
        },
        retry: () => execute(draft),
      });
    },
    [latest],
  );

  return execute;
}
