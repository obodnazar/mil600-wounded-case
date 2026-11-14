import type {CaseMilestones} from '../../../shared/api';
import {Notice} from '../../components/Notice';
import {OGD_AWAITS_VLK_NOTE} from '../../content/legal';

/**
 * Пояснення до ОГД, поки чинної постанови ВЛК немає (ADR 0011).
 * Рядки ОГД із даних не ховаємо — лише пояснюємо, чому розгляд чекає.
 */
export function OgdAwaitsVlk({vlkDecision}: {vlkDecision: CaseMilestones['vlkDecision']}) {
  if (vlkDecision === 'recorded') return null;
  return (
    <Notice tone="info" className="notice--compact">
      {OGD_AWAITS_VLK_NOTE}
    </Notice>
  );
}
