import {useEffect, useRef, useState, useSyncExternalStore} from 'react';

/** Завжди свіже значення для асинхронних колбеків без повторного створення самих колбеків. */
export function useLatest<T>(value: T): {readonly current: T} {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Зворотний відлік секунд; перезапускається, коли змінюється `token`. */
export function useCountdown(seconds: number | null, token: unknown): number {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    setLeft(seconds ?? 0);
    if (!seconds) return undefined;
    const end = Date.now() + seconds * 1000;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [seconds, token]);
  return left;
}

/** Чи відповідає вікно медіазапиту (для майстер–деталь на широкому екрані). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    notify => {
      const media = window.matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
  );
}
