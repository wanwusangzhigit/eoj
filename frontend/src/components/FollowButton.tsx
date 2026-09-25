import { useState } from 'react';
import { UserPlus, UserCheck } from 'lucide-react';
import { api } from '../api/client';
import { t } from '../i18n';
import { useToastStore } from '../store/toast';

interface FollowButtonProps {
  userId: number | string;
  initialFollowing: boolean;
  onChange?: (following: boolean) => void;
}

export default function FollowButton({ userId, initialFollowing, onChange }: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const handleClick = async () => {
    setLoading(true);
    try {
      if (following) {
        await api.unfollowUser(userId);
        setFollowing(false);
        onChange?.(false);
      } else {
        await api.followUser(userId);
        setFollowing(true);
        onChange?.(true);
        addToast('success', t('follow.follow'));
      }
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  if (following) {
    return (
      <button className="btn btn-secondary btn-sm" onClick={handleClick} disabled={loading}>
        <UserCheck size={14} />
        {t('follow.following')}
      </button>
    );
  }

  return (
    <button className="btn btn-primary btn-sm" onClick={handleClick} disabled={loading}>
      <UserPlus size={14} />
      {t('follow.follow')}
    </button>
  );
}
