export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export async function fetchJson(path, options) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `API 요청에 실패했습니다. (${response.status})`);
  return body;
}

export function formatNumber(value) {
  if (value === undefined || value === null || value === '') return '';
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return number.toLocaleString('ko-KR');
}

export function toPercent(value) {
  if (value === undefined || value === null || value === '') return '';
  const number = Number(value);
  if (Number.isNaN(number)) return `${value}%`;
  return `${number > 0 ? '+' : ''}${number}%`;
}
