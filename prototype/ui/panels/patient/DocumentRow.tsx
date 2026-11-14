import type {DocumentItemView, RouteCode} from '../../../shared/api';
import {Icon} from '../../components/Icon';
import {StatusPill} from '../../components/StatusPill';
import {
  DELIVERY_DETAILS,
  DELIVERY_STEPS,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_STATES,
  PROVENANCE_LABELS,
  ROUTE_RECIPIENTS,
  VERSION_STATE_LABELS,
} from '../../content/labels';

/** Доставка чинної версії: «не передано», «надіслано» й «отримано» — різні підтвердження. */
function DeliveryTrack({delivery, recipient}: {delivery: DocumentItemView['delivery']; recipient: string}) {
  const reached = DELIVERY_STEPS.findIndex(step => step.state === delivery);
  return (
    <div className="delivery">
      <p className="delivery__label">Доставка адресатові ({recipient})</p>
      <ol className="delivery__steps">
        {DELIVERY_STEPS.map((step, index) => (
          <li
            key={step.state}
            className={index === reached ? `is-current is-${delivery}` : index < reached ? 'is-done' : 'is-ahead'}
            aria-current={index === reached ? 'step' : undefined}
          >
            {index === reached && <Icon name={delivery === 'received' ? 'check' : 'clock'} size={16} />}
            {step.label}
          </li>
        ))}
      </ol>
      <p className="delivery__detail">{DELIVERY_DETAILS[delivery]}</p>
    </div>
  );
}

function VersionHistory({history}: {history: DocumentItemView['history']}) {
  if (history.length === 0) return null;
  return (
    <details className="disclosure">
      <summary>Попередні версії: {history.length}</summary>
      <ul className="plain-list">
        {history.map(entry => (
          <li key={`${entry.version}-${entry.state}`}>
            Версія {entry.version} — {VERSION_STATE_LABELS[entry.state]}
          </li>
        ))}
      </ul>
    </details>
  );
}

interface DocumentRowProps {
  item: DocumentItemView;
  route: RouteCode;
}

/** Один документ переліку: стан, чинна версія, походження, доставка й історія версій. */
export function DocumentRow({item, route}: DocumentRowProps) {
  const state = DOCUMENT_STATES[item.state];
  const hasDocument = item.version !== null;
  return (
    <li className="document">
      <div className="document__head">
        <span className="document__icon">
          <Icon name="document" />
        </span>
        <h4 className="document__title">{DOCUMENT_KIND_LABELS[item.kind]}</h4>
      </div>
      <StatusPill tone={state.tone}>{state.label}</StatusPill>
      <dl className="document__meta">
        <div>
          <dt>Чинна версія</dt>
          <dd>{item.version ?? 'документа ще немає'}</dd>
        </div>
        <div>
          <dt>Походження</dt>
          <dd>{item.provenance ? PROVENANCE_LABELS[item.provenance] : 'очікуємо джерело'}</dd>
        </div>
      </dl>
      {hasDocument && <DeliveryTrack delivery={item.delivery} recipient={ROUTE_RECIPIENTS[route]} />}
      <VersionHistory history={item.history} />
    </li>
  );
}
