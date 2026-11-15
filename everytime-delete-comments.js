/* 에브리타임 내 댓글 삭제
 * /mycommentarticle에서 붙여넣기: 댓글을 단 글 목록 미리보기만 표시
 * await everytimeCommentDelete.start(1): 내 댓글 1개 삭제
 * await everytimeCommentDelete.startAll(): 모든 페이지 분량의 내 댓글 삭제
 * everytimeCommentDelete.stop(): 중지 (이미 보낸 요청은 취소되지 않음)
 */
(() => {
  'use strict';
  const origin = 'https://everytime.kr';
  if (location.origin !== origin || location.pathname.replace(/\/$/, '') !== '/mycommentarticle')
    throw new Error('내가 댓글 단 글 목록에서 실행하세요.');
  if (window.everytimeCommentDelete?.running || window.everytimeDelete?.running)
    throw new Error('다른 삭제 실행을 중지한 뒤 새로고침하세요.');
  const ROOT = '#container.article > div.wrap.articles';
  const LINKS = `${ROOT} > article.list > a.article[href]`;
  const COMMENTS = `${ROOT} > article.item > div.comments`;
  // 게시글 삭제 버튼은 a.article 안에 있으므로 이 선택자에 포함되지 않습니다.
  // parent/child 클래스와 무관하게 댓글 영역의 직계 댓글 행만 처리합니다.
  const DELETE = `${COMMENTS} > article > ul.status > li.del`;
  const initialURL = location.href;
  function collect(doc) {
    const seen = new Set();
    return [...doc.querySelectorAll(LINKS)].flatMap(a => {
      const url = new URL(a.getAttribute('href'), origin);
      const path = url.pathname.replace(/\/$/, '');
      if (url.origin !== origin || !/^\/\d+\/v\/\d+$/.test(path) || seen.has(path) || !a.getClientRects().length) return [];
      seen.add(path);
      return [{ path, title: a.textContent.trim().replace(/\s+/g, ' ').slice(0, 100) }];
    });
  }
  const initial = collect(document);
  let running = false, stopped = false, blocked = false, panel;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = () => { if (stopped) throw new Error('사용자가 중지했습니다.'); };
  async function waitFor(test, message) {
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      check();
      const result = test();
      if (result) return result;
      await pause(250);
    }
    throw new Error(message);
  }
  function preview() {
    console.table(initial.map((t, i) => ({ 번호: i + 1, 댓글을_단_글: t.title, 링크: origin + t.path })));
    console.log(`${initial.length}개 게시글이 보입니다. 게시글 수이며 댓글 수는 아닙니다. 삭제는 실행하지 않았습니다.`);
  }
  async function run(limit, allPages) {
    if (running || window.everytimeDelete?.running) throw new Error('이미 삭제 실행 중입니다.');
    if (blocked) throw new Error('이전 실행이 중단되었습니다. 새로고침하고 코드를 다시 붙여넣으세요.');
    if (location.href !== initialURL) throw new Error('페이지가 바뀌었습니다. 코드를 다시 붙여넣으세요.');
    if (!allPages && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('삭제할 댓글 개수는 양의 정수여야 합니다.');
    const phrase = allPages ? '내 댓글 전체 삭제' : `댓글 ${limit}개 삭제`;
    const scope = allPages ? '첫 페이지부터 다음 페이지 분량까지 본인 댓글을 모두 삭제합니다.' : `현재 목록에서 시작해 본인 댓글을 최대 ${limit}개 삭제합니다.`;
    if (prompt(`${scope}\n게시글은 삭제하지 않습니다. 삭제한 댓글은 복구가 어려울 수 있습니다.\n실행하려면 "${phrase}"를 입력하세요.`) !== phrase) return;
    running = true; stopped = false;
    panel?.remove();
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;right:12px;bottom:12px;width:420px;max-width:90vw;z-index:2147483647;background:white;color:#222;border:2px solid #c62917;padding:12px';
    const status = document.createElement('div'), stop = document.createElement('button'), frame = document.createElement('iframe');
    stop.textContent = '중지';
    stop.onclick = () => { stopped = true; status.textContent = '중지 요청됨. 이미 전송된 요청은 취소되지 않습니다.'; };
    frame.title = '내 댓글 삭제 진행';
    frame.style.cssText = 'width:100%;height:260px;border:0;margin-top:8px';
    panel.append(status, stop, frame); document.body.append(panel);
    const listURL = allPages ? origin + '/mycommentarticle' : initialURL;
    const finishedPosts = new Set();
    let verified = 0, finished = false, uncertain = null, errorText = '';
    function doc() {
      try {
        const d = frame.contentDocument;
        if (!d?.body || frame.contentWindow.location.origin !== origin) throw new Error();
        return d;
      } catch { throw new Error('페이지에 접근할 수 없습니다. 로그인 또는 iframe 차단 여부를 확인하세요.'); }
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
      check(); doc();
    }
    async function readList() {
      await navigate(listURL);
      return waitFor(() => {
        const d = doc();
        if (frame.contentWindow.location.pathname.replace(/\/$/, '') !== '/mycommentarticle') throw new Error('댓글 목록과 다른 페이지가 열렸습니다.');
        const roots = d.querySelectorAll(ROOT);
        if (roots.length !== 1) return null;
        const rows = collect(d);
        if (rows.length) return rows;
        const text = roots[0].textContent.replace(/\s+/g, ' ');
        // 단순히 링크가 없는 로딩 화면을 완료로 판단하지 않습니다.
        if (/(?:댓글|답글)[^.\n]{0,60}(?:없습니다|없어요)|(?:작성한|등록된|작성된)\s*(?:게시글|게시물|글)(?:이|은)?\s*없/.test(text)) return [];
        return null;
      }, '댓글 목록의 로딩 완료 또는 빈 목록 안내를 확인하지 못했습니다. 새로고침해 확인하세요.');
    }
    function ownButtons(d) {
      return [...d.querySelectorAll(DELETE)].filter(el => el.getClientRects().length && el.textContent.trim() === '삭제');
    }
    async function openComments(target) {
      await navigate(origin + target.path);
      await waitFor(() => {
        const d = doc();
        if (frame.contentWindow.location.pathname.replace(/\/$/, '') !== target.path) throw new Error('요청한 글과 다른 페이지가 열렸습니다.');
        return d.querySelectorAll(COMMENTS).length === 1 && ownButtons(d).length > 0;
      }, '본인 댓글의 삭제 버튼을 찾지 못했습니다. 댓글 더보기나 페이지 이동이 필요한 경우 직접 확인하세요.');
      await pause(1000);
      check();
      const buttons = ownButtons(doc());
      if (!buttons.length) throw new Error('댓글 삭제 버튼이 사라졌습니다.');
      return buttons;
    }
    async function clickDelete(button, target) {
      const win = frame.contentWindow, d = doc(), originalConfirm = win.confirm;
      let unexpected = null;
      win.confirm = message => {
        const text = String(message);
        if (!stopped && win.document === d && win.location.pathname.replace(/\/$/, '') === target.path && /삭제/.test(text) && !/게시글|게시물|계정|탈퇴/.test(text)) return true;
        unexpected = text; return false;
      };
      try {
        check(); uncertain = target.path; button.click();
        await waitFor(() => {
          if (unexpected !== null) throw new Error(`예상하지 못한 확인창: ${unexpected}`);
          return !button.isConnected || !ownButtons(doc()).includes(button) || win.location.pathname.replace(/\/$/, '') !== target.path;
        }, '댓글 삭제 후 화면 변화를 확인하지 못했습니다.');
      } finally {
        try { if (win.document === d) win.confirm = originalConfirm; } catch { /* 다른 출처에 접근하지 않음 */ }
      }
    }
    try {
      status.textContent = '내가 댓글 단 글 목록 확인 중';
      let rows = await readList();
      // 단일/제한 개수 실행은 미리보기에 있던 글에서 시작합니다.
      if (!allPages && rows.length && !initial.some(t => t.path === rows[0].path)) throw new Error('미리보기와 목록이 달라졌습니다. 새로고침 후 실행하세요.');
      while (rows.length && (allPages || verified < limit)) {
        check();
        const target = rows[0];
        if (finishedPosts.has(target.path)) throw new Error('처리가 끝난 글이 목록에 다시 나타났습니다.');
        let buttons = await openComments(target);
        while (allPages || verified < limit) {
          check();
          status.textContent = `댓글 ${verified + 1}개째 처리 중 — ${target.title}`;
          const beforeCount = buttons.length;
          await clickDelete(buttons[0], target);
          await pause(1500);
          rows = await readList();
          const remains = rows.some(t => t.path === target.path);
          if (remains) {
            // 같은 글에 여러 댓글이 있으면 실제 삭제 버튼 수가 줄었는지 재확인합니다.
            buttons = await openComments(target);
            if (buttons.length !== beforeCount - 1) throw new Error('댓글 수가 예상대로 줄지 않았습니다. 추가 삭제 없이 중지합니다.');
          } else {
            // 화면에 보였던 내 댓글이 여러 개라면 목록에서 글이 사라지는 것은 예상 밖입니다.
            if (beforeCount !== 1) throw new Error('내 댓글이 여러 개였지만 글이 목록에서 사라졌습니다. 직접 확인하세요.');
            finishedPosts.add(target.path);
          }
          verified++; uncertain = null;
          console.log(`[댓글 삭제 확인 ${verified}개] ${origin}${target.path}`);
          await pause(1500);
          if (!remains) break;
        }
        // 목록 페이지 번호를 올리면 삭제로 앞으로 당겨진 글을 건너뛸 수 있으므로
        // 방금 다시 읽은 첫 페이지를 계속 처리합니다.
      }
      finished = rows.length === 0;
    } catch (error) {
      blocked = true; errorText = error.message || String(error);
      console.error('중지:', errorText);
      if (uncertain) console.warn(`댓글 삭제 결과를 직접 확인할 글: ${origin}${uncertain}`);
    } finally {
      running = false; frame.remove();
      status.textContent = `종료: 댓글 ${verified}개 삭제 확인. ${errorText}`;
      if (finished) status.textContent += ' 댓글을 단 글 목록이 비어 있음을 확인했습니다.';
      if (uncertain) status.textContent += ' 마지막 댓글의 삭제 여부를 직접 확인하세요.';
      stop.textContent = '닫기'; stop.onclick = () => panel.remove();
      console.log(status.textContent);
    }
  }
  window.everytimeCommentDelete = Object.freeze({
    preview, start: (limit = 1) => run(limit, false), startAll: () => run(Infinity, true),
    stop() { stopped = true; }, get running() { return running; }
  });
  preview();
  console.log('내 댓글 1개: await everytimeCommentDelete.start(1)');
  console.log('전체 페이지의 내 댓글: await everytimeCommentDelete.startAll()');
})();
