import { t } from '../i18n';

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: t('status.pending'), className: 'badge badge-warning' },
  running: { label: t('status.running'), className: 'badge badge-info' },
  accepted: { label: t('status.accepted'), className: 'badge badge-success' },
  wrong_answer: { label: t('status.wrong_answer'), className: 'badge badge-error' },
  time_limit_exceeded: { label: t('status.time_limit_exceeded'), className: 'badge badge-error' },
  memory_limit_exceeded: { label: t('status.memory_limit_exceeded'), className: 'badge badge-error' },
  runtime_error: { label: t('status.runtime_error'), className: 'badge badge-error' },
  compile_error: { label: t('status.compile_error'), className: 'badge badge-error' },
  system_error: { label: t('status.system_error'), className: 'badge badge-error' },
  security_blocked: { label: t('status.security_blocked'), className: 'badge badge-error' },
};

export default function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status];
  if (config) {
    return <span className={config.className}>{config.label}</span>;
  }
  return (
    <span
      className="badge"
      style={{ color: 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}
    >
      {status}
    </span>
  );
}
