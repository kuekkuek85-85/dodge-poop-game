// 이름 마스킹. 대시보드에 나가는 이름은 서버에서 가려서 내보낸다.
// (클라이언트가 원본 이름을 아예 받지 않도록 하기 위함 — PRD 5.3)

import { MASK_MODE } from '../public/js/shared/config.js';

export function maskName(name, mode = MASK_MODE) {
  const chars = [...String(name || '').trim()];
  if (chars.length === 0) return '';
  if (chars.length === 1) return chars[0];

  if (mode === 'full') {
    // 성만 남기고 전부 가림: 김○○
    return chars[0] + '○'.repeat(chars.length - 1);
  }
  // 기본: 가운데 글자만 가림 (홍길동 → 홍○동, 김철 → 김○)
  if (chars.length === 2) return chars[0] + '○';
  return chars[0] + '○'.repeat(chars.length - 2) + chars[chars.length - 1];
}
