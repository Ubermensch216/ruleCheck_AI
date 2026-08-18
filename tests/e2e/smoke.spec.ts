import { expect, test } from '@playwright/test';

test('shows the local RuleLens AI review workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('RuleLens AI', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /문서 간 규정 충돌/ })).toBeVisible();
  await expect(page.getByText('검토 기준', { exact: true })).toBeVisible();
  await expect(page.getByText('검토 대상', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /근거 기반 검토 실행/ })).toBeDisabled();
});
