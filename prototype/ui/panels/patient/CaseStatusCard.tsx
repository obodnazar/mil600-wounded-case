import type {PatientCaseView} from '../../../shared/api';
import {Card} from '../../components/Card';
import {DateText} from '../../components/DateText';
import {Icon} from '../../components/Icon';
import {StatusPill} from '../../components/StatusPill';
import {describeFreshness, STAGE_LABELS} from '../../content/labels';

/** Де зараз кейс: стадія від сервера, зв’язок із джерелом і актуальність даних. Без прогнозів. */
export function CaseStatusCard({view}: {view: PatientCaseView}) {
  const freshness = describeFreshness(view.freshness, view.lastSourceAt);
  return (
    <Card surface="olive" as="section" className="case-status" labelledBy="case-status-title">
      <p className="eyebrow">Де зараз мій кейс</p>
      <h2 id="case-status-title" className="case-status__stage">
        {STAGE_LABELS[view.stage]}
      </h2>
      {!view.sourceLinked && (
        <p className="case-status__flag">
          <Icon name="clock" size={16} />
          Медичний документ ще не підтверджений
        </p>
      )}
      <p className="case-status__hint">
        Документи, ВЛК і виплати показано окремо. ОГД розглядається лише після постанови ВЛК — дивіться нижче.
      </p>
      <div className="case-status__freshness">
        <StatusPill tone={freshness.tone}>{freshness.label}</StatusPill>
        {view.freshness !== 'fresh' && <p>{freshness.detail}</p>}
        {view.lastSourceAt && (
          <p className="case-status__updated">
            Останнє підтвердження джерела: <DateText value={view.lastSourceAt} withTime />
          </p>
        )}
      </div>
    </Card>
  );
}
