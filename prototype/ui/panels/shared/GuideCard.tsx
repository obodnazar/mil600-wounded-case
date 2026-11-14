import {useGuide} from '../../app/useGuide';
import {Button} from '../../components/Button';
import {Card} from '../../components/Card';
import {Icon} from '../../components/Icon';

/** Гайд допомоги без входу: зміст приходить із сервера й доступний без ролі. */
export function GuideCard() {
  const {state, retry} = useGuide();
  return (
    <Card surface="outline" as="article" className="guide">
      <p className="eyebrow eyebrow--icon">
        <Icon name="shield" size={16} />
        Доступно без входу
      </p>
      {state.status === 'loading' && (
        <p role="status" className="muted">
          Завантажуємо гайд…
        </p>
      )}
      {state.status === 'failed' && (
        <>
          <h3>Допомога без входу бійця</h3>
          <p>Гайд не завантажився. Зверніться до призначеної служби супроводу через чинний службовий канал.</p>
          <Button icon="refresh" onClick={retry}>
            Завантажити гайд ще раз
          </Button>
        </>
      )}
      {state.status === 'ready' && (
        <>
          <h3>{state.guide.title}</h3>
          {state.guide.steps.length > 0 ? (
            <ol className="guide__steps">
              {state.guide.steps.map(step => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : (
            <p className="muted">Кроків гайду поки немає.</p>
          )}
        </>
      )}
    </Card>
  );
}
