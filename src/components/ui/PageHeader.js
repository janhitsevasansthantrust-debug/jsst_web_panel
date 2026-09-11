'use client';

import { Typography, Space, Alert } from 'antd';

const { Title, Text } = Typography;

/**
 * The title row every screen starts with.
 *
 * The accent bar on the left is the one place the brand colour appears on an
 * otherwise neutral page — enough to tie the screens together without turning
 * every heading into a colour.
 *
 * `error` is rendered here rather than left to each page because an error that
 * each screen handles its own way is an error some screen forgets to handle.
 */
export default function PageHeader({ title, subtitle, extra, error }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 14, minWidth: 0 }}>
          <div
            aria-hidden
            style={{
              width: 5,
              alignSelf: 'stretch',
              minHeight: 42,
              borderRadius: 6,
              background: 'linear-gradient(180deg, var(--brand), var(--accent))',
              flex: '0 0 5px',
            }}
          />
          <div style={{ minWidth: 0 }}>
            <Title
              level={3}
              className="page-title"
              style={{ margin: 0, fontSize: 24, lineHeight: 1.35, fontWeight: 700 }}
            >
              {title}
            </Title>
            {subtitle && (
              <Text type="secondary" style={{ fontSize: 13.5, color: 'var(--muted)' }}>
                {subtitle}
              </Text>
            )}
          </div>
        </div>

        <Space wrap>{extra}</Space>
      </div>

      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 14, borderRadius: 'var(--radius-sm)' }}
          message={error.message ?? String(error)}
          description={
            error.details
              ? Object.entries(error.details)
                  .map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`)
                  .join(' · ')
              : undefined
          }
        />
      )}
    </div>
  );
}
