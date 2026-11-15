/* /myarticle 콘솔에서 실행. 붙여넣기만 하면 미리보기만 표시됩니다.
 * await everytimeDelete.start(1) — 첫 1개
 * await everytimeDelete.start(everytimeDelete.count) — 남은 대상
 * await everytimeDelete.startAll() — 다음 페이지 분량까지 전체 삭제
 * everytimeDelete.stop() — 중지
 */
(() => {
  'use strict';
  if (location.origin !== 'https://everytime.kr' || location.pathname.replace(/\/$/, '') !== '/myarticle')
    throw new Error('내 글 목록 페이지에서 실행하세요.');
  if (window.everytimeDelete?.running) throw new Error('이미 실행 중입니다. 중지 후 새로고침하세요.');
  // 사용자가 확인한 내 글 영역만 사용합니다. 다른 영역으로 검색을 넓히지 않습니다.
  const ROOT = '#container.article > div.wrap.articles';
  const LINKS = `${ROOT} > article.list > a.article[href]`;
  const listURL = location.href, origin = location.origin;
  function collect(doc) {
    const seen = new Set();
    return [...doc.querySelectorAll(LINKS)].flatMap(a => {
      const u = new URL(a.getAttribute('href'), origin);
      const path = u.pathname.replace(/\/$/, '');
      if (u.origin !== origin || !/^\/\d+\/v\/\d+$/.test(path) || seen.has(path) || !a.getClientRects().length) return [];
      seen.add(path);
      return [{ path, title: a.textContent.trim().replace(/\s+/g, ' ').slice(0, 100) }];
    });
  }
  const targets = collect(document), done = new Set();
  let running = false, stopped = false, blocked = false, panel;
  const pending = () => targets.filter(t => !done.has(t.path));
  const table = rows => console.table(rows.map((t, i) => ({ 번호: i + 1, 미리보기: t.title, 링크: origin + t.path })));
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = () => { if (stopped) throw new Error('사용자가 중지했습니다.'); };
  async function waitFor(test, message) {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      check();
      const value = test();
      if (value) return value;
      await pause(250);
    }
    throw new Error(message);
  }
  function preview() { table(pending()); console.log(`현재 페이지의 남은 대상: ${pending().length}개`); }
  async function start(limit = 1, allPages = false) {
    if (running) throw new Error('이미 실행 중입니다.');
    if (blocked) throw new Error('이전 실행이 중단되었습니다. 새로고침하고 코드를 다시 붙여넣으세요.');
    if (location.href !== listURL) throw new Error('목록 페이지가 바뀌었습니다. 코드를 다시 붙여넣으세요.');
    const remaining = pending();
    if (!allPages && (!Number.isSafeInteger(limit) || limit < 1 || limit > remaining.length)) throw new Error(`1~${remaining.length}개를 지정하세요.`);
    const runListURL = allPages ? origin + '/myarticle' : listURL;
    let queue = remaining.slice(0, allPages ? remaining.length : limit);
    table(queue);
    const phrase = allPages ? '내 글 전체 삭제' : `삭제 ${limit}`;
    const message = allPages
      ? '첫 페이지부터 내 글 전체를 순차 삭제합니다. 다음 페이지 분량도 포함합니다.\n위 미리보기는 현재 페이지 일부이며 전체 목록이 아닙니다. 복구가 어려울 수 있습니다.'
      : `위 ${limit}개 글을 삭제합니다. 복구가 어려울 수 있습니다.`;
    if (prompt(`${message}\n실행하려면 "${phrase}"를 입력하세요.`) !== phrase) return;
    running = true; stopped = false;
    panel?.remove();
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;right:12px;bottom:12px;width:420px;max-width:90vw;z-index:2147483647;background:white;border:2px solid #c62917;padding:12px;color:#222';
    const status = document.createElement('div'), button = document.createElement('button'), frame = document.createElement('iframe');
    button.textContent = '중지';
    button.onclick = () => { stopped = true; status.textContent = '중지 요청됨. 이미 전송된 요청은 취소되지 않습니다.'; };
    frame.title = '삭제 대상 확인';
    frame.style.cssText = 'width:100%;height:260px;border:0;margin-top:8px';
    panel.append(status, button, frame); document.body.append(panel);
    let inFlight = null, verified = 0, errorText = '';
    function frameDoc() {
      try {
        const doc = frame.contentDocument;
        if (!doc?.body || frame.contentWindow.location.origin !== origin) throw new Error();
        return doc;
      } catch { throw new Error('페이지 접근이 차단되었거나 로그인이 필요합니다.'); }
    }
    async function navigate(url) {
      check();
      await new Promise((resolve, reject) => {
        let timer;
        const clean = () => { clearTimeout(timer); frame.onload = null; frame.onerror = null; };
        frame.onload = () => { clean(); resolve(); };
        frame.onerror = () => { clean(); reject(new Error('페이지 로딩 실패')); };
        timer = setTimeout(() => { clean(); reject(new Error('페이지 로딩 시간 초과')); }, 20000);
        frame.src = url;
      });
      check(); frameDoc();
    }
    async function readList() {
      await navigate(runListURL);
      // 로딩 중 링크가 없다는 이유만으로 삭제 성공으로 판단하지 않습니다.
      return waitFor(() => {
        const doc = frameDoc();
        if (frame.contentWindow.location.pathname.replace(/\/$/, '') !== '/myarticle') throw new Error('내 글 목록과 다른 페이지가 열렸습니다.');
        const roots = doc.querySelectorAll(ROOT);
        if (roots.length !== 1) return null;
        const rows = collect(doc);
        const ids = new Map(rows.map(t => [t.path, t]));
        // 전체 삭제에서는 다음 페이지에서 당겨진 새 글도 로딩 완료의 근거가 됩니다.
        const witness = allPages ? ids.size > 0 : targets.some(t => !done.has(t.path) && ids.has(t.path));
        const empty = ids.size === 0 && /(?:작성한|등록된|작성된)\s*(?:게시글|게시물|글)(?:이|은)?\s*없/.test(roots[0].textContent);
        return witness || empty ? ids : null;
      }, '목록 로딩 또는 빈 목록 안내를 확인하지 못했습니다. 직접 새로고침해 확인하세요.');
    }
    try {
      status.textContent = '내 글 목록 다시 확인 중';
      const before = await readList();
      if (allPages) queue = [...before.values()];
      if (queue.some(t => !before.has(t.path))) throw new Error('미리보기와 현재 내 글 목록이 다릅니다. 새로고침 후 다시 실행하세요.');
      while (queue.length) {
        check();
        const target = queue.shift();
        if (done.has(target.path)) throw new Error('이미 삭제 확인한 글이 목록에 다시 나타났습니다. 새로고침 후 확인하세요.');
        if (!targets.some(t => t.path === target.path)) targets.push(target);
        status.textContent = `${verified + 1}${allPages ? '번째' : '/' + limit} 처리 중: ${target.title}`;
        await navigate(origin + target.path);
        const del = await waitFor(() => {
          const doc = frameDoc();
          if (frame.contentWindow.location.pathname.replace(/\/$/, '') !== target.path) throw new Error('요청한 글과 다른 페이지가 열렸습니다.');
          const matches = [...doc.querySelectorAll('article.item > a.article > ul.status > li.del')].filter(el =>
            el.getClientRects().length && el.textContent.trim() === '삭제' &&
            [...el.parentElement.querySelectorAll('li.update')].some(u => u.getClientRects().length && u.textContent.trim() === '수정'));
          if (matches.length > 1) throw new Error('본문 삭제 버튼이 여러 개입니다.');
          return matches[0];
        }, '본문의 수정·삭제 버튼을 찾지 못했습니다.');
        const win = frame.contentWindow, doc = frameDoc(), originalConfirm = win.confirm;
        let unexpected = null;
        // 이 글의 삭제 처리 중에만 삭제 확인창에 응답합니다.
        win.confirm = message => {
          const text = String(message);
          if (!stopped && win.document === doc && win.location.pathname.replace(/\/$/, '') === target.path && /삭제/.test(text) && !/댓글|답글|계정|탈퇴/.test(text)) return true;
          unexpected = text; return false;
        };
        try {
          check(); inFlight = target.path; del.click();
          await waitFor(() => {
            if (unexpected !== null) throw new Error(`예상하지 못한 확인창: ${unexpected}`);
            return win.location.pathname.replace(/\/$/, '') !== target.path || !del.isConnected;
          }, '삭제 후 화면 변화를 확인하지 못했습니다.');
        } finally {
          try { if (win.document === doc) win.confirm = originalConfirm; } catch { /* 다른 출처에 접근하지 않음 */ }
        }
        await pause(1500);
        const after = await readList();
        if (after.has(target.path)) throw new Error('삭제 대상이 내 글 목록에 남아 있습니다.');
        done.add(target.path); verified++; inFlight = null;
        // 삭제할 때마다 첫 페이지를 다시 읽습니다. 페이지 번호를 올리면
        // 앞으로 당겨진 글을 건너뛰게 되므로 새 첫 페이지를 다음 대상으로 사용합니다.
        if (allPages) queue = [...after.values()];
        console.log(`[내 글 목록에서 사라짐 확인] ${target.path}`);
        await pause(1500);
      }
    } catch (error) {
      blocked = true; errorText = error.message || String(error);
      console.error('중지:', errorText);
      if (inFlight) console.warn(`삭제 요청을 시도했으나 결과를 확인하지 못한 글: ${origin}${inFlight}`);
    } finally {
      running = false; frame.remove();
      status.textContent = `종료: 이번 실행 ${verified}${allPages ? "" : "/" + limit}개 목록에서 사라짐 확인. ${errorText}`;
      if (allPages && !errorText) status.textContent += ' 내 글 목록이 비어 있음을 확인했습니다.';
      if (inFlight) status.textContent += ' 마지막 글의 삭제 여부를 직접 확인하세요.';
      button.textContent = '닫기'; button.onclick = () => panel.remove();
      console.log(status.textContent);
    }
  }
  window.everytimeDelete = Object.freeze({ start: (limit = 1) => start(limit, false), startAll: () => start(0, true), preview, stop() { stopped = true; }, get count() { return pending().length; }, get running() { return running; } });
  preview();
  console.log('전체 페이지 자동 삭제: await everytimeDelete.startAll()');
  console.log('첫 1개: await everytimeDelete.start(1)');
  console.log('남은 대상: await everytimeDelete.start(everytimeDelete.count)');
})();
