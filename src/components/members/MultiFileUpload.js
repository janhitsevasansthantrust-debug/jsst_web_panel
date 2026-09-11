'use client';

import { useState } from 'react';
import { Upload, App, Button, Typography, Space, Image } from 'antd';
import { UploadOutlined, DeleteOutlined, FileOutlined } from '@ant-design/icons';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

import { storage } from '../../lib/firebase/client.js';
import { useT } from '../../i18n/index.js';

const { Text } = Typography;

/**
 * Several files under one label — an agent's ID documents, for example.
 *
 * Uploads go straight from the browser to Firebase Storage; the URLs come back
 * as an array. Removing an entry drops the URL from the record but leaves the
 * blob in Storage — deliberate, so a mis-click cannot destroy a document that
 * something else still references.
 */
export default function MultiFileUpload({ label, value = [], onChange, max = 5, folder = 'documents' }) {
  const { message } = App.useApp();
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function handleUpload({ file }) {
    if (!storage) {
      message.error(t('Firebase Storage उपलब्ध नहीं — .env.local जाँचें'));
      return;
    }
    if (value.length >= max) {
      message.warning(t('अधिकतम {n} फ़ाइलें', { n: max }));
      return;
    }

    setBusy(true);
    try {
      const safe = String(file.name).replace(/[^\w.\-]/g, '_');
      const path = `${folder}/${Date.now()}_${safe}`;
      const snap = await uploadBytes(storageRef(storage, path), file, {
        contentType: file.type || 'application/octet-stream',
      });
      onChange([...value, await getDownloadURL(snap.ref)]);
      message.success(t('अपलोड हो गया'));
    } catch (error) {
      message.error(t('अपलोड नहीं हुआ: {error}', { error: error.message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <Text style={{ display: 'block', marginBottom: 6 }}>{label}</Text>

      <Space direction="vertical" style={{ width: '100%' }} size={6}>
        {value.map((url, i) => (
          <Space key={url} style={{ width: '100%' }}>
            {isImage(url) ? (
              <Image src={url} width={44} height={44} style={{ objectFit: 'cover', borderRadius: 4 }} />
            ) : (
              <FileOutlined style={{ fontSize: 22 }} />
            )}
            <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
              {t('दस्तावेज़')} {i + 1}
            </a>
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onChange(value.filter((u) => u !== url))}
            />
          </Space>
        ))}

        {value.length < max && (
          <Upload showUploadList={false} customRequest={handleUpload} beforeUpload={sizeGuard(message, t)}>
            <Button icon={<UploadOutlined />} loading={busy} block>
              {t('अपलोड')} ({value.length}/{max})
            </Button>
          </Upload>
        )}
      </Space>
    </div>
  );
}

const sizeGuard = (message, t) => (file) => {
  if (file.size > 15 * 1024 * 1024) {
    message.error(t('फ़ाइल 15MB से बड़ी है'));
    return Upload.LIST_IGNORE;
  }
  return true;
};

const isImage = (url) => /\.(png|jpe?g|webp|gif)/i.test(url) || url.includes('image');
