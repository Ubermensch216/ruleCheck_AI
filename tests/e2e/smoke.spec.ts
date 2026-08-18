import { expect, test } from '@playwright/test';

test('shows the local RuleLens AI review workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('RuleLens AI', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '검토 설정' })).toBeVisible();
  await expect(page.getByRole('region', { name: '검토 결과 작업공간' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '검토 결과가 표시될 공간입니다.' })).toBeVisible();
  await expect(page.getByText('검토 기준', { exact: true })).toBeVisible();
  await expect(page.getByText('검토 대상', { exact: true })).toBeVisible();
  await expect(page.getByText('REVIEW SETUP')).toHaveCount(0);
  await expect(page.getByText('문서를 순서대로 준비하면 결과가 오른쪽에 표시됩니다.')).toHaveCount(0);
  await expect(page.getByText('모델과 제목을 확인하세요.')).toHaveCount(0);
  await expect(page.getByText('AI 모델', { exact: true })).toHaveCount(0);
  await expect(page.getByText('검토 제목', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /근거 기반 검토 실행/ })).toBeDisabled();

  const sidebar = await page.getByRole('complementary', { name: '검토 설정' }).boundingBox();
  const results = await page.getByRole('region', { name: '검토 결과 작업공간' }).boundingBox();
  expect(sidebar).not.toBeNull();
  expect(results).not.toBeNull();
  expect(sidebar!.x + sidebar!.width).toBeLessThan(results!.x);
});

test('stacks setup before results on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const sidebar = await page.getByRole('complementary', { name: '검토 설정' }).boundingBox();
  const results = await page.getByRole('region', { name: '검토 결과 작업공간' }).boundingBox();
  expect(sidebar).not.toBeNull();
  expect(results).not.toBeNull();
  expect(sidebar!.y + sidebar!.height).toBeLessThanOrEqual(results!.y);
});

test('shows icon-only document replacement controls after upload', async ({ page }) => {
  await page.goto('/');
  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.nth(0).setInputFiles('tests/docs/grc-reference-policy.docx');
  await expect(page.getByText('grc-reference-policy.docx', { exact: true })).toBeVisible();
  await fileInputs.nth(1).setInputFiles('tests/docs/grc-target-policy.docx');
  await expect(page.getByText('grc-target-policy.docx', { exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: '검토 기준 다른 문서 선택' })).toBeAttached();
  await expect(page.getByRole('button', { name: '검토 대상 다른 문서 선택' })).toBeAttached();
  await expect(page.getByText('다른 문서 선택', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /근거 기반 검토 실행/ })).toBeEnabled();
});
