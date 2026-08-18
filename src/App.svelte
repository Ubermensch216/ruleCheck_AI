<script lang="ts">
  import { onMount } from 'svelte';
  import DOMPurify from 'dompurify';
  import { marked } from 'marked';
  import type { DocumentKind, Finding } from '../shared/schemas';
  import {
    cancelCurrentReview, deleteReview, grcStore, initialize, loadReview, reset,
    setModel, startReview, uploadDocument
  } from './stores/grcStore';

  let title = '';
  let historyOpen = false;
  let selectedFinding: Finding | undefined;
  let statusFilter = '전체';

  const running = (status?: string) => Boolean(status && ['queued', 'parsing', 'analyzing', 'merging'].includes(status));
  const riskLabel = (risk?: string) => risk === 'High' ? '높음' : risk === 'Medium' ? '보통' : risk === 'Low' ? '낮음' : '-';
  const statusLabel = (status: string) => ({ queued: '검토 준비', parsing: '문서 분석', analyzing: '조항 검토', merging: '결과 정리', completed: '완료', failed: '실패', cancelled: '취소됨', deleting: '삭제 중' } as Record<string, string>)[status] ?? status;
  const stageIndex = (status?: string) => ({ queued: 0, parsing: 1, analyzing: 2, merging: 3, completed: 4 } as Record<string, number>)[status ?? ''] ?? 0;
  const safeMarkdown = (value?: string) => DOMPurify.sanitize(marked.parse(value ?? '') as string);
  const filteredFindings = () => statusFilter === '전체' ? $grcStore.findings : $grcStore.findings.filter((item) => item.status === statusFilter);

  async function selectFile(event: Event, kind: DocumentKind) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await uploadDocument(file, kind);
    input.value = '';
  }

  function drop(event: DragEvent, kind: DocumentKind) {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) void uploadDocument(file, kind);
  }

  function openFinding(finding: Finding) { selectedFinding = finding; }

  async function removeReview(id: string) {
    if (window.confirm('검토 이력과 업로드한 두 문서를 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) {
      await deleteReview(id);
    }
  }

  async function copyOpinion() {
    if ($grcStore.review?.draftOpinion) await navigator.clipboard.writeText($grcStore.review.draftOpinion);
  }

  onMount(() => { void initialize(); });
</script>

<svelte:head>
  <title>RuleLens AI · 근거 기반 규정 검토</title>
  <meta name="description" content="로컬 AI 기반 내부 규정 적합성 검토 시스템" />
</svelte:head>

<header class="topbar">
  <div class="brand">
    <span class="brand-mark" aria-hidden="true">✓</span>
    <div><strong>RuleLens AI</strong><small>근거 기반 규정 검토</small></div>
  </div>
  <div class="header-actions">
    <span class:online={$grcStore.serverReady} class="connection"><i></i>{$grcStore.serverReady ? 'Ollama 연결됨' : '연결 확인 필요'}</span>
    <button class="ghost" onclick={() => historyOpen = true}>검토 이력 <span class="count">{$grcStore.history.length}</span></button>
    <button class="ghost" onclick={reset}>새 검토</button>
  </div>
</header>

<main class="app-layout">
  <aside class="control-sidebar" aria-label="검토 설정">
    <div class="control-intro">
      <p class="eyebrow">REVIEW SETUP</p>
      <h1>검토 설정</h1>
      <p>문서를 순서대로 준비하면 결과가 오른쪽에 표시됩니다.</p>
    </div>

    {#if $grcStore.error}
      <div class="alert error compact-alert" role="alert"><strong>처리할 수 없습니다</strong><span>{$grcStore.error}</span></div>
    {/if}

    <div class="control-steps">
      {#each [{ kind: 'policy' as DocumentKind, step: '01', title: '검토 기준', description: '판단 기준이 되는 규정·지침', icon: '§' }, { kind: 'target' as DocumentKind, step: '02', title: '검토 대상', description: '기준과 비교할 계약서·정책', icon: '▤' }] as panel (panel.kind)}
        {@const document = $grcStore[panel.kind]}
        <section class="control-step" class:complete={Boolean(document)} ondragover={(event) => event.preventDefault()} ondrop={(event) => drop(event, panel.kind)}>
          <div class="step-heading">
            <span class="step">{document ? '✓' : panel.step}</span>
            <div><h2>{panel.title}</h2><p>{panel.description}</p></div>
          </div>
          {#if document}
            <div class="compact-file">
              <span class="file-icon" aria-hidden="true">{panel.icon}</span>
              <div><strong>{document.filename}</strong><small>{document.charCount.toLocaleString()}자{document.pageCount ? ` · ${document.pageCount}페이지` : ''}</small></div>
              <span class="success">완료</span>
            </div>
            {#if document.warnings.length}<ul class="warnings">{#each document.warnings as warning (warning)}<li>{warning}</li>{/each}</ul>{/if}
            <label class="replace">다른 문서 선택<input type="file" accept=".pdf,.docx,.hwpx,.xlsx,.txt,.md,.csv" onchange={(event) => selectFile(event, panel.kind)} /></label>
          {:else}
            <label class="compact-drop">
              <span class="drop-icon" aria-hidden="true">{panel.icon}</span>
              <span><strong>{$grcStore.uploading === panel.kind ? '문서를 분석하고 있습니다…' : '파일을 놓거나 선택'}</strong><small>PDF · DOCX · HWPX · XLSX · TXT</small></span>
              <input type="file" accept=".pdf,.docx,.hwpx,.xlsx,.txt,.md,.csv" disabled={Boolean($grcStore.uploading)} onchange={(event) => selectFile(event, panel.kind)} />
            </label>
          {/if}
        </section>
      {/each}

      <section class="control-step execution-step" class:complete={Boolean($grcStore.review?.status === 'completed')}>
        <div class="step-heading">
          <span class="step">03</span>
          <div><h2>검토 실행</h2><p>모델과 제목을 확인하세요.</p></div>
        </div>
        <label class="field-label">AI 모델
          <select value={$grcStore.model} onchange={(event) => setModel(event.currentTarget.value)} disabled={running($grcStore.review?.status) || !$grcStore.serverReady}>
            {#each $grcStore.models as model (model.name)}<option value={model.name}>{model.name}</option>{/each}
          </select>
        </label>
        <label class="field-label">검토 제목
          <input bind:value={title} placeholder={$grcStore.target ? `${$grcStore.target.filename} 내부검토` : '문서 준비 후 자동 입력'} disabled={running($grcStore.review?.status)} />
        </label>
        <button class="primary run-button" disabled={!$grcStore.policy || !$grcStore.target || running($grcStore.review?.status)} onclick={() => startReview(title)}>
          <span aria-hidden="true">⌕</span> 근거 기반 검토 실행
        </button>
      </section>
    </div>

    {#if $grcStore.review && running($grcStore.review.status)}
      <section class="current-job" aria-live="polite">
        <div><span class="pulse" aria-hidden="true"></span><strong>{statusLabel($grcStore.review.status)} 중</strong></div>
        <p>{$grcStore.review.processedClauses} / {$grcStore.review.totalClauses || '?'}개 조항 · {$grcStore.review.progress}%</p>
        <button class="text-button danger" onclick={cancelCurrentReview}>검토 취소</button>
      </section>
    {/if}
  </aside>

  <section class="review-main" aria-label="검토 결과 작업공간">
    {#if !$grcStore.review}
      <section class="empty-results">
        <div class="empty-visual" aria-hidden="true"><span>§</span><i></i><span>▤</span></div>
        <p class="eyebrow">EVIDENCE-BASED REVIEW</p>
        <h1>검토 결과가 표시될 공간입니다.</h1>
        <p class="empty-description">왼쪽에서 기준 문서와 검토 대상을 준비하면 조항별 판정과 양측 원문 근거를 한 화면에서 확인할 수 있습니다.</p>
        <ol class="workflow-guide">
          <li><span>1</span><div><strong>두 문서 준비</strong><small>기준과 대상을 구분해 업로드</small></div></li>
          <li><span>2</span><div><strong>근거 기반 분석</strong><small>모든 기준 조항을 빠짐없이 대조</small></div></li>
          <li><span>3</span><div><strong>결과 확인</strong><small>판정·근거·권고 조치를 함께 검토</small></div></li>
        </ol>
        <div class="privacy-note"><span aria-hidden="true">⌂</span><p><strong>로컬에서 안전하게 처리됩니다.</strong><small>문서는 외부 클라우드 LLM으로 전송되지 않습니다.</small></p></div>
      </section>
    {:else if running($grcStore.review.status)}
      <section class="review-state running-state" aria-live="polite">
        <div class="state-heading"><div><p class="eyebrow">REVIEW IN PROGRESS</p><h1>조항별 근거를 대조하고 있습니다.</h1><p>현재 조항의 판정과 인용 근거를 검증한 뒤 다음 조항으로 이동합니다.</p></div><strong>{$grcStore.review.progress}%</strong></div>
        <div class="main-progress"><i style={`width:${$grcStore.review.progress}%`}></i></div>
        <div class="progress-meta"><span>{statusLabel($grcStore.review.status)}</span><span>{$grcStore.review.processedClauses} / {$grcStore.review.totalClauses || '?'}개 기준 조항</span></div>
        <ol class="processing-steps">
          {#each [{ label: '검토 준비', description: '모델과 문서 상태 확인' }, { label: '문서 분석', description: '조항 구조와 검색 색인 확인' }, { label: '조항 검토', description: '대상 후보 검색·판정·근거 검증' }, { label: '결과 정리', description: '중복 병합과 종합 위험도 계산' }] as item, index (item.label)}
            <li class:active={stageIndex($grcStore.review.status) === index} class:done={stageIndex($grcStore.review.status) > index}>
              <span>{stageIndex($grcStore.review.status) > index ? '✓' : index + 1}</span><div><strong>{item.label}</strong><small>{item.description}</small></div>
            </li>
          {/each}
        </ol>
        <div class="waiting-card"><span class="spinner" aria-hidden="true"></span><div><strong>결과를 안전하게 검증 중입니다.</strong><p>근거가 원문과 일치하지 않으면 자동으로 한 번 더 확인합니다.</p></div></div>
      </section>
    {:else if $grcStore.review.status === 'failed'}
      <section class="review-state message-state failed-state" role="alert">
        <span class="state-icon" aria-hidden="true">!</span>
        <p class="eyebrow">REVIEW STOPPED</p>
        <h1>검토를 완료하지 못했습니다.</h1>
        <p>{$grcStore.review.errorMessage}</p>
        <div class="next-action"><strong>다음 단계</strong><span>왼쪽의 문서와 모델을 확인한 뒤 검토를 다시 실행하세요. 실패 기록은 검토 이력에 보관됩니다.</span></div>
      </section>
    {:else if $grcStore.review.status === 'cancelled'}
      <section class="review-state message-state cancelled-state">
        <span class="state-icon" aria-hidden="true">×</span>
        <p class="eyebrow">REVIEW CANCELLED</p>
        <h1>검토가 취소되었습니다.</h1>
        <p>업로드한 문서는 유지됩니다. 준비가 되면 왼쪽에서 다시 검토를 실행하세요.</p>
      </section>
    {:else if $grcStore.review.status === 'completed'}
      <section class="results" aria-label="검토 결과">
        <div class="result-heading"><div><p class="eyebrow">REVIEW COMPLETE</p><h1>검토 결과</h1></div><div class={`risk risk-${$grcStore.review.overallRisk?.toLowerCase()}`}><small>종합 위험도</small><strong>{riskLabel($grcStore.review.overallRisk)}</strong></div></div>
        <div class="summary-card"><p>{$grcStore.review.summary}</p><span>검토 커버리지 {Math.round(($grcStore.review.coverageRate ?? 0) * 100)}%</span></div>
        <div class="kpi-grid">
          {#each [['충돌 가능성', 'high'], ['일부 보완 필요', 'medium'], ['적합', 'low'], ['확인 불가', 'info']] as item (item[0])}
            <button class={`kpi ${item[1]}`} onclick={() => statusFilter = item[0]}><strong>{$grcStore.findings.filter((finding) => finding.status === item[0]).length}</strong><span>{item[0]}</span></button>
          {/each}
        </div>

        <div class="section-title"><div><h2>쟁점별 판단 매트릭스</h2><p>항목을 선택하면 양측 원문 근거를 확인할 수 있습니다.</p></div><select bind:value={statusFilter} aria-label="판정 필터"><option>전체</option><option>충돌 가능성</option><option>일부 보완 필요</option><option>적합</option><option>확인 불가</option></select></div>
        <div class="findings-table" role="table">
          <div class="table-head" role="row"><span>검토 항목</span><span>판정</span><span>검토 의견</span><span>조치</span></div>
          {#each filteredFindings() as finding (finding.id)}
            <button class="finding-row" role="row" onclick={() => openFinding(finding)}>
              <span><strong>{finding.ruleTitle}</strong><small>{finding.severity} · 신뢰도 {Math.round(finding.confidence * 100)}%</small></span>
              <span><i class={`badge status-${finding.status}`}>{finding.status}</i></span>
              <span>{finding.reason}</span><span>{finding.remediation}</span>
            </button>
          {/each}
        </div>

        {#if ($grcStore.review.missingInformation?.length ?? 0) > 0}
          <section class="missing"><h2>추가 확인 필요 자료</h2><ul>{#each $grcStore.review.missingInformation ?? [] as item (item)}<li>{item}</li>{/each}</ul></section>
        {/if}

        <section class="opinion">
          <div class="section-title"><div><h2>검토 의견서</h2><p>담당자의 최종 검토 후 사용하세요.</p></div><div><button class="ghost" onclick={copyOpinion}>복사</button><a class="primary small" href={`/api/reviews/${$grcStore.review.id}/report.pdf`}>PDF 다운로드</a></div></div>
          <article class="markdown">{@html safeMarkdown($grcStore.review.draftOpinion)}</article>
        </section>
      </section>
    {/if}
  </section>
</main>

{#if historyOpen}
  <div class="drawer-backdrop" role="presentation" onclick={() => historyOpen = false}></div>
  <aside class="drawer" aria-label="검토 이력">
    <div class="drawer-head"><div><h2>검토 이력</h2><p>로컬에 저장된 검토 결과</p></div><button class="icon-button" aria-label="닫기" onclick={() => historyOpen = false}>×</button></div>
    <div class="history-list">
      {#each $grcStore.history as item (item.id)}
        <article class="history-item">
          <button class="history-open" onclick={async () => { await loadReview(item.id); historyOpen = false; }}>
            <span class={`history-risk risk-${item.overallRisk?.toLowerCase()}`}></span><div><strong>{item.title}</strong><small>{item.targetDocName} · {new Date(item.createdAt).toLocaleString('ko-KR')}</small></div><i>{statusLabel(item.status)}</i>
          </button>
          <button class="delete" aria-label={`${item.title} 삭제`} onclick={() => removeReview(item.id)}>삭제</button>
        </article>
      {:else}<p class="empty">저장된 검토 이력이 없습니다.</p>{/each}
    </div>
  </aside>
{/if}

{#if selectedFinding}
  <div class="drawer-backdrop" role="presentation" onclick={() => selectedFinding = undefined}></div>
  <aside class="drawer evidence-drawer" aria-label="판정 근거">
    <div class="drawer-head"><div><span class={`badge status-${selectedFinding.status}`}>{selectedFinding.status}</span><h2>{selectedFinding.ruleTitle}</h2></div><button class="icon-button" aria-label="닫기" onclick={() => selectedFinding = undefined}>×</button></div>
    <div class="evidence-body"><h3>판단</h3><p>{selectedFinding.reason}</p><h3>권고 조치</h3><p>{selectedFinding.remediation}</p>
      <h3>기준 문서 근거</h3>{#each selectedFinding.policyEvidence as evidence (`${evidence.clauseId}-${evidence.startOffset}`)}<blockquote><small>{evidence.clauseTitle}{evidence.page ? ` · ${evidence.page}페이지` : ''}</small>{evidence.excerpt}</blockquote>{/each}
      <h3>대상 문서 근거</h3>{#each selectedFinding.targetEvidence as evidence (`${evidence.clauseId}-${evidence.startOffset}`)}<blockquote><small>{evidence.clauseTitle}{evidence.page ? ` · ${evidence.page}페이지` : ''}</small>{evidence.excerpt}</blockquote>{:else}<p class="muted">확인 가능한 대상 문서 근거가 없습니다.</p>{/each}
      {#if selectedFinding.requiresHumanReview}<div class="human-review">담당자의 추가 확인이 필요한 항목입니다.</div>{/if}
    </div>
  </aside>
{/if}
