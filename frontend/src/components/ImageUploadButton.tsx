import { useRef, useState } from 'react';
import { api } from '../api/client';
import { useToastStore } from '../store/toast';
import { useSettingsStore } from '../store/settings';
import { usePermissions } from '../hooks/usePermissions';
import { t } from '../i18n';
import { ImageIcon, Loader2 } from 'lucide-react';

interface ImageUploadButtonProps {
  onInsert: (markdown: string) => void;
}

// 超过该尺寸/大小的图片在客户端压缩后再上传(节省存储与带宽)
const MAX_DIMENSION = 1920;   // 最长边像素
const MAX_SIZE_BYTES = 800 * 1024; // 超过 800KB 才压缩
const JPEG_QUALITY = 0.82;

/**
 * 用 canvas 压缩图片:等比缩放到 MAX_DIMENSION 内,导出 JPEG。
 * GIF 跳过压缩(保持动画),小图直接返回原文件。
 */
async function compressImage(file: File): Promise<File> {
  if (file.type === 'image/gif' || file.size <= MAX_SIZE_BYTES) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, tw, th);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) {
      return file; // 压缩无收益时退回原文件
    }

    const name = file.name.replace(/\.(png|webp)$/i, '.jpg');
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file; // 压缩失败不影响上传
  }
}

export default function ImageUploadButton({ onInsert }: ImageUploadButtonProps) {
  const addToast = useToastStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // 是否公开:私密图片仅本人或管理员可查看
  const [isPublic, setIsPublic] = useState(true);
  const getImageUploadEnabled = useSettingsStore((s) => s.getImageUploadEnabled);
  const perms = usePermissions();

  // Hide button if image upload is disabled and user doesn't have upload_admin permission
  if (!getImageUploadEnabled() && !perms.canManageUploads) {
    return null;
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const toUpload = await compressImage(file);
      const result = await api.uploadImage(toUpload, isPublic);
      const markdown = `![${result.original_name}](${result.url})`;
      onInsert(markdown);
      addToast('success', t('common.uploadSuccess'));
    } catch (err: any) {
      addToast('error', err.message || t('common.uploadFailed'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />
      <button
        type="button"
        className="btn btn-secondary btn-sm image-upload-btn"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        title={t('common.insertImage')}
      >
        {uploading ? <Loader2 size={14} className="spin" /> : <ImageIcon size={14} />}
        {t('common.insertImage')}
      </button>
      <label className="image-upload-private" title={t('common.uploadPrivateHint')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8, fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)' }}>
        <input
          type="checkbox"
          checked={!isPublic}
          onChange={(e) => setIsPublic(!e.target.checked)}
          disabled={uploading}
        />
        {t('common.uploadPrivate')}
      </label>
    </>
  );
}
