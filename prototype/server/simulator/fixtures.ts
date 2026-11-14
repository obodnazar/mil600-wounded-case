import type {EventEnvelope} from '../../security/core.js';
import type {FixtureGroup} from '../../shared/api.js';

/**
 * Фіксовані вигадані події dev-симулятора.
 *
 * Симулятор не приймає довільного JSON: надіслати можна лише подію з цього
 * переліку, і вона проходить той самий шлюз (підпис, схема, політика джерела),
 * що й будь-яке інше джерело. Ідентифікатори фікстур є частиною сценарію показу.
 */
export interface Fixture {
  id: string;
  title: string;
  group: FixtureGroup;
  event: EventEnvelope;
}

type Payload = Record<string, unknown>;

const AT = '2026-11-13T10:00:00.000Z';
const PROOF = 'demo-source-proof';
const slug = (id: string): string => id.replaceAll('_', '-');

function fixture(
  group: FixtureGroup, id: string, title: string, type: string, source: string,
  payload: Payload, overrides: Partial<EventEnvelope> = {},
): Fixture {
  return {
    id,
    title,
    group,
    event: {
      schema_version: 'case-event/1',
      event_id: `demo-fixture-${slug(id)}`,
      event_type: type,
      source_system: source,
      source_record_ref: `demo-record-${slug(id)}`,
      source_stream: `demo-stream-${slug(id)}`,
      source_version: 'v1',
      source_order: null,
      subject_ref: 'demo-person-01',
      incident_ref: 'demo-incident-01',
      episode_ref: null,
      occurred_at: AT,
      recorded_at: AT,
      payload,
      ...overrides,
    },
  };
}

const documentPayload = (ref: string, kind: string, version = 'v1'): Payload => ({
  document_ref: ref,
  document_kind: kind,
  document_version: version,
  evidence_ref: PROOF,
});

const vlkPacket = (revision = 'v1'): Payload => ({
  route: 'vlk',
  packet_ref: 'demo-packet-01',
  packet_revision: revision,
  recipient_ref: 'demo-vlk',
  confirmed_at: AT,
  reason_code: 'received',
  evidence_ref: PROOF,
});

const receipt = (documentRef: string, version: string, recipientRef: string, recipientKind: string, at = AT): Payload => ({
  document_ref: documentRef,
  document_version: version,
  recipient_ref: recipientRef,
  recipient_kind: recipientKind,
  received_at: at,
  evidence_ref: PROOF,
});

/* ───────────── Медичні події та лікування ───────────── */

const RESERVE_PERSON = {subject_ref: 'demo-person-02', incident_ref: 'demo-reserve-02'};
const careStart = (date: string | null): Payload => ({
  provider_ref: 'demo-provider-1',
  date,
  care_applicable: true,
  evidence_ref: PROOF,
});

