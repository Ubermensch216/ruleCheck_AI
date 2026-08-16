import type { Finding, OverallRisk } from '../../shared/schemas.js';

export function calculateRisk(findings: Finding[], coverageRate: number): OverallRisk {
  if (findings.some((item) => item.status === '충돌 가능성' && item.severity === 'Critical')) return 'High';
  if (findings.filter((item) => item.status === '충돌 가능성' && item.severity === 'High').length >= 2) return 'High';
  if (coverageRate < 1 || findings.some((item) =>
    item.status === '충돌 가능성' || item.status === '일부 보완 필요' ||
    (item.status === '확인 불가' && ['Critical', 'High'].includes(item.severity)))) return 'Medium';
  return 'Low';
}
