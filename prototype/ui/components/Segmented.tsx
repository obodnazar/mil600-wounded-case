interface Option<T extends string> {
  value: T;
  label: string;
  /** Лічильник поруч із підписом. */
  count?: number | undefined;
}

interface SegmentedProps<T extends string> {
  /** Підпис групи для зчитувачів екрана. */
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** chips — окремі кнопки з переносом; bar — суцільна смуга. */
  variant?: 'bar' | 'chips';
}

/** Перемикач зі справжніх кнопок: стан передається через aria-pressed. */
export function Segmented<T extends string>(props: SegmentedProps<T>) {
  const {label, options, value, onChange, disabled = false, variant = 'bar'} = props;
  return (
    <div className={`segmented segmented--${variant}`} role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className="segmented__option"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          <span>{option.label}</span>
          {option.count !== undefined && <span className="segmented__count">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}
