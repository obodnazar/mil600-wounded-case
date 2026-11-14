import {useCallback, useEffect, useState} from 'react';
import type {GuideView} from '../../shared/api';
import {api} from '../api/client';

export type GuideState = {status: 'loading'} | {status: 'ready'; guide: GuideView} | {status: 'failed'};

/** Гайд допомоги без входу: доступний без ролі. */
export function useGuide(): {state: GuideState; retry: () => void} {
  const [state, setState] = useState<GuideState>({status: 'loading'});

  const load = useCallback(() => {
    let cancelled = false;
    setState({status: 'loading'});
    api
      .guide()
      .then(guide => {
        if (!cancelled) setState({status: 'ready', guide});
      })
      .catch(() => {
        if (!cancelled) setState({status: 'failed'});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  return {state, retry: load};
}
