/* ==========================================================================
   Tap Tap – Customer “Hỏi Tap Tap” sheet (js/ask.js)
   Visible on chrome screens 1, 4 (after card reveal), 5, 6, 8, 9.
   Posts { question, station? } to /api/query. No team mode, no toggle.
   ========================================================================== */

(function () {
  'use strict';

  const ASK_SCREENS = new Set([1, 4, 5, 6, 8, 9]);
  const STATION_SCREENS = new Set([4, 6, 9]);

  let screen = 1;
  let cardRevealed = true;
  let stationSlug = null;
  let stationName = null;

  function els() {
    return {
      fab: document.getElementById('askFab'),
      backdrop: document.getElementById('askSheetBackdrop'),
      closeBtn: document.getElementById('askCloseBtn'),
      form: document.getElementById('askForm'),
      input: document.getElementById('askQuestionInput'),
      submit: document.getElementById('askSubmitBtn'),
      context: document.getElementById('askStationContext'),
      result: document.getElementById('askResult'),
      frame: document.getElementById('appFrame')
    };
  }

  function canShowFab() {
    if (!ASK_SCREENS.has(screen)) return false;
    if (screen === 4 && !cardRevealed) return false;
    return true;
  }

  function sourceLabel(source) {
    if (!source) return 'Tài liệu công khai';
    const base = String(source).split('/').pop() || String(source);
    return base.replace(/\.(json|md|png|webp)$/i, '');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatAnswer(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function renderResult(payload) {
    const box = els().result;
    if (!box) return;
    const answer = (payload && payload.answer) || 'Không có thông tin này trong tài liệu dành cho khách.';
    const citations = (payload && payload.citations) || [];
    const status = payload && payload.status;

    let html = `<div class="ask-answer">${formatAnswer(answer)}</div>`;
    if (citations.length) {
      html += '<div class="ask-sources-label">Nguồn</div><ol class="ask-citations">';
      citations.forEach((c) => {
        const title = escapeHtml(c.title || sourceLabel(c.source));
        const src = escapeHtml(sourceLabel(c.source));
        const urls = Array.isArray(c.urls) ? c.urls.filter(Boolean) : [];
        html += `<li><div class="ask-cite-title">${title}</div><div class="ask-cite-src">${src}</div>`;
        urls.forEach((u) => {
          const safe = escapeHtml(u);
          html += `<a class="ask-cite-link" href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
        });
        html += '</li>';
      });
      html += '</ol>';
    } else if (status && status !== 'ok') {
      html += '<p class="ask-no-cite">Không có nguồn công khai cho câu này.</p>';
    }
    box.innerHTML = html;
    box.hidden = false;
  }

  function updateChrome() {
    const { fab, backdrop, context, frame } = els();
    if (fab) {
      const show = canShowFab() && !(backdrop && backdrop.classList.contains('is-open'));
      fab.hidden = !show;
    }
    if (frame) {
      frame.classList.toggle('ask-open', !!(backdrop && backdrop.classList.contains('is-open')));
    }
    if (context) {
      if (STATION_SCREENS.has(screen) && stationName) {
        context.hidden = false;
        context.textContent = `Ưu tiên trạm: ${stationName}`;
      } else {
        context.hidden = true;
        context.textContent = '';
      }
    }
  }

  function openSheet() {
    if (!canShowFab()) return;
    const { backdrop, input, result } = els();
    if (!backdrop) return;
    backdrop.classList.add('is-open');
    backdrop.setAttribute('aria-hidden', 'false');
    if (result && !result.innerHTML) result.hidden = true;
    updateChrome();
    if (input) {
      input.focus();
    }
  }

  function closeSheet() {
    const { backdrop } = els();
    if (!backdrop) return;
    backdrop.classList.remove('is-open');
    backdrop.setAttribute('aria-hidden', 'true');
    updateChrome();
  }

  async function submitQuestion(question) {
    const q = String(question || '').trim();
    if (!q) return;
    const { result, submit, input } = els();
    if (input) input.value = q;
    if (result) {
      result.hidden = false;
      result.innerHTML = '<p class="ask-loading">Đang tìm trong tài liệu công khai…</p>';
    }
    if (submit) submit.disabled = true;

    const body = { question: q };
    if (STATION_SCREENS.has(screen) && stationSlug) body.station = stationSlug;

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      let payload = null;
      try {
        payload = await res.json();
      } catch (_) {
        payload = {
          answer: 'Không có thông tin này trong tài liệu dành cho khách.',
          citations: [],
          status: 'error'
        };
      }
      renderResult(payload);
    } catch (_) {
      renderResult({
        answer: 'Chưa hỏi được lúc này. Thử lại sau nha.',
        citations: [],
        status: 'error'
      });
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function bind() {
    const { fab, backdrop, closeBtn, form, input } = els();
    if (fab) {
      fab.addEventListener('click', openSheet);
    }
    if (closeBtn) closeBtn.addEventListener('click', closeSheet);
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeSheet();
      });
    }
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitQuestion(input ? input.value : '');
      });
    }
    document.querySelectorAll('[data-ask-suggest]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = btn.getAttribute('data-ask-suggest');
        if (input) input.value = q;
        submitQuestion(q);
      });
    });
  }

  function sync(ctx) {
    if (!ctx) return;
    if (typeof ctx.screen === 'number') screen = ctx.screen;
    if (typeof ctx.cardRevealed === 'boolean') cardRevealed = ctx.cardRevealed;
    stationSlug = ctx.stationSlug || null;
    stationName = ctx.stationName || null;
    if (!ASK_SCREENS.has(screen)) closeSheet();
    updateChrome();
  }

  window.TapTapAsk = {
    sync,
    setCardRevealed(value) {
      cardRevealed = !!value;
      updateChrome();
    },
    open: openSheet,
    close: closeSheet
  };

  window.addEventListener('DOMContentLoaded', () => {
    bind();
    updateChrome();
  });
})();
