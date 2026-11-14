import {Button} from '../../components/Button';
import type {CommandDraft} from '../../app/useCommand';

interface SampleGalleryProps {
  caseId: string;
  busy: boolean;
  onCommand: (draft: CommandDraft) => void;
}

/** Додавання вигаданого зразка з готової галереї: справжні файли не приймаються. */
export function SampleGallery({caseId, busy, onCommand}: SampleGalleryProps) {
  return (
    <div className="gallery">
      <div>
        <h3 className="gallery__title">Додати вигаданий зразок</h3>
        <p className="gallery__text">
          Лише готові навчальні зразки: справжні фото й файли не приймаються. Копія не стає оригіналом —
          документ усе одно має підтвердити джерело.
        </p>
      </div>
      <div className="gallery__actions">
        <Button
          icon="plus"
          disabled={busy}
          onClick={() => onCommand({caseId, action: 'copy', option: 'trauma_certificate'})}
        >
          Додати навчальну копію довідки
        </Button>
        <Button disabled={busy} onClick={() => onCommand({caseId, action: 'copy', option: 'wrong_kind'})}>
          Спробувати зразок іншого виду
        </Button>
      </div>
    </div>
  );
}
