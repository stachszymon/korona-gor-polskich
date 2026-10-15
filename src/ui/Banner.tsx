import type { ReactNode } from 'react';

export interface BannerProps {
  kind: 'info' | 'warning' | 'error';
  children: ReactNode;
  /** Shows a "Zamknij" button when given. */
  onDismiss?(): void;
  action?: { label: string; onClick(): void };
}

export function Banner({ kind, children, onDismiss, action }: BannerProps) {
  return (
    <div className={`banner banner--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <p className="banner__text">{children}</p>
      {action && (
        <button type="button" className="banner__button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button type="button" className="banner__button" onClick={onDismiss}>
          Zamknij
        </button>
      )}
    </div>
  );
}
