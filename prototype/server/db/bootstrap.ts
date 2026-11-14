import type {Store} from './store.js';
import {SOURCE_SYSTEMS, newId} from '../domain/model.js';
import {ensureRequirements} from '../domain/documents.js';
import {COHORT, SMALL_COHORT, computeSnapshot} from '../read/analytics.js';

const BOOT_MARKER = 'boot-8b';
const BINDING_FROM = '2026-01-01T00:00:00.000Z';

/**
 * Одноразове доповнення seed для повного демо-маршруту:
 * перевірені прив’язки осіб і випадків до кожного mock-джерела, технічні переліки
 * фінансових маршрутів і два незмінні аналітичні зрізи.
 */
export function bootstrap(store: Store): void {
  if (store.exists('SELECT id FROM demo_setting WHERE id=?', BOOT_MARKER)) return;
  store.transaction(() => {
    bindPeopleToSources(store);
    bindCasesToSources(store);
    store.run('INSERT INTO analytics_snapshot VALUES (?,?)', 'demo-cohort-v1', JSON.stringify(computeSnapshot(COHORT)));
    store.run('INSERT INTO analytics_snapshot VALUES (?,?)', 'demo-small', JSON.stringify(computeSnapshot(SMALL_COHORT)));
    store.run('INSERT INTO demo_setting VALUES (?,?)', BOOT_MARKER, 'complete');
  });
}

function bindPeopleToSources(store: Store): void {
  const people = store.rows("SELECT id FROM subject WHERE id LIKE 'demo-person-%'");
  for (const person of people) {
    const personId = String(person.id);
    for (const source of SOURCE_SYSTEMS) {
      const bound = store.exists(
        'SELECT id FROM identity_link WHERE source_namespace=? AND source_subject_token=?',
        source, personId,
      );
      if (bound) continue;
      store.insert('identity_link', {
        id: newId(),
        subject_id: personId,
        source_namespace: source,
        source_subject_token: personId,
        verification_state: 'verified',
        proof_ref: `demo-independent-binding-${source}`,
        valid_from: BINDING_FROM,
        valid_to: null,
      });
    }
  }
}

function bindCasesToSources(store: Store): void {
  for (const item of store.rows('SELECT id,subject_id,incident_ref FROM wound_case')) {
    const caseId = String(item.id);
    for (const source of SOURCE_SYSTEMS) {
      store.run(
        'INSERT OR IGNORE INTO incident_link VALUES (?,?,?,?,?)',
        source, item.subject_id ?? null, item.incident_ref ?? '', caseId, 'demo-independent-incident-binding',
      );
    }
    store.run(
      "UPDATE wound_case SET source_linked=CASE WHEN origin='medical_event' THEN 1 ELSE 0 END WHERE id=?",
      caseId,
    );
    for (const route of ['reward', 'ogd'] as const) {
      ensureRequirements(store, caseId, route, `demo-${route}-packet-${caseId.slice(-2)}`);
    }
  }
}
