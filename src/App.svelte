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
  const statusLabel = (status: string) => ({ queued: '대기 중', parsing: '문서 분석', analyzing: '조항 검토', merging: '결과 정리', completed: '완료', failed: '실패', cancelled: '취소됨', deleting: '삭제 중' } as Record<string, string>)[status] ?? status;
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

<svelte:head><meta name="description" content="로컬 AI 기반 내부 규정 적합성 검토 시스템" /></svelte:head>

<header class="topbar">
  <div class="brand">
    <span class="brand-mark" aria-hidden="true">✓</span>
    <div><strong>GRC Compliance Reviewer</strong><small>내부 규정 적합성 검토</small></div>
  </div>
  <div class="header-actions">
    <span class:online={$grcStore.serverReady} class="connection"><i></i>{$grcStore.serverReady ? 'Ollama 연결됨' : '연결 확인 필요'}</span>
    <label class="model-select">모델
      <select value={$grcStore.model} onchange={(event) => setModel(event.currentTarget.value)} disabled={running($grcStore.review?.status)}>
        {#each $grcStore.models as model (model.name)}<option value={model.name}>{model.name}</option>{/each}
      </select>
    </label>
    <button class="ghost" onclick={() => historyOpen = true}>검토 이력 <span class="count">{$grcStore.history.length}</span></button>
    <button class="ghost" onclick={reset}>새 검토</button>
  </div>
</header>

<main>
  <section class="hero">
    <p class="eyebrow">PRIVATE · LOCAL · EVIDENCE-BASED</p>
    <h1>문서 간 규정 충돌을<br /><span>근거와 함께 검토하세요.</span></h1>
    <p>문서는 로컬 환경에서만 처리되며, 모든 판정은 원문 조항과 함께 제공됩니다.</p>
  </section>

  {#if $grcStore.error}
    <div class="alert error" role="alert"><strong>처리할 수 없습니다</strong><span>{$grcStore.error}</span></div>
  {/if}

  <section class="workspace" aria-label="문서 업로드">
    {#each [{ kind: 'policy' as DocumentKind, step: '01', title: '검토 기준', description: '내부 규정·지침·표준 계약서', icon: '§' }, { kind: 'target' as DocumentKind, step: '02', title: '검토 대상', description: '계약서·기획안·업무위탁서', icon: '▤' }] as panel (panel.kind)}
      {@const document = $grcStore[panel.kind]}
      <article class="upload-card" class:has-file={document} ondragover={(event) => event.preventDefault()} ondrop={(event) => drop(event, panel.kind)}>
        <div class="card-heading"><span class="step">{panel.step}</span><div><h2>{panel.title}</h2><p>{panel.description}</p></div></div>
        {#if document}
          <div class="file-summary">
            <span class="file-icon">{panel.icon}</span>
            <div><strong>{document.filename}</strong><small>{document.charCount.toLocaleString()}자{document.pageCount ? ` · ${document.pageCount}페이지` : ''}</small></div>
            <span class="success">파싱 완료</span>
          </div>
          {#if document.warnings.length}<ul class="warnings">{#each document.warnings as warning (warning)}<li>{warning}</li>{/each}</ul>{/if}
          <label class="replace">다른 문서 선택<input type="file" accept=".pdf,.docx,.hwpx,.xlsx,.txt,.md,.csv" onchange={(event) => selectFile(event, panel.kind)} /></label>
        {:else}
          <label class="drop-zone">
            <span class="drop-icon">{panel.icon}</span>
            <strong>{$grcStore.uploading === panel.kind ? '문서를 안전하게 분석하고 있습니다…' : '파일을 놓거나 선택하세요'}</strong>
            <small>PDF · DOCX · HWPX · XLSX · TXT · 최대 30MB</small>
            <input type="file" accept=".pdf,.docx,.hwpx,.xlsx,.txt,.md,.csv" disabled={Boolean($grcStore.uploading)} onchange={(event) => selectFile(event, panel.kind)} />
          </label>
        {/if}
      </article>
    {/each}
  </section>

  <section class="run-panel">
    <label>검토 제목<input bind:value={title} placeholder={$grcStore.target ? `${$grcStore.target.filename} 내부검토` : '두 문서를 먼저 업로드하세요'} disabled={running($grcStore.review?.status)} /></label>
    <button class="primary" disabled={!$grcStore.policy || !$grcStore.target || running($grcStore.review?.status)} onclick={() => startReview(title)}>
      <span aria-hidden="true">⌕</span> 근거 기반 검토 실행
    </button>
  </section>

  {#if $grcStore.review && running($grcStore.review.status)}
    <section class="progress-panel" aria-live="polite">
      <div class="progress-top"><div><span class="spinner"></span><strong>{statusLabel($grcStore.review.status)}</strong><p>{$grcStore.review.processedClauses} / {$grcStore.review.totalClauses || '?'}개 기준 조항 처리</p></div><b>{$grcStore.review.progress}%</b></div>
      <div class="progress-track"><i style={`width:${$grcStore.review.progress}%`}></i></div>
      <button class="text-button danger" onclick={cancelCurrentReview}>검토 취소</button>
    </section>
  {/if}

  {#if $grcStore.review?.status === 'failed'}
    <div class="alert error" role="alert"><strong>검토가 중단되었습니다</strong><span>{$grcStore.review.errorMessage}</span></div>
  {/if}

  {#if $grcStore.review?.status === 'completed'}
    <section class="results" aria-label="검토 결과">
      <div class="result-heading"><div><p class="eyebrow">REVIEW COMPLETE</p><h2>검토 결과</h2></div><div class={`risk risk-${$grcStore.review.overallRisk?.toLowerCase()}`}><small>종합 위험도</small><strong>{riskLabel($grcStore.review.overallRisk)}</strong></div></div>
      <div class="summary-card"><p>{$grcStore.review.summary}</p><span>검토 커버리지 {Math.round(($grcStore.review.coverageRate ?? 0) * 100)}%</span></div>
      <div class="kpi-grid">
        {#each [['충돌 가능성', 'high'], ['일부 보완 필요', 'medium'], ['적합', 'low'], ['확인 불가', 'info']] as item (item[0])}
          <button class={`kpi ${item[1]}`} onclick={() => statusFilter = item[0]}><strong>{$grcStore.findings.filter((finding) => finding.status === item[0]).length}</strong><span>{item[0]}</span></button>
        {/each}
      </div>

      <div class="section-title"><div><h3>쟁점별 판단 매트릭스</h3><p>항목을 선택하면 양측 원문 근거를 확인할 수 있습니다.</p></div><select bind:value={statusFilter} aria-label="판정 필터"><option>전체</option><option>충돌 가능성</option><option>일부 보완 필요</option><option>적합</option><option>확인 불가</option></select></div>
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
        <section class="missing"><h3>추가 확인 필요 자료</h3><ul>{#each $grcStore.review.missingInformation ?? [] as item (item)}<li>{item}</li>{/each}</ul></section>
      {/if}

      <section class="opinion">
        <div class="section-title"><div><h3>검토 의견서</h3><p>담당자의 최종 검토 후 사용하세요.</p></div><div><button class="ghost" onclick={copyOpinion}>복사</button><a class="primary small" href={`/api/reviews/${$grcStore.review.id}/report.pdf`}>PDF 다운로드</a></div></div>
        <article class="markdown">{@html safeMarkdown($grcStore.review.draftOpinion)}</article>
      </section>
    </section>
  {/if}
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
