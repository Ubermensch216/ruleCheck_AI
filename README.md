# GRC Compliance Reviewer

기준 문서와 검토 대상 문서를 로컬 Ollama 모델로 비교하고, 원문 근거가 포함된 내부 규정 적합성 검토 결과와 PDF 보고서를 생성하는 단일 사용자용 웹 애플리케이션입니다.

## 요구 사항

- Node.js 22.13 이상(권장: 현재 LTS 또는 Node.js 24)
- npm 11 이상
- Ollama 0.32 이상
- Ollama 모델 `gemma4:e2b`
- PDF용 한글 폰트: Windows에서는 맑은 고딕을 자동 사용합니다.

```powershell
ollama pull gemma4:e2b
npm install
Copy-Item .env.example .env
npm run dev
```

브라우저에서 `http://127.0.0.1:5173`을 엽니다. API는 개발 중 `http://127.0.0.1:3000`에서 실행됩니다.

프로덕션 빌드:

```powershell
npm run build
npm start
```

프로덕션 화면은 `http://127.0.0.1:3000`에서 제공됩니다.

## 지원 문서

- 텍스트 PDF
- DOCX
- HWPX
- XLSX
- UTF-8 TXT, Markdown, CSV

스캔 PDF는 텍스트 밀도를 기준으로 감지하며 v1에서는 OCR을 수행하지 않습니다. OCR 처리한 PDF를 다시 업로드해야 합니다. 레거시 HWP는 지원하지 않습니다.

## 데이터와 보안

- 기본 서버 주소는 `127.0.0.1`이며 외부 네트워크에 노출하지 않습니다.
- 원본 파일은 `data/documents/{documentId}`에, 추출 텍스트와 검토 결과는 `data/grc.sqlite`에 저장됩니다.
- 검토 이력을 삭제하면 다른 검토가 참조하지 않는 원본 문서도 함께 영구 삭제됩니다.
- 문서 본문, 프롬프트, 근거 문장은 서버 로그에 기록하지 않습니다.
- 암호화 PDF, 형식 위장 파일, 과도한 압축 파일, 30MB 초과 파일은 거부합니다.
- 보고서는 AI 초안이며 담당자의 최종 확인과 승인이 필요합니다.

## Docker

Ollama가 호스트에서 실행 중일 때:

```powershell
docker compose up --build
```

`compose.yaml`은 호스트 Ollama를 `host.docker.internal:11434`로 연결하고 애플리케이션은 `127.0.0.1:3100`에만 공개합니다. Ollama가 컨테이너 요청을 받을 수 있도록 Ollama의 허용 호스트 설정이 필요할 수 있습니다.

## 검증 명령

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Playwright 브라우저가 없다면 최초 1회 `npx playwright install chromium`이 필요합니다.

## 주요 API

- `GET /api/health`, `GET /api/models`
- `POST /api/documents`, `GET /api/documents/:id`
- `POST /api/reviews`, `GET /api/reviews`, `GET /api/reviews/:id`
- `GET /api/reviews/:id/events`, `POST /api/reviews/:id/cancel`
- `GET /api/reviews/:id/report.pdf`, `DELETE /api/reviews/:id`

## 장애 확인

- `MODEL_NOT_INSTALLED`: 선택한 모델을 `ollama pull`로 설치합니다.
- `OLLAMA_UNAVAILABLE`: Ollama 실행 여부와 `OLLAMA_URL`을 확인합니다.
- `OCR_REQUIRED`: 스캔 PDF를 OCR 처리한 뒤 재업로드합니다.
- `PDF_FONT_MISSING`: `PDF_FONT_PATH`에 사용 허가된 한글 TTF 경로를 지정합니다.
- 서버 재시작으로 중단된 작업은 실패 상태가 되며 새 검토를 실행해야 합니다.