const medical: Fixture[] = [
  fixture('d1', 'primary', 'D1.1 · еПМК від медичного джерела', 'medical.primary_recorded', 'demo-mis', {
    document_kind: 'primary_medical_card',
    document_version: 'v1',
    enemy_action: 'yes',
    applicability_evidence_ref: PROOF,
    injury_date: '2026-10-20',
    injury_evidence_ref: PROOF,
  }, {
    source_record_ref: 'demo-primary-d1',
    recorded_at: '2026-11-09T10:00:00Z',
    occurred_at: '2026-10-20T10:00:00Z',
  }),
  fixture('d1', 'admit', 'D1.2 · надходження на лікування до закладу: початок відліку строку довідки', 'care.admitted', 'demo-mis', {
    provider_ref: 'demo-provider-1',
    date: '2026-10-21',
    evidence_ref: PROOF,
  }, {episode_ref: 'demo-d1-episode-a'}),
  fixture('d1', 'care-start', 'D1.2 · підтверджений початок лікування', 'care.start_confirmed', 'demo-mis',
    careStart('2026-10-21'), {episode_ref: 'demo-d1-episode-a'}),
  fixture('s6', 'care-unknown', 'S6 · початок лікування без дати (кейс 03)', 'care.start_confirmed', 'demo-mis',
    careStart(null), {
      subject_ref: 'demo-person-03',
      incident_ref: 'demo-incident-03',
      episode_ref: 'demo-unknown-episode',
    }),
  fixture('d1', 'transfer', 'D1.2 · переведення до іншого закладу', 'care.transferred', 'demo-mis', {
    provider_ref: 'demo-provider-2',
    date: '2026-11-02',
    previous_episode_ref: 'demo-d1-episode-a',
    evidence_ref: PROOF,
  }, {episode_ref: 'demo-d1-episode-b'}),
  fixture('s2', 'civil', 'S2 · переведення до цивільного закладу (погоджений канал, мок)', 'care.transferred',
    'demo-civil-mis', {
      provider_ref: 'demo-provider-3',
      date: '2026-11-03',
      previous_episode_ref: 'demo-d1-episode-b',
      evidence_ref: PROOF,
      source_channel: 'agreed_demo_901',
    }, {episode_ref: 'demo-d1-episode-c'}),
  fixture('s3', 'civil-summary', 'S3 · виписка від цивільного джерела', 'document.prepared', 'demo-civil-mis', {
    ...documentPayload('demo-civil-summary', 'medical_summary'),
    source_channel: 'agreed_demo_901',
  }),
  fixture('s2', 'discharge', 'S2 · виписка із закладу', 'care.discharged', 'demo-civil-mis', {
    provider_ref: 'demo-provider-3',
    date: '2026-11-04',
    evidence_ref: PROOF,
    source_channel: 'agreed_demo_901',
  }, {episode_ref: 'demo-d1-episode-c'}),
  fixture('d1', 'patient-receipt', 'D1.2 · військовослужбовець отримав еПМК (строк не змінює)', 'document.received', 'demo-service',
    receipt('demo-primary-d1', 'v1', 'demo-person-01', 'servicemember', '2026-11-10T12:00:00Z')),
];

/* ───────────── Довідка про обставини травми ───────────── */

const CERTIFICATE = 'demo-certificate-d1';

const certificate: Fixture[] = [
  fixture('d1', 'certificate-prepared', 'D1.3 · медслужба склала довідку', 'document.prepared', 'demo-mis',
    documentPayload(CERTIFICATE, 'trauma_certificate')),
  fixture('d1', 'certificate-issued', 'D1.3 · підтверджено видачу командиром', 'document.issued', 'demo-sedo',
    documentPayload(CERTIFICATE, 'trauma_certificate')),
  fixture('d1', 'certificate-sent', 'D1.3 · підтверджено відправлення до ВЛК', 'document.sent', 'demo-sedo', {
    document_ref: CERTIFICATE,
    document_version: 'v1',
    recipient_ref: 'demo-vlk',
    recipient_kind: 'vlk',
    sent_at: AT,
    evidence_ref: PROOF,
  }),
  fixture('d1', 'certificate-received', 'D1.3 · ВЛК підтвердила отримання версії', 'document.received', 'demo-vlk',
    receipt(CERTIFICATE, 'v1', 'demo-vlk', 'vlk')),
  fixture('s3', 'certificate-corrected', 'S3 · виправлена версія: потрібна нова квитанція', 'document.corrected',
    'demo-sedo', {
      ...documentPayload(CERTIFICATE, 'trauma_certificate', 'v2'),
      supersedes_document_version: 'v1',
    }),
  fixture('s3', 'certificate-received-v2', 'S3 · ВЛК отримала виправлену версію', 'document.received', 'demo-vlk',
    receipt(CERTIFICATE, 'v2', 'demo-vlk', 'vlk')),
  fixture('s3', 'certificate-withdrawn', 'S3 · виправлену версію відкликано', 'document.withdrawn', 'demo-sedo',
    documentPayload(CERTIFICATE, 'trauma_certificate', 'v2')),
];

/* ───────────── Направлення та ВЛК ───────────── */

