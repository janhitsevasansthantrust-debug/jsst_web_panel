'use client';

import { useState } from 'react';
import { Upload, App, Image, Button, Typography } from 'antd';
import { LoadingOutlined, PlusOutlined, DeleteOutlined, CameraOutlined } from '@ant-design/icons';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import ImgCrop from 'antd-img-crop';

import { storage } from '../../lib/firebase/client.js';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';

const { Text } = Typography;

/**
 * Photo / document upload.
 *
 * Uploads straight from the browser to Firebase Storage and hands back the
 * download URL — the file never passes through our own server, so a slow
 * upload cannot tie up a route handler or hit a request-body limit.
 *
 * Images are downscaled to 1200px and re-encoded as JPEG before upload. A
 * phone photo is routinely 4–8 MB; at ~5,000 members that is tens of gigabytes
 * of storage and a slow load on every list that shows a thumbnail, to display
 * something that is never larger than a few hundred pixels.
 *
 * `crop` turns on the same cropper the old form used for portraits — rotate,
 * grid, zoom and reset. Passport-style photos matter here because these images
 * end up on printed certificates and receipts, where an uncropped snapshot
 * looks wrong.
 */
export default function PhotoUpload({
  label,
  value,
  onChange,
  accept = 'image/*',
  crop = false,
  required = false,
  /** Storage folder. Branding files do not belong under `members/`. */
  folder = 'members',
  /**
   * An alternative to writing straight to Firebase Storage: an async function
   * that takes the (already downscaled) file and returns a URL.
   *
   * Trust branding uses this to go through `/api/trust/branding` instead, so
   * that changing the logo is checked against the server session rather than
   * against Storage rules — which are deployed separately and, until they are,
   * refuse the upload with `storage/unauthorized` and no way to fix it from
   * inside the running app.
   */
  upload,
  /** Portrait by default; logos and signatures are wider than they are tall. */
  width = 104,
  height = 104,
}) {
  const { message } = App.useApp();
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function handleUpload({ file }) {
    // Member photos and documents go through the server (checked against the
    // session, not Storage rules). Other folders keep the direct upload.
    const viaServer = !upload && (folder === 'members' || folder === 'documents');
    if (!upload && !viaServer && !storage) {
      message.error(t('Firebase Storage उपलब्ध नहीं — .env.local जाँचें'));
      return;
    }

    setBusy(true);
    try {
      const prepared = file.type?.startsWith('image/') ? await downscale(file) : file;

      let url;
      if (upload) {
        url = await upload(prepared);
      } else if (viaServer) {
        const named = prepared instanceof File ? prepared : new File([prepared], 'photo.jpg', { type: prepared.type || 'image/jpeg' });
        url = await api.uploads.memberDoc(named, folder);
      } else {
        const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const path = `${folder}/${new Date().getFullYear()}/${name}`;

        const snap = await uploadBytes(storageRef(storage, path), prepared, {
          contentType: prepared.type || 'image/jpeg',
        });
        url = await getDownloadURL(snap.ref);
      }

      onChange(url);
      message.success(t('{label} अपलोड हो गया', { label }));
    } catch (error) {
      message.error(t('अपलोड नहीं हुआ: {error}', { error: error.message }));
    } finally {
      setBusy(false);
    }
  }

  const uploader = (
    <Upload
      listType="picture-card"
      showUploadList={false}
      accept={accept}
      customRequest={handleUpload}
      beforeUpload={(file) => {
        if (file.size > 15 * 1024 * 1024) {
          message.error(t('फ़ाइल 15MB से बड़ी है'));
          return Upload.LIST_IGNORE;
        }
        return true;
      }}
    >
      <div>
        {busy ? <LoadingOutlined /> : crop ? <CameraOutlined /> : <PlusOutlined />}
        <div style={{ marginTop: 6, fontSize: 12 }}>{t('अपलोड')}</div>
      </div>
    </Upload>
  );

  return (
    <div style={{ marginBottom: 16 }}>
      <Text style={{ display: 'block', marginBottom: 6 }}>
        {label}
        {required && <Text type="danger"> *</Text>}
      </Text>

      {value ? (
        <div style={{ position: 'relative', width }}>
          <Image
            src={value}
            alt={label}
            width={width}
            height={height}
            style={{ objectFit: 'contain', borderRadius: 8, border: '1px solid #e8e8e8', background: '#fafafa' }}
          />
          <Button
            size="small"
            danger
            type="text"
            icon={<DeleteOutlined />}
            onClick={() => onChange('')}
            style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,255,255,.9)' }}
          />
        </div>
      ) : crop ? (
        <ImgCrop rotationSlider aspectSlider showGrid showReset quality={0.9}>
          {uploader}
        </ImgCrop>
      ) : (
        uploader
      )}
    </div>
  );
}

/**
 * Downscale to fit 1200px and re-encode as JPEG at 82% quality.
 * Typically turns a 6 MB phone photo into ~200 KB with no visible difference
 * at the sizes this app displays.
 */
async function downscale(file, max = 1200, quality = 0.82) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file; // unsupported format — upload as-is

  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 400 * 1024) return file;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  bitmap.close?.();

  return blob && blob.size < file.size ? blob : file;
}
