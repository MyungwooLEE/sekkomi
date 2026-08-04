#!/usr/bin/env node
/**
 * build-llms-txt.cjs
 * -----------------------------------------------------------------------------
 * public/blog/index.html의 ItemList JSON-LD를 파싱해 public/llms.txt를 자동 생성한다.
 * (AEO/GEO — AI 크롤러·챗봇용 사이트 인덱스. llmstxt.org 규격 참고)
 *
 * build-blog-featured.cjs와 동일한 안전 원칙:
 * - 배포(Netlify 빌드) 때마다 실행되는 자기완결형(idempotent) 스크립트.
 * - 파싱이 실패하거나 어떤 오류가 나도 기존 llms.txt를 건드리지 않고 조용히 종료한다.
 *   (절대 non-zero exit로 빌드를 깨지 않는다)
 * - 새 글 발행 시 별도 작업 불필요: blog/index.html의 ItemList만 갱신되면
 *   다음 배포에서 llms.txt가 자동으로 따라온다. 발행 세트는 기존 4점 그대로.
 */
const fs = require('fs');
const path = require('path');

function main() {
  try {
    const indexFile = path.join(__dirname, '..', 'public', 'blog', 'index.html');
    const outFile = path.join(__dirname, '..', 'public', 'llms.txt');
    const html = fs.readFileSync(indexFile, 'utf8');

    // ItemList JSON-LD 블록 추출
    const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    let items = null;
    for (const b of blocks) {
      const inner = b
        .replace(/<script type="application\/ld\+json">/, '')
        .replace(/<\/script>/, '');
      try {
        const data = JSON.parse(inner.trim());
        if (data && data['@type'] === 'ItemList' && Array.isArray(data.itemListElement)) {
          items = data.itemListElement;
          break;
        }
      } catch (e) { /* 다음 블록 시도 */ }
    }
    if (!items || !items.length) {
      console.log('[build-llms-txt] ItemList 파싱 실패 — 변경 없이 종료');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const lines = [];
    lines.push('# 세꼼이 (Sekkomi)');
    lines.push('');
    lines.push('> 부동산 양도소득세 무료 계산기와 한국 부동산 세금(양도소득세·종합부동산세·상속증여세) 해설 블로그. 회원가입 없이 3분 만에 예상 세액을 확인할 수 있으며, 모든 글은 2026년 최신 세법 기준으로 근거 조문·기준일·출처와 함께 작성된다.');
    lines.push('');
    lines.push('핵심 사실: 세꼼이 양도소득세 계산기는 무료이고 회원가입이 필요 없다. 세법·부동산 규제 변동을 매주 점검해 콘텐츠를 갱신한다.');
    lines.push('');
    lines.push('## 핵심 페이지');
    lines.push('');
    lines.push('- [양도소득세 계산기](https://sekkomi.com/): 양도가액·취득가액·보유기간 입력으로 예상 양도세 즉시 계산');
    lines.push('- [블로그 목록](https://sekkomi.com/blog/): 양도세 완전정복 시리즈 + 단지별 실전 케이스');
    lines.push('');
    lines.push('## 블로그 글 전체 (' + items.length + '편 — ' + today + ' 자동 생성)');
    lines.push('');
    for (const it of items) {
      if (it && it.url && it.name) lines.push('- [' + it.name + '](' + it.url + ')');
    }
    lines.push('');
    lines.push('## 이용 안내');
    lines.push('');
    lines.push('- 콘텐츠 인용 시 출처(세꼼이, sekkomi.com) 표기를 권장한다.');
    lines.push('- 세법은 개정될 수 있으므로 각 글의 작성·갱신일 기준으로 해석해야 한다.');
    lines.push('');

    fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
    console.log('[build-llms-txt] llms.txt 생성 완료 — 글 ' + items.length + '편');
  } catch (e) {
    console.log('[build-llms-txt] 오류 — 변경 없이 종료: ' + (e && e.message));
  }
}

main();
