'use client';

import { Dropdown, Button, Tooltip } from 'antd';
import { GlobalOutlined, CheckOutlined } from '@ant-design/icons';

import { LOCALES, useLocale, setLocale, useT } from '../../i18n/index.js';

/**
 * Language.
 *
 * Each option is written in its own script — `ગુજરાતી`, not "Gujarati" — because
 * someone looking for their language recognises it written the way they write
 * it, and may not read the name of it in English at all.
 *
 * The choice is remembered per device rather than per account: the same
 * counter is often used by several people, and it is the person at the screen
 * whose language matters, not whose login is open.
 */
export default function LanguageSwitcher({ compact = false }) {
  const locale = useLocale();
  const t = useT();

  const current = LOCALES.find((l) => l.value === locale) ?? LOCALES[0];

  return (
    <Tooltip title={t('भाषा')}>
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        menu={{
          items: LOCALES.map((l) => ({
            key: l.value,
            label: l.native,
            icon: l.value === locale ? <CheckOutlined /> : <span style={{ width: 14 }} />,
            onClick: () => setLocale(l.value),
          })),
        }}
      >
        <Button type="text" icon={<GlobalOutlined />}>
          {compact ? null : current.native}
        </Button>
      </Dropdown>
    </Tooltip>
  );
}