const vlk: Fixture[] = [
  fixture('d1', 'referral', 'D1.5 · підтверджено направлення на ВЛК', 'referral.issued', 'demo-sedo', {
    document_ref: 'demo-referral-d1',
    document_version: 'v1',
    issuer_ref: 'demo-commander',
    evidence_ref: PROOF,
  }),
  fixture('s4', 'referral-facility', 'S4 · заклад лікування сам направив на ВЛК (без запиту командира)', 'referral.issued',
    'demo-mis', {
      document_ref: 'demo-referral-facility',
      document_version: 'v1',
      issuer_ref: 'demo-facility',
      provider_ref: 'demo-provider-1',
      evidence_ref: PROOF,
    }, {episode_ref: 'demo-d1-episode-a'}),
  fixture('d1', 'vlk-received', 'D1.5 · ВЛК отримала пакет', 'vlk.package_received', 'demo-vlk', vlkPacket()),
  fixture('s4', 'vlk-returned', 'S4 · ВЛК адресувала зауваження автору', 'vlk.package_returned', 'demo-vlk', {
    ...vlkPacket(),
    reason_code: 'author_clarification',
  }),
  fixture('s4', 'vlk-resubmitted', 'S4 · ВЛК отримала уточнену ревізію пакета', 'vlk.package_received', 'demo-vlk', {
    ...vlkPacket('v2'),
    supersedes_revision: 'v1',
  }),
  fixture('d1', 'vlk-decision', 'D1.5 · ВЛК оформила постанову', 'vlk.decision_recorded', 'demo-vlk', {
    document_ref: 'demo-vlk-decision-d1',
    document_version: 'v1',
    service_code: 'next_service_action',
    evidence_ref: PROOF,
  }),
  fixture('d1', 'service-executed', 'D1.5 · виконано адміністративну дію за постановою', 'service.action_confirmed',
    'demo-service', {
      action_ref: 'demo-service-action',
      action_code: 'service_action_completed',
      evidence_ref: PROOF,
    }),
];

/* ───────────── Винагорода за час стаціонарного лікування: за періодами ───────────── */

type PaymentKind = 'reward' | 'ogd';
const KIND_TITLE: Record<PaymentKind, string> = {reward: 'Винагорода', ogd: 'ОГД'};
const STATUS_TITLE: Record<string, string> = {
  returned: 'повернуто на уточнення',
  denied: 'відмовлено',
  approved: 'схвалено',
  execution_partial: 'виконано частково',
  execution_confirmed: 'виконання підтверджено',
  unknown: 'стан невідомий',
};
/** Яке попереднє рішення продовжує сигнал: порядок переходів має бути доведений. */
const PREDECESSOR: Record<string, string> = {
  denied: 'returned',
  execution_partial: 'approved',
  execution_confirmed: 'execution-partial',
};

const packetRefFor = (kind: PaymentKind, period: string): string =>
  period === '2026-11' ? `demo-${kind}-packet-01` : `demo-${kind}-oct-01`;

function financePacket(group: FixtureGroup, id: string, title: string, kind: PaymentKind, period: string): Fixture {
  return fixture(group, id, title, 'finance.package_received', 'demo-finance', {
    kind,
    packet_ref: packetRefFor(kind, period),
    packet_revision: 'v1',
    recipient_ref: 'demo-finance',
    confirmed_at: AT,
    period,
    evidence_ref: PROOF,
  });
}

function financeStatus(group: FixtureGroup, id: string, kind: PaymentKind, status: string, period = '2026-11'): Fixture {
  const predecessor = PREDECESSOR[status];
  const title = `${group === 'd1' ? 'D1' : 'S5'} · ${KIND_TITLE[kind]} · ${STATUS_TITLE[status] ?? status} · ${period}`;
  return fixture(group, id, title, 'finance.status_recorded', 'demo-finance', {
    kind,
    packet_ref: packetRefFor(kind, period),
    period,
    status,
    reason_code: ['returned', 'denied'].includes(status) ? 'documents_needed' : 'confirmed_scope',
    decision_ref: `demo-decision-${slug(id)}`,
    evidence_ref: PROOF,
    ...(predecessor ? {previous_decision_ref: `demo-decision-${kind}-${predecessor}`} : {}),
  });
}

