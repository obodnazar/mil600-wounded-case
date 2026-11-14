import {Denied, type Session} from '../../security/core.js';
import type {DemoProfile} from '../../shared/api.js';
import type {Store} from '../db/store.js';
import {isoTime} from '../domain/model.js';

export const SESSION_TTL_MS = 15 * 60 * 1000;

/**
 * Обчислює чинний контекст доступу з таблиць грантів і призначень на момент запиту.
 *
 * Викликається для кожного запиту й кожного повтору команди: відкликаний грант,
 * завершене призначення чи сплив строку діють негайно. Роль, підрозділ чи кейс
 * ніколи не беруться з query або тіла запиту.
 */
export function resolveSession(store: Store, profile: DemoProfile, actorId: string, now: number): Session {
  const at = isoTime(now);
  const grants = store.rows(
    `SELECT case_id,unit_ref,valid_to FROM access_grant
      WHERE actor_subject_id=? AND role=? AND purposes='demo'
        AND revoked_at IS NULL AND valid_from<=? AND valid_to>?`,
    actorId, profile, at, at,
  );
  if (!grants.length) throw new Denied(401, 'authentication_required');

  const caseIds = new Set<string>();
  for (const grant of grants) {
    if (grant.case_id) {
      // Грант бійця діє лише на власний кейс.
      const owner = store.row('SELECT subject_id FROM wound_case WHERE id=?', grant.case_id);
      if (owner && (profile !== 'patient' || owner.subject_id === actorId)) caseIds.add(String(grant.case_id));
    } else if (grant.unit_ref) {
      // Службовий грант охоплює кейси осіб із чинним перевіреним призначенням в області.
      const assigned = store.rows(
        `SELECT c.id FROM wound_case c JOIN unit_assignment u ON u.subject_id=c.subject_id
          WHERE u.unit_ref=? AND u.verification_state='verified'
            AND u.valid_from<=? AND (u.valid_to IS NULL OR u.valid_to>?)`,
        grant.unit_ref, at, at,
      );
      for (const item of assigned) caseIds.add(String(item.id));
    }
  }
  return {
    actorId,
    role: profile,
    caseIds,
    expiresAt: now + SESSION_TTL_MS,
    revoked: false,
    grantExpiresAt: Math.max(...grants.map(grant => Date.parse(String(grant.valid_to)))),
  };
}
