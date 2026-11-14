import type {AnalyticsView} from '../../../shared/api';
import {Card} from '../../components/Card';
import {DateText} from '../../components/DateText';
import {EmptyState} from '../../components/EmptyState';
import {Icon} from '../../components/Icon';
import {PageHeader} from '../../components/PageHeader';
import {Tag} from '../../components/StatusPill';
import {ANALYTICS_LIMITS} from '../../content/analytics';
import {MetricCard} from './MetricCard';

function CohortCard({view}: {view: AnalyticsView}) {
  return (
    <Card surface="olive" as="section" className="cohort" labelledBy="cohort-title">
      <div>
        <Tag accent>Фіксована синтетична когорта</Tag>
        <h2 id="cohort-title">Не живі кейси, а незмінний вигаданий зріз</h2>
        <ul className="cohort__limits">
          {ANALYTICS_LIMITS.map(limit => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </div>
      <dl className="cohort__stamp">
        <div>
          <dt>Зріз станом на</dt>
          <dd>
            <DateText value={view.asOf} />
          </dd>
        </div>
        <div>
          <dt>Позначка зрізу</dt>
          <dd>{view.cohort}</dd>
        </div>
        <div>
          <dt>Поріг малої групи</dt>
          <dd>{view.minimum}</dd>
        </div>
      </dl>
    </Card>
  );
}

function ProtectionCard({minimum}: {minimum: number}) {
  return (
    <Card surface="dark" as="section" className="protection" labelledBy="protection-title">
      <span className="protection__icon">
        <Icon name="shield" size={28} />
      </span>
      <div>
        <h2 id="protection-title">Малі групи й пов’язані підсумки не розкриваємо</h2>
        <p>
          Поріг демо — {minimum}. Якщо група менша або її можна вирахувати з сусідніх підсумків
          (доповнювальна група), приховуємо значення, пов’язані клітинки й точні розміри. Рядки окремих
          людей до браузера не передаються взагалі.
        </p>
      </div>
    </Card>
  );
}

/** Панель аналітика: шість показників на фіксованій вигаданій когорті. */
export function AnalyticsPanel({view}: {view: AnalyticsView}) {
  return (
    <>
      <PageHeader
        eyebrow="Вимір процесу"
        title="Огляд процесу"
        lead="Де маршрут сповільнюється — без даних окремих людей."
      />
      <CohortCard view={view} />
      {view.metrics.length > 0 ? (
        <div className="metric-grid">
          {view.metrics.map(metric => (
            <MetricCard key={metric.id} metric={metric} />
          ))}
        </div>
      ) : (
        <Card className="metric-empty">
          <EmptyState icon="chart" title="Показників у цьому зрізі немає">
            Сервер не передав жодного показника. Оберіть інший зріз у симуляторі або оновіть панель.
          </EmptyState>
        </Card>
      )}
      <ProtectionCard minimum={view.minimum} />
    </>
  );
}