/** Схвалення після повернення чи відмови: посилається саме на те рішення, яке переглядає. */
function approvedAfter(kind: PaymentKind, prior: 'returned' | 'denied'): Fixture {
  const item = financeStatus('s5', `${kind}-approved-after-${prior}`, kind, 'approved');
  item.title = `S5 · ${KIND_TITLE[kind]} · схвалено після «${STATUS_TITLE[prior]}» · 2026-11`;
  item.event.payload.previous_decision_ref = `demo-decision-${kind}-${prior}`;
  item.event.payload.decision_ref = `demo-decision-${kind}-approved`;
  return item;
}

const D1_STATUSES = new Set(['approved', 'execution_partial', 'execution_confirmed']);

function financeRoute(kind: PaymentKind): Fixture[] {
  const statuses = ['returned', 'denied', 'approved', 'execution_partial', 'execution_confirmed', 'unknown'];
  return [
    financePacket('d1', `${kind}-packet`, `D1 · ${KIND_TITLE[kind]} · пакет отримано · 2026-11`, kind, '2026-11'),
    ...statuses.map(status => financeStatus(D1_STATUSES.has(status) ? 'd1' : 's5', `${kind}-${status}`, kind, status)),
    financePacket('s5', `${kind}-oct-packet`, `S5 · ${KIND_TITLE[kind]} · пакет за інший період · 2026-10`, kind, '2026-10'),
    approvedAfter(kind, 'returned'),
    approvedAfter(kind, 'denied'),
    financeStatus('s5', `${kind}-oct-approved`, kind, 'approved', '2026-10'),
  ];
}

/* ───────────── ОГД: одна одноразова виплата (ADR 0013) ───────────── */

const OGD_PACKET = 'demo-ogd-packet-01';

function ogdPacket(group: FixtureGroup, id: string, title: string, revision: string, extra: Payload = {}): Fixture {
  return fixture(group, id, title, 'finance.package_received', 'demo-finance', {
    kind: 'ogd',
    packet_ref: OGD_PACKET,
    packet_revision: revision,
    recipient_ref: 'demo-finance',
    confirmed_at: AT,
    evidence_ref: PROOF,
    ...extra,
  });
}

/** Стан ОГД; `after` — рішення, яке цей стан продовжує (порядок переходів має бути доведений). */
function ogdStatus(group: FixtureGroup, id: string, title: string, status: string, after: string | null): Fixture {
  return fixture(group, id, title, 'finance.status_recorded', 'demo-finance', {
    kind: 'ogd',
    packet_ref: OGD_PACKET,
    status,
    reason_code: ['returned', 'denied'].includes(status) ? 'documents_needed' : 'confirmed_scope',
    decision_ref: `demo-decision-${slug(id)}`,
    evidence_ref: PROOF,
    ...(after ? {previous_decision_ref: `demo-decision-${after}`} : {}),
  });
}

/**
 * Документи подано до уповноваженого органу → висновок уповноваженого органу за місцем служби →
 * рішення розпорядника бюджетних коштів → виплату здійснено. Навчальне джерело demo-finance
 * представляє обидва органи. Рішення ЕКОПФО / довідка МСЕК і заява — поза обсягом прототипу.
 */
