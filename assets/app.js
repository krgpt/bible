/* =========================================================
   성경 검색 웹앱
   데이터: data/meta.js + data/{kor,niv,kjv}.js
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- 기본 상수 ---------------- */
  var MD = window.MD_BIBLE || {};
  var META = MD.meta;
  if (!META) {
    document.getElementById('reader').innerHTML =
      '<div class="loading">데이터를 찾을 수 없습니다.<br>data/meta.js 파일이 같은 폴더 구조에 있는지 확인해 주세요.</div>';
    return;
  }

  var BOOKS = META.books;                 // 66권
  var TRS = META.translations;            // [{id,label,short,lang}]
  var TR_IDS = TRS.map(function (t) { return t.id; });
  var TR_LABEL = {};
  TRS.forEach(function (t) { TR_LABEL[t.id] = t.label; });

  var PAGE = 200;                          // 검색 결과 한 번에 표시할 개수

  /* ---------------- 상태 ---------------- */
  var store = {
    get: function (k, d) {
      try {
        var v = localStorage.getItem('bibleapp.' + k);
        return v === null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem('bibleapp.' + k, JSON.stringify(v)); } catch (e) {}
    }
  };

  var savedTrs = store.get('trs', null);
  var state = {
    trs: [],
    book: 1,
    chapter: 1,
    verse: null,
    loaded: {},          // id -> data
    pending: {},         // id -> Promise
    indexCache: {},      // id -> flat search array
    panelOpen: false,
    result: null,        // {groups, shown, q1, q2, op, scope}
    preview: null,       // {b,c,v} 미리보기 위치
    theme: store.get('theme', 'auto')
  };

  /* 역본 선택 정리 */
  (function () {
    var arr = Array.isArray(savedTrs) ? savedTrs.filter(function (id) { return TR_IDS.indexOf(id) >= 0; }) : [];
    if (!arr.length) arr = ['kor'];
    state.trs = TR_IDS.filter(function (id) { return arr.indexOf(id) >= 0; });
  })();

  state.book = clamp(store.get('book', 1), 1, 66);
  state.chapter = clamp(store.get('chapter', 1), 1, BOOKS[state.book - 1].ch);

  /* ---------------- DOM ---------------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var reader = $('#reader');
  var trToggles = $('#trToggles');
  var bookSel = $('#bookSel');
  var chapSel = $('#chapSel');
  var verseSel = $('#verseSel');
  var prevBtn = $('#prevBtn');
  var nextBtn = $('#nextBtn');
  var copyChapter = $('#copyChapter');
  var panel = $('#panel');
  var scrim = $('#scrim');
  var toastEl = $('#toast');
  var sBook = $('#sBook');
  var sChap = $('#sChap');
  var sVerse = $('#sVerse');
  var backBtn = $('#backBtn');
  var pvWrap = $('#previewWrap');
  var pvBody = $('#pvBody');
  var pvRef = $('#pvRef');
  var pvSub = $('#pvSub');
  var pvGo = $('#pvGo');

  /* ---------------- 유틸 ---------------- */
  function clamp(n, a, b) { n = parseInt(n, 10) || a; return Math.max(a, Math.min(b, n)); }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function highlight(text, terms) {
    var html = esc(text);
    var list = (terms || []).filter(Boolean).map(function (t) { return esc(t); });
    if (!list.length) return html;
    var re = new RegExp('(' + list.map(escRe).join('|') + ')', 'gi');
    return html.replace(re, '<mark>$1</mark>');
  }

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
      setTimeout(function () { toastEl.hidden = true; }, 220);
    }, 1400);
  }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      toast('복사되었습니다');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('복사되었습니다'); }, fallback);
    } else {
      fallback();
    }
  }

  function bookMeta(i) { return BOOKS[i - 1]; }
  function bookLabel(m) { return state.trs[0] === 'kor' ? m.ko : m.en; }
  function bookLabelBoth(m) { return m.ko + ' · ' + m.en; }

  function refLabel(b, c, v) {
    var m = bookMeta(b);
    return m.ko + ' ' + c + ':' + v;
  }

  /* ---------------- 테마 ---------------- */
  function applyTheme(t) {
    state.theme = t;
    store.set('theme', t);
    var root = document.documentElement;
    if (t === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', t);
    }
  }
  applyTheme(state.theme);

  $('#themeBtn').addEventListener('click', function () {
    var isDark = state.theme === 'dark' ||
      (state.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(isDark ? 'light' : 'dark');
  });

  /* ---------------- 데이터 로드 ---------------- */
  function loadTr(id) {
    if (state.loaded[id]) return Promise.resolve(state.loaded[id]);
    if (state.pending[id]) return state.pending[id];

    state.pending[id] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'data/' + id + '.js';
      s.async = true;
      s.onload = function () {
        delete state.pending[id];
        var d = window.MD_BIBLE[id];
        if (!d || !d.b) { reject(new Error(id + ' 데이터 형식 오류')); return; }
        state.loaded[id] = d;
        resolve(d);
      };
      s.onerror = function () {
        delete state.pending[id];
        reject(new Error(id + ' 데이터를 불러오지 못했습니다'));
      };
      document.head.appendChild(s);
    });
    return state.pending[id];
  }

  function bookData(tid, b) {
    var d = state.loaded[tid];
    return d ? d.b[b - 1] : null;
  }

  function chapterArr(tid, b, c) {
    var bk = bookData(tid, b);
    return bk ? (bk.ch[c - 1] || null) : null;
  }

  function verseCount(tid, b, c) {
    var m = bookMeta(b);
    var n = (m.v[tid] && m.v[tid][c - 1]) || 0;
    if (!n) n = (m.v.kjv && m.v.kjv[c - 1]) || 0;
    return n;
  }

  function maxVerse(b, c) {
    var n = 1;
    state.trs.forEach(function (tid) {
      var arr = chapterArr(tid, b, c);
      if (arr) n = Math.max(n, arr.length);
    });
    return Math.max(n, verseCount(state.trs[0], b, c));
  }

  /* ---------------- 역본 토글 ---------------- */
  function renderChips() {
    trToggles.innerHTML = TRS.map(function (t) {
      var on = state.trs.indexOf(t.id) >= 0;
      return '<button class="chip" type="button" data-tr="' + t.id + '" aria-pressed="' + on + '">' +
        esc(t.label) + '</button>';
    }).join('');
  }

  trToggles.addEventListener('click', function (e) {
    var btn = e.target.closest('.chip');
    if (!btn) return;
    var id = btn.getAttribute('data-tr');
    var i = state.trs.indexOf(id);
    if (i >= 0) {
      if (state.trs.length === 1) { toast('최소 한 개의 역본은 필요합니다'); return; }
      state.trs.splice(i, 1);
    } else {
      state.trs.push(id);
      state.trs = TR_IDS.filter(function (x) { return state.trs.indexOf(x) >= 0; });
    }
    store.set('trs', state.trs);
    renderChips();
    fillBookSelect(bookSel);
    fillBookSelect(sBook);
    refresh();
  });

  /* ---------------- 선택 박스 ---------------- */
  function fillBookSelect(sel) {
    sel.innerHTML = BOOKS.map(function (m) {
      return '<option value="' + m.i + '">' + m.i + '. ' + esc(bookLabel(m)) + '</option>';
    }).join('');
    sel.value = String(state.book);
  }

  function fillChapterSelect(sel, b, value) {
    var m = bookMeta(b);
    var opts = [];
    for (var c = 1; c <= m.ch; c++) opts.push('<option value="' + c + '">' + c + '장</option>');
    sel.innerHTML = opts.join('');
    sel.value = String(clamp(value, 1, m.ch));
  }

  function fillVerseSelect(sel, b, c, value) {
    var n = verseCount(state.trs[0], b, c);
    var opts = [];
    for (var v = 1; v <= n; v++) opts.push('<option value="' + v + '">' + v + '절</option>');
    sel.innerHTML = opts.join('');
    sel.value = String(clamp(value || 1, 1, n));
  }

  /* ---------------- 본문 렌더 ---------------- */
  function cellInfo(tid, b, c, v) {
    var bk = bookData(tid, b);
    if (!bk) return { type: 'missing' };
    var arr = bk.ch[c - 1];
    if (!arr) return { type: 'missing' };

    // 이 역본 원본에 본문이 없는 절 ('없음' 표기)
    var na = bk.na && bk.na[String(c)];
    if (na && na.indexOf(v) >= 0) return { type: 'absent' };

    var sp = bk.sp && bk.sp[String(c)];
    if (sp) {
      for (var k in sp) {
        var s = parseInt(k, 10), e = sp[k];
        if (v > s && v <= e) return { type: 'covered', by: s, to: e };
      }
    }
    var txt = arr[v - 1];
    if (txt == null) return { type: 'missing' };
    var to = sp ? sp[String(v)] : null;
    return { type: 'text', text: txt, to: to || null };
  }

  function headingAt(tid, b, c, v) {
    var bk = bookData(tid, b);
    var hd = bk && bk.hd && bk.hd[String(c)];
    return hd ? (hd[String(v)] || null) : null;
  }

  function renderReader() {
    var b = state.book, c = state.chapter;
    var m = bookMeta(b);
    var maxV = maxVerse(b, c);
    var trs = state.trs;

    var html = [];

    html.push('<div class="chapter-head">');
    html.push('<h1>' + esc(bookLabel(m)) + ' ' + c + '장</h1>');
    html.push('<span class="tra">' + esc(bookLabelBoth(m)) + ' · ' + c + ':' + maxV + ' · ' +
      esc(trs.map(function (t) { return TR_LABEL[t]; }).join(' / ')) + '</span>');
    html.push('</div>');

    if (trs.length > 1) {
      html.push('<div class="vhead" style="--cols:' + trs.length + '"><div></div>');
      trs.forEach(function (t) { html.push('<div>' + esc(TR_LABEL[t]) + '</div>'); });
      html.push('</div>');
    }

    var seenHeading = {};

    for (var v = 1; v <= maxV; v++) {
      // 소제목 (개역개정 등 제공 시)
      for (var hi = 0; hi < trs.length; hi++) {
        var h = headingAt(trs[hi], b, c, v);
        if (h && !seenHeading[v + '|' + h]) {
          seenHeading[v + '|' + h] = 1;
          html.push('<div class="section-head">' + esc(h) + '</div>');
        }
      }

      html.push('<div class="vrow" id="v' + v + '" data-v="' + v + '" style="--cols:' + trs.length + '">');
      html.push('<div class="vnum">' + v + '</div>');

      for (var ti = 0; ti < trs.length; ti++) {
        var tid = trs[ti];
        var info = cellInfo(tid, b, c, v);
        html.push('<div class="vcell" data-tr="' + tid + '">');
        html.push('<span class="vtag">' + esc(TR_LABEL[tid]) + '</span>');

        if (info.type === 'text') {
          if (info.to) {
            html.push('<span class="spanbadge">' + v + '–' + info.to + '절</span>');
          }
          html.push('<span class="vtext" data-b="' + b + '" data-c="' + c + '" data-v="' + v +
            '" data-tr="' + tid + '">' + esc(info.text) + '</span>');
          html.push('<button class="copybtn" type="button" title="이 절 복사" aria-label="이 절 복사" ' +
            'data-copy="' + tid + '|' + b + '|' + c + '|' + v + '">⧉</button>');
        } else if (info.type === 'covered') {
          html.push('<span class="vmissing">' + info.by + '–' + info.to + '절에 포함</span>');
        } else if (info.type === 'absent') {
          html.push('<span class="vabsent">이 역본에는 이 절이 없음</span>');
        } else {
          html.push('<span class="vmissing">—</span>');
        }
        html.push('</div>');
      }
      html.push('</div>');
    }

    reader.innerHTML = html.join('');
    reader.scrollTop = 0;

    var status = $('#status');
    if (status) {
      status.textContent = m.ko + ' ' + c + '장 · ' + trs.map(function (t) { return TR_LABEL[t]; }).join(' / ');
    }
  }

  /* ---------------- 네비게이션 ---------------- */
  function goto(b, c, v, flash) {
    b = clamp(b, 1, 66);
    c = clamp(c, 1, bookMeta(b).ch);
    state.book = b;
    state.chapter = c;
    state.verse = v || null;
    store.set('book', b);
    store.set('chapter', c);

    bookSel.value = String(b);
    fillChapterSelect(chapSel, b, c);
    fillVerseSelect(verseSel, b, c, v || 1);

    renderReader();

    if (v) {
      var el = document.getElementById('v' + v);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        if (flash !== false) {
          el.classList.add('flash');
          setTimeout(function () { el.classList.remove('flash'); }, 1600);
        }
      }
    } else {
      window.scrollTo({ top: 0 });
    }
  }

  function boot(first) {
    reader.innerHTML = '<div class="loading">본문을 불러오는 중…</div>';
    Promise.all(state.trs.map(loadTr)).then(function () {
      fillBookSelect(bookSel);
      fillBookSelect(sBook);
      fillChapterSelect(chapSel, state.book, state.chapter);
      fillVerseSelect(verseSel, state.book, state.chapter, 1);
      fillChapterSelect(sChap, state.book, state.chapter);
      fillVerseSelect(sVerse, state.book, state.chapter, 1);
      goto(state.book, state.chapter, first ? null : state.verse, false);
    }).catch(function (err) {
      reader.innerHTML = '<div class="loading">' + esc(err.message) +
        '<br><br>index.html 을 이 폴더에서 열었는지, data 폴더가 함께 있는지 확인해 주세요.</div>';
    });
  }

  /* 역본만 바뀌었을 때: 읽던 위치를 유지한 채 다시 그린다 */
  function refresh() {
    Promise.all(state.trs.map(loadTr)).then(function () {
      fillChapterSelect(chapSel, state.book, state.chapter);
      fillVerseSelect(verseSel, state.book, state.chapter, state.verse || 1);
      fillChapterSelect(sChap, state.book, state.chapter);
      fillVerseSelect(sVerse, state.book, state.chapter, state.verse || 1);
      renderReader();
      if (!pvWrap.hidden) renderPreview();
    }).catch(function (err) {
      toast(err.message);
    });
  }

  /* 네비게이션 이벤트 */
  bookSel.addEventListener('change', function () {
    state.book = parseInt(this.value, 10);
    state.chapter = 1;
    goto(state.book, 1, null);
  });
  chapSel.addEventListener('change', function () {
    goto(state.book, parseInt(this.value, 10), null);
  });
  verseSel.addEventListener('change', function () {
    goto(state.book, state.chapter, parseInt(this.value, 10));
  });
  prevBtn.addEventListener('click', function () {
    if (state.chapter > 1) goto(state.book, state.chapter - 1, null);
    else if (state.book > 1) goto(state.book - 1, bookMeta(state.book - 1).ch, null);
  });
  nextBtn.addEventListener('click', function () {
    if (state.chapter < bookMeta(state.book).ch) goto(state.book, state.chapter + 1, null);
    else if (state.book < 66) goto(state.book + 1, 1, null);
  });

  copyChapter.addEventListener('click', function () { copyChapterText(); });

  function chapterText() {
    var b = state.book, c = state.chapter, out = [];
    var maxV = maxVerse(b, c);
    out.push(bookLabel(bookMeta(b)) + ' ' + c + '장');
    out.push('');
    for (var v = 1; v <= maxV; v++) {
      state.trs.forEach(function (tid) {
        var info = cellInfo(tid, b, c, v);
        if (info.type === 'text') {
          var prefix = state.trs.length > 1 ? '[' + TR_LABEL[tid] + '] ' : '';
          out.push(prefix + v + '. ' + info.text);
        }
      });
    }
    return out.join('\n');
  }

  function copyChapterText() { copyText(chapterText()); }

  /* 본문 복사 버튼 (이벤트 위임) */
  reader.addEventListener('click', function (e) {
    var btn = e.target.closest('.copybtn');
    if (!btn) return;
    var key = btn.getAttribute('data-copy').split('|');
    var tid = key[0], b = +key[1], c = +key[2], v = +key[3];
    var info = cellInfo(tid, b, c, v);
    if (info.type !== 'text') return;
    var txt = state.trs.length > 1
      ? '[' + TR_LABEL[tid] + '] ' + refLabel(b, c, v) + ' ' + info.text
      : refLabel(b, c, v) + ' ' + info.text;
    copyText(txt);
  });

  /* ---------------- 검색 패널 ---------------- */
  function isMobile() { return window.matchMedia('(max-width: 760px)').matches; }

  function openPanel() {
    if (state.panelOpen) return;
    state.panelOpen = true;
    panel.hidden = false;
    if (isMobile()) { scrim.hidden = false; }
    requestAnimationFrame(function () {
      panel.classList.add('open');
      if (isMobile()) scrim.classList.add('show');
    });
    document.body.style.overflow = isMobile() ? 'hidden' : '';
    try { history.pushState({ biblePanel: 1 }, ''); } catch (e) {}

    // 검색 범위 기본값 = 현재 읽는 역본
    syncScopeToReader();

    setTimeout(function () {
      var q = $('#q1');
      if (!isMobile()) q.focus();
    }, 260);
  }

  function closePanel() {
    if (!state.panelOpen) return;
    state.panelOpen = false;
    panel.classList.remove('open');
    scrim.classList.remove('show');
    document.body.style.overflow = '';
    setTimeout(function () {
      panel.hidden = true;
      scrim.hidden = true;
    }, 280);
  }

  $('#searchBtn').addEventListener('click', openPanel);
  $('#fab').addEventListener('click', openPanel);
  $('#closePanel').addEventListener('click', function () {
    closePanel();
    if (history.state && history.state.biblePanel) history.back();
  });
  scrim.addEventListener('click', function () {
    closePanel();
    if (history.state && history.state.biblePanel) history.back();
  });

  window.addEventListener('popstate', function () {
    if (state.panelOpen) closePanel();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.panelOpen) {
      closePanel();
    }
    // '/' 로 검색 열기 (입력 중이 아닐 때)
    if (e.key === '/' && !state.panelOpen) {
      var tag = (document.activeElement || {}).tagName;
      if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        openPanel();
      }
    }
    if (!state.panelOpen && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      var tag2 = (document.activeElement || {}).tagName;
      if (tag2 === 'INPUT' || tag2 === 'SELECT' || tag2 === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') prevBtn.click();
      else nextBtn.click();
    }
  });

  /* 검색 범위 체크박스 */
  function renderScope() {
    $('#scope').innerHTML = TRS.map(function (t) {
      return '<label><input type="checkbox" value="' + t.id + '" checked> ' + esc(t.label) + '</label>';
    }).join('');
  }

  function syncScopeToReader() {
    var boxes = $('#scope').querySelectorAll('input');
    if (!boxes.length) return;
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].checked = state.trs.indexOf(boxes[i].value) >= 0;
    }
  }

  function getScope() {
    var boxes = $('#scope').querySelectorAll('input:checked');
    return Array.prototype.map.call(boxes, function (b) { return b.value; });
  }

  /* 검색 인덱스 */
  function getIndex(tid) {
    if (state.indexCache[tid]) return state.indexCache[tid];
    var d = state.loaded[tid];
    var out = [];
    d.b.forEach(function (bk, bi) {
      bk.ch.forEach(function (arr, ci) {
        if (!arr) return;
        for (var vi = 0; vi < arr.length; vi++) {
          var t = arr[vi];
          if (t == null) continue;
          out.push({ b: bi + 1, c: ci + 1, v: vi + 1, t: t, low: t.toLowerCase() });
        }
      });
    });
    state.indexCache[tid] = out;
    return out;
  }

  function normQ(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function runSearch() {
    var q1 = normQ($('#q1').value);
    var q2 = normQ($('#q2').value);
    var op = $('#op').value;
    var scope = getScope();

    if (!q1 && !q2) {
      toast('검색어를 입력해 주세요');
      $('#q1').focus();
      return;
    }
    if (!scope.length) {
      toast('검색할 역본을 선택해 주세요');
      return;
    }

    var info = $('#searchInfo');
    info.textContent = '검색 중…';

    Promise.all(scope.map(loadTr)).then(function () {
      var groups = new Map();

      scope.forEach(function (tid) {
        var idx = getIndex(tid);
        for (var i = 0; i < idx.length; i++) {
          var rec = idx[i];
          var hit;
          if (!q1) {
            hit = rec.low.indexOf(q2) >= 0;
          } else if (!q2) {
            hit = rec.low.indexOf(q1) >= 0;
          } else if (op === 'and') {
            hit = rec.low.indexOf(q1) >= 0 && rec.low.indexOf(q2) >= 0;
          } else {
            hit = rec.low.indexOf(q1) >= 0 || rec.low.indexOf(q2) >= 0;
          }
          if (!hit) continue;

          var key = rec.b + ':' + rec.c + ':' + rec.v;
          var g = groups.get(key);
          if (!g) {
            g = { b: rec.b, c: rec.c, v: rec.v, items: [] };
            groups.set(key, g);
          }
          g.items.push({ tid: tid, t: rec.t });
        }
      });

      var arr = Array.from(groups.values()).sort(function (x, y) {
        return x.b - y.b || x.c - y.c || x.v - y.v;
      });

      state.result = {
        groups: arr,
        shown: PAGE,
        q1: q1,
        q2: q2,
        op: op,
        scope: scope,
        query: [$('#q1').value, $('#q2').value]
      };

      var verses = arr.length;
      var hits = 0;
      arr.forEach(function (g) { hits += g.items.length; });
      info.textContent = verses ? (verses.toLocaleString() + '개 구절 · ' + hits.toLocaleString() + '건') : '결과 없음';

      $('#resultsWrap').hidden = false;
      renderResults();
      $('#resultsWrap').scrollIntoView({ block: 'start', behavior: 'smooth' });
    }).catch(function (err) {
      info.textContent = '';
      toast(err.message);
    });
  }

  function renderResults() {
    var r = state.result;
    if (!r) return;
    var wrap = $('#results');
    var groups = r.groups;
    var shown = Math.min(r.shown, groups.length);

    $('#resultCount').textContent = groups.length
      ? '검색 결과 ' + groups.length.toLocaleString() + '개 구절'
      : '결과 없음';

    if (!groups.length) {
      wrap.innerHTML = '<div class="empty">일치하는 구절이 없습니다.<br>철자나 검색 조건을 확인해 보세요.</div>';
      $('#moreBtn').hidden = true;
      return;
    }

    var terms = [r.q1, r.q2].filter(Boolean);
    var html = [];

    for (var i = 0; i < shown; i++) {
      var g = groups[i];
      var ref = g.b + '|' + g.c + '|' + g.v;
      html.push('<div class="res">');
      html.push('<div class="res-ref">');
      html.push('<button class="link" type="button" data-peek="' + ref + '" title="읽던 위치를 두고 미리보기">' +
        esc(refLabel(g.b, g.c, g.v)) + '</button>');
      html.push('<span class="res-acts">');
      html.push('<button class="copybtn" type="button" title="이 구절로 이동" aria-label="이 구절로 이동" data-jump="' + ref + '">↗</button>');
      html.push('<button class="copybtn" type="button" title="이 구절 복사" aria-label="이 구절 복사" data-copyres="' + i + '">⧉</button>');
      html.push('</span>');
      html.push('</div>');

      g.items.forEach(function (it) {
        html.push('<div class="res-item"><span class="tag">' + esc(TR_LABEL[it.tid]) + '</span>' +
          '<span class="txt">' + highlight(it.t, terms) + '</span></div>');
      });

      html.push('</div>');
    }

    wrap.innerHTML = html.join('');
    $('#moreBtn').hidden = shown >= groups.length;
  }

  $('#doSearch').addEventListener('click', runSearch);
  $('#q1').addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });
  $('#q2').addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });
  $('#op').addEventListener('change', function () { if (state.result) runSearch(); });

  $('#clearSearch').addEventListener('click', function () {
    $('#q1').value = '';
    $('#q2').value = '';
    $('#searchInfo').textContent = '';
    $('#resultsWrap').hidden = true;
    state.result = null;
    $('#q1').focus();
  });

  $('#moreBtn').addEventListener('click', function () {
    if (!state.result) return;
    state.result.shown += PAGE;
    renderResults();
  });

  /* 결과 복사 / 미리보기 / 이동 */
  $('#results').addEventListener('click', function (e) {
    var peek = e.target.closest('[data-peek]');
    if (peek) {
      var pp = peek.getAttribute('data-peek').split('|');
      previewRef(+pp[0], +pp[1], +pp[2]);
      return;
    }

    var jump = e.target.closest('[data-jump]');
    if (jump) {
      var p = jump.getAttribute('data-jump').split('|');
      var b = +p[0], c = +p[1], v = +p[2];
      rememberPlace();
      closePanel();
      if (history.state && history.state.biblePanel) history.back();
      goto(b, c, v);
      return;
    }

    var cp = e.target.closest('[data-copyres]');
    if (cp && state.result) {
      var r = state.result;
      var g = r.groups[+cp.getAttribute('data-copyres')];
      if (!g) return;
      var lines = [refLabel(g.b, g.c, g.v)];
      g.items.forEach(function (it) {
        lines.push('[' + TR_LABEL[it.tid] + '] ' + it.t);
      });
      copyText(lines.join('\n'));
    }
  });

  $('#copyResults').addEventListener('click', function () {
    var r = state.result;
    if (!r || !r.groups.length) { toast('복사할 결과가 없습니다'); return; }

    var shown = Math.min(r.shown, r.groups.length);
    var lines = [];
    for (var i = 0; i < shown; i++) {
      var g = r.groups[i];
      lines.push(refLabel(g.b, g.c, g.v));
      g.items.forEach(function (it) {
        lines.push('[' + TR_LABEL[it.tid] + '] ' + it.t);
      });
      lines.push('');
    }
    if (shown < r.groups.length) lines.push('… 외 ' + (r.groups.length - shown).toLocaleString() + '개 구절');
    copyText(lines.join('\n').trim());
  });

  /* ---------------- 읽던 곳 기억 / 되돌아가기 ---------------- */
  var lastPlace = null;

  function rememberPlace() {
    lastPlace = {
      book: state.book,
      chapter: state.chapter,
      verse: state.verse || null,
      y: window.pageYOffset || document.documentElement.scrollTop || 0
    };
    backBtn.hidden = false;
    backBtn.title = bookMeta(lastPlace.book).ko + ' ' + lastPlace.chapter + '장으로 돌아가기';
  }

  function restorePlace() {
    if (!lastPlace) return;
    var p = lastPlace;
    lastPlace = null;
    backBtn.hidden = true;

    /* 절로 강제 스크롤하지 않고, 장을 그린 뒤 읽던 스크롤 위치로 되돌린다 */
    goto(p.book, p.chapter, null, false);
    if (p.verse) {
      state.verse = p.verse;
      verseSel.value = String(p.verse);
    }

    var y = p.y || 0;
    var apply = function () { window.scrollTo(0, y); };
    apply();
    if (window.requestAnimationFrame) {
      requestAnimationFrame(function () { apply(); requestAnimationFrame(apply); });
    }
    setTimeout(apply, 220);
    toast('읽던 곳으로 돌아왔습니다');
  }

  backBtn.addEventListener('click', restorePlace);

  /* ---------------- 미리보기 (읽던 위치 유지) ---------------- */
  function previewRef(b, c, v) {
    b = clamp(b, 1, 66);
    c = clamp(c, 1, bookMeta(b).ch);
    v = clamp(v || 1, 1, verseCount(state.trs[0], b, c) || 1);
    state.preview = { b: b, c: c, v: v };
    pvWrap.hidden = false;

    var need = state.trs.filter(function (t) { return !state.loaded[t]; });
    if (need.length) {
      Promise.all(need.map(loadTr)).then(renderPreview).catch(function (err) { toast(err.message); });
    }
    renderPreview();
    revealPreview();
  }

  /* 미리보기 카드가 패널 스크롤 영역 안으로 들어오도록 (바깥 읽기 화면은 건드리지 않음) */
  function revealPreview() {
    var body = pvWrap.parentNode;
    while (body && body !== document.body) {
      var cs = window.getComputedStyle(body);
      if (/(auto|scroll)/.test(cs.overflowY) && body.scrollHeight > body.clientHeight + 2) break;
      body = body.parentNode;
    }
    if (!body || body === document.body) return;
    var pr = pvWrap.getBoundingClientRect();
    var br = body.getBoundingClientRect();
    if (pr.top < br.top || pr.bottom > br.bottom) {
      var top = body.scrollTop + (pr.top - br.top) - 8;
      body.scrollTop = Math.max(0, top);
    }
  }

  function syncRefSelects(b, c, v) {
    sBook.value = String(b);
    fillChapterSelect(sChap, b, c);
    fillVerseSelect(sVerse, b, c, v);
  }

  function renderPreview() {
    var p = state.preview;
    if (!p || pvWrap.hidden) return;
    var b = p.b, c = p.c, v = p.v;
    var m = bookMeta(b);

    var maxV = 1;
    state.trs.forEach(function (tid) {
      var arr = chapterArr(tid, b, c);
      if (arr && arr.length > maxV) maxV = arr.length;
      maxV = Math.max(maxV, verseCount(tid, b, c));
    });

    var multi = state.trs.length > 1;
    var html = [];
    var seenHead = {};

    for (var vv = 1; vv <= maxV; vv++) {
      for (var hi = 0; hi < state.trs.length; hi++) {
        var head = headingAt(state.trs[hi], b, c, vv);
        var hk = vv + '|' + head;
        if (head && !seenHead[hk]) {
          seenHead[hk] = 1;
          html.push('<div class="pv-heading">' + esc(head) + '</div>');
        }
      }

      html.push('<div class="pv-row' + (vv === v ? ' pv-target' : '') + '">');
      html.push('<div class="pv-num">' + vv + '</div><div class="pv-cells">');

      for (var ti = 0; ti < state.trs.length; ti++) {
        var tid = state.trs[ti];
        var info = cellInfo(tid, b, c, vv);
        var tag = multi ? '<span class="pv-tag">' + esc(TR_LABEL[tid]) + '</span>' : '';

        if (info.type === 'text') {
          html.push('<div class="pv-cell">' + tag +
            (info.to ? '<span class="pv-badge">' + vv + '–' + info.to + '절</span>' : '') +
            '<span class="pv-text">' + esc(info.text) + '</span></div>');
        } else if (info.type === 'absent') {
          html.push('<div class="pv-cell pv-missing">' + tag + '이 역본에는 이 절이 없음</div>');
        } else if (info.type === 'covered') {
          html.push('<div class="pv-cell pv-missing">' + tag + info.by + '–' + info.to + '절에 포함</div>');
        } else {
          html.push('<div class="pv-cell pv-missing">' + tag + '—</div>');
        }
      }
      html.push('</div></div>');
    }

    pvRef.textContent = bookLabel(m) + ' ' + c + '장';
    pvSub.textContent = v + '절' + (multi
      ? ' · ' + state.trs.map(function (t) { return TR_LABEL[t]; }).join(' / ') : '');
    pvGo.textContent = '이 위치에서 읽기 (' + c + ':' + v + ')';
    pvBody.innerHTML = html.join('');

    var tgt = pvBody.querySelector('.pv-target');
    if (tgt) {
      var br = pvBody.getBoundingClientRect();
      var tr = tgt.getBoundingClientRect();
      pvBody.scrollTop = Math.max(0, pvBody.scrollTop + (tr.top - br.top) - 44);
    }

    syncRefSelects(b, c, v);
  }

  function stepPreview(dir) {
    var p = state.preview;
    if (!p) return;
    var b = p.b, c = p.c;
    if (dir > 0) {
      if (c < bookMeta(b).ch) c++;
      else if (b < 66) { b++; c = 1; }
    } else {
      if (c > 1) c--;
      else if (b > 1) { b--; c = bookMeta(b).ch; }
    }
    state.preview = { b: b, c: c, v: 1 };
    renderPreview();
    pvBody.scrollTop = 0;
  }

  $('#peekBtn').addEventListener('click', function () {
    previewRef(parseInt(sBook.value, 10), parseInt(sChap.value, 10), parseInt(sVerse.value, 10) || 1);
  });
  $('#pvPrev').addEventListener('click', function () { stepPreview(-1); });
  $('#pvNext').addEventListener('click', function () { stepPreview(1); });
  $('#pvClose').addEventListener('click', function () {
    pvWrap.hidden = true;
    state.preview = null;
  });
  $('#pvGo').addEventListener('click', function () {
    var p = state.preview;
    if (!p) return;
    rememberPlace();
    closePanel();
    if (history.state && history.state.biblePanel) history.back();
    goto(p.b, p.c, p.v);
  });

  /* ---------------- 패널 내 책/장/절 ---------------- */
  function scrollToPanelEl(el) {
    if (!el) return;
    var body = panel.querySelector('.panel-body');
    var top = el.offsetTop - 70;
    if (body) body.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  sBook.addEventListener('change', function () {
    var b = parseInt(this.value, 10);
    fillChapterSelect(sChap, b, 1);
    fillVerseSelect(sVerse, b, 1, 1);
  });
  sChap.addEventListener('change', function () {
    fillVerseSelect(sVerse, parseInt(sBook.value, 10), parseInt(this.value, 10), 1);
  });

  $('#goBtn').addEventListener('click', function () {
    var b = parseInt(sBook.value, 10);
    var c = parseInt(sChap.value, 10);
    var v = parseInt(sVerse.value, 10) || 1;
    rememberPlace();
    closePanel();
    if (history.state && history.state.biblePanel) history.back();
    goto(b, c, v);
  });

  /* ---------------- 시작 ---------------- */
  renderChips();
  renderScope();
  fillBookSelect(bookSel);
  fillBookSelect(sBook);
  fillChapterSelect(sChap, state.book, 1);
  fillVerseSelect(sVerse, state.book, 1, 1);
  boot(true);

})();
