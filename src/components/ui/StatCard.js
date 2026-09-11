'use client';

import { Card, Typography, Space } from 'antd';

const { Text } = Typography;

/**
 * One number, said once.
 *
 * The colour is carried by a left rule and the icon chip, never by the number
 * itself. Four full-colour figures side by side compete with each other, and
 * the one that actually matters — what is owed — stops standing out. Keeping
 * the digits near-black means a red number always means something.
 *
 * Used by the dashboard and the members list so a count looks the same
 * wherever it appears.
 */
export default function StatCard({ icon, color = 'var(--brand)', label, value, hint, extra }) {
  return (
    <Card
      size="small"
      className="stat-card"
      style={{
        borderInlineStart: `3px solid ${color}`,
        height: '100%',
        borderTop: '1px solid var(--line)',
        borderRight: '1px solid var(--line)',
        borderBottom: '1px solid var(--line)',
      }}
      styles={{ body: { padding: '15px 16px' } }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {icon && (
          <div
            aria-hidden
            style={{
              width: 38, height: 38, borderRadius: 11, flexShrink: 0,
              display: 'grid', placeItems: 'center',
              background: `color-mix(in srgb, ${color} 12%, transparent)`,
              color,
              fontSize: 17,
            }}
          >
            {icon}
          </div>
        )}

        <div style={{ minWidth: 0, lineHeight: 1.3, flex: 1 }}>
          <Text type="secondary" style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</Text>
          <div
            className="num"
            style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginTop: 2, letterSpacing: '-0.01em' }}
          >
            {value}
          </div>
          {hint && <Text type="secondary" style={{ fontSize: 11.5 }}>{hint}</Text>}
          {extra && <div style={{ marginTop: 7 }}><Space size={4} wrap>{extra}</Space></div>}
        </div>
      </div>
    </Card>
  );
}