const ogd: Fixture[] = [
  ogdPacket('d1', 'ogd-packet', 'D1 · ОГД · документи подано до уповноваженого органу', 'v1'),
  ogdStatus('d1', 'ogd-returned', 'D1 · ОГД · документи повернуто на доопрацювання', 'returned', null),
  ogdPacket('d1', 'ogd-packet-v2', 'D1 · ОГД · доопрацьовані документи подано повторно', 'v2', {supersedes_revision: 'v1'}),
  ogdStatus('d1', 'ogd-conclusion', 'D1 · ОГД · уповноважений орган підготував висновок', 'conclusion_prepared', 'ogd-returned'),
  ogdStatus('d1', 'ogd-approved', 'D1 · ОГД · розпорядник коштів ухвалив рішення про призначення', 'approved', 'ogd-conclusion'),
  ogdStatus('d1', 'ogd-execution_confirmed', 'D1 · ОГД · виплату здійснено', 'execution_confirmed', 'ogd-approved'),
  ogdStatus('s5', 'ogd-denied', 'S5 · ОГД · рішення про відмову в призначенні', 'denied', 'ogd-conclusion'),
  ogdStatus('s5', 'ogd-unknown', 'S5 · ОГД · стан невідомий', 'unknown', null),
  fixture('s5', 'ogd-second-packet', 'S5 · ОГД · другий пакет ОГД — виплата одноразова, на розбір', 'finance.package_received',
    'demo-finance', {
      kind: 'ogd',
      packet_ref: 'demo-ogd-packet-02',
      packet_revision: 'v1',
      recipient_ref: 'demo-finance',
      confirmed_at: AT,
      evidence_ref: PROOF,
    }),
];

/* ───────────── Прогалини, резерв і невизначений випадок ───────────── */

const exceptions: Fixture[] = [
  fixture('s6', 'gap', 'S6 · джерело повідомило про пропущений сигнал', 'source.sync_gap', 'demo-mis', {
    expected_type: 'care.start_confirmed',
    expected_stream: 'demo-stream-gap-recovered',
    evidence_ref: PROOF,
  }),
  fixture('s6', 'gap-recovered', 'S6 · пропущений сигнал відновлено', 'care.start_confirmed', 'demo-mis',
    careStart('2026-10-21'), {episode_ref: 'demo-d1-episode-a'}),
  fixture('s6', 'reserve-hospital', 'S6 · довідка про перебування в закладі без еПМК (резерв)', 'document.prepared',
    'demo-mis', {
      ...documentPayload('demo-hospital-reserve', 'hospital_stay_certificate'),
      enemy_action: 'yes',
      applicability_evidence_ref: PROOF,
    }, RESERVE_PERSON),
  fixture('s6', 'reserve-hospital-receipt', 'S6 · військовослужбовець отримав резервний документ', 'document.received',
    'demo-service', receipt('demo-hospital-reserve', 'v1', 'demo-person-02', 'servicemember'), RESERVE_PERSON),
  fixture('s6', 'reserve-admit', 'S6 · резервний кейс: надходження на лікування — початок відліку строку', 'care.admitted',
    'demo-mis', {provider_ref: 'demo-provider-2', date: '2026-11-12', evidence_ref: PROOF},
    {...RESERVE_PERSON, episode_ref: 'demo-reserve-episode'}),
  fixture('s1', 'reserve-primary', 'S1 · пізня еПМК для адміністративного резерву', 'medical.primary_recorded',
    'demo-mis', {document_kind: 'primary_medical_card', document_version: 'v1'}, RESERVE_PERSON),
  fixture('s1', 'uncertain', 'S1 · особа відома, випадок потребує звірки', 'medical.primary_recorded', 'demo-mis',
    {document_kind: 'primary_medical_card', document_version: 'v1'}, {incident_ref: null}),
];

export const fixtures: Fixture[] = [
  ...medical,
  ...certificate,
  ...vlk,
  ...financeRoute('reward'),
  ...ogd,
  ...exceptions,
];

export const fixtureById = (id: unknown): Fixture | undefined => fixtures.find(item => item.id === id);

/** Перша подія D1 для застарілого endpoint-а `/api/demo/primary`. */
export function primaryFixture(): EventEnvelope {
  return {
    schema_version: 'case-event/1',
    event_id: 'demo-ui-primary-v1',
    event_type: 'medical.primary_recorded',
    source_system: 'demo-mis',
    source_record_ref: 'demo-ui-primary-record',
    source_stream: 'demo-ui-primary-stream',
    source_version: 'v1',
    source_order: null,
    subject_ref: 'demo-person-01',
    incident_ref: 'demo-incident-01',
    episode_ref: null,
    occurred_at: '2026-11-13T10:00:00.000Z',
    recorded_at: '2026-11-13T10:05:00.000Z',
    payload: {document_kind: 'primary_medical_card', document_version: 'v1'},
  };
}
