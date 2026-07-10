// Rating 到颜色的映射（类似洛谷/Codeforces）
export function getRatingColor(rating: number): string {
  if (rating < 800) return '#9d9d9d';      // 灰色 - 未评级
  if (rating < 1200) return '#fe2c55';     // 红
  if (rating < 1600) return '#ff7c00';     // 橙
  if (rating < 2000) return '#ffc800';     // 黄
  if (rating < 2400) return '#52c41a';     // 绿
  if (rating < 2800) return '#3498db';     // 蓝
  if (rating < 3200) return '#9b59b6';     // 紫
  return '#1a1a1a';                         // 黑
}

// Rating 到难度标签文字
export function getRatingLabel(rating: number): string {
  if (rating < 800) return 'Unrated';
  if (rating < 1200) return '入门';
  if (rating < 1600) return '普及';
  if (rating < 2000) return '提高';
  if (rating < 2400) return '省选';
  if (rating < 2800) return 'NOI';
  if (rating < 3200) return 'CTSC';
  return '传说';
}

// Rating 段位名称（英文）
export function getRatingTier(rating: number): string {
  if (rating < 800) return 'Unrated';
  if (rating < 1200) return 'Novice';
  if (rating < 1600) return 'Pupil';
  if (rating < 2000) return 'Specialist';
  if (rating < 2400) return 'Expert';
  if (rating < 2800) return 'Candidate Master';
  if (rating < 3200) return 'Master';
  return 'Legendary Grandmaster';
}

// 用户名带Rating颜色（类似洛谷用户名颜色）
export function getUserRatingColor(rating: number): string {
  return getRatingColor(rating);
}
