export interface ProgressCounterProps {
  done: number;
  total: number;
}

export function ProgressCounter({ done, total }: ProgressCounterProps) {
  return (
    <span className="progress-counter" aria-label={`Zdobyte szczyty: ${done} z ${total}`}>
      {done} / {total}
    </span>
  );
}
