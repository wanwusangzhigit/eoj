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

export default function ImageUploadButton({ onInsert }: ImageUploadButtonProps) {
  const addToast = useToastStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
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
      const result = await api.uploadImage(file);
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
    </>
  );
}
