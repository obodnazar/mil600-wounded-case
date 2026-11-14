import {useState} from 'react';
import {Button} from './Button';
import {Notice} from './Notice';

interface SessionWarningProps {
  /** Продовжує сесію; false — не вдалося. */
  onRenew: () => Promise<boolean>;
}

/** Попередження за хвилину до кінця сесії з можливістю її продовжити. */
export function SessionWarning({onRenew}: SessionWarningProps) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const renew = async () => {
    setState('busy');
    const renewed = await onRenew();
    if (!renewed) setState('failed');
  };
  return (
    <Notice
      tone="warning"
      title="Сесія завершиться менш ніж за хвилину"
      role="status"
      className="session-warning"
      actions={
        <Button variant="primary" disabled={state === 'busy'} onClick={() => void renew()}>
          Продовжити сесію
        </Button>
      }
    >
      {state === 'failed'
        ? 'Не вдалося продовжити сесію. Спробуйте ще раз — уже записані дії збережено.'
        : 'Після завершення доведеться обрати роль знову. Уже записані дії збережено.'}
    </Notice>
  );
}
