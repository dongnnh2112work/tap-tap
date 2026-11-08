/* ==========================================================================
   Tap Tap – Main Application Controller (js/app.js)
   Full-flow pass (mobile-first, Vietnamese Gen Z copy):
   - Flow A: NFC deep link (?station=<slug>) -> true fullscreen intro (no chrome)
     -> 3D card reveal (tilt/flip) -> Google sign-in prompt (mock)
     -> quiz (random 1 of 3-4, wrong answer retries with different question)
     -> card saved to collection -> milestone badge unlock at 5/10/15 (tier_*.webp)
     -> next suggested station on map.
   - Flow B: Home -> Collection -> Card detail -> Map (landscape pan/zoom)
     -> Profile (with reset) -> Wrapped (iframe under wrapped/, only unlocked at 15/15 or ?demo=full).
   ========================================================================== */

(function () {
  'use strict';

  const STORAGE_KEY = 'taptap_flow_state_v1';

  const defaultState = {
    signedIn: false,
    userName: 'Minh Anh',
    collectedIds: [],
    unlockedSecrets: [],
    quizCorrectCount: 0,
    favoriteStationId: 'tiger'
  };

  let appData = null;
  let state = loadState();
  let currentScreen = 1;
  let activeStation = null;
  let activeDetailCard = null;
  let justWonStationId = null;
  let currentQuizIndex = -1;
  let quizResolvedForStation = false;
  let selectedMapStationId = null;

  let quizCard3D = null;
  let detailCard3D = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...defaultState, collectedIds: [], unlockedSecrets: [] };
      const parsed = JSON.parse(raw);
      const cleanName =
        !parsed.userName || parsed.userName.includes('Bạn nhỏ') ? 'Minh Anh' : parsed.userName;
      return {
        ...defaultState,
        ...parsed,
        userName: cleanName,
        collectedIds: Array.isArray(parsed.collectedIds) ? parsed.collectedIds : [],
        unlockedSecrets: Array.isArray(parsed.unlockedSecrets) ? parsed.unlockedSecrets : []
      };
    } catch (_) {
      return { ...defaultState, collectedIds: [], unlockedSecrets: [] };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
    updateGlobalCounters();
  }

  function showToast(msg) {
    const toast = document.getElementById('ttToast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('is-visible');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 2200);
  }

  function getStationById(id) {
    if (!appData || !appData.stations || !id) return null;
    return appData.stations.find((s) => s.id === id) || null;
  }

  function getStationByIdOrSlug(val) {
    if (!appData || !appData.stations || !val) return null;
    val = String(val).toLowerCase().trim();
    return (
      appData.stations.find(
        (s) =>
          s.id.toLowerCase() === val ||
          (s.slug && s.slug.toLowerCase() === val) ||
          String(s.number) === val
      ) || null
    );
  }

  const RAG_SLUG_ALIASES = {
    'te-giac-trang': 'te-giac',
    'ho-vang': 'ho',
    'thien-nga-duong-hao': 'thien-nga',
    'co-gia-day-java': 'gia-day'
  };

  function toPublicRagSlug(slug) {
    if (!slug) return null;
    const key = String(slug).toLowerCase().trim();
    return RAG_SLUG_ALIASES[key] || key;
  }

  function notifyAskContext(extra = {}) {
    if (!window.TapTapAsk) return;
    let station = null;
    if (currentScreen === 4) station = extra.station || activeStation;
    else if (currentScreen === 6) station = extra.station || activeDetailCard;
    else if (currentScreen === 9) {
      station =
        extra.station ||
        getStationById(selectedMapStationId) ||
        getNextSuggestedStation();
    }
    const cardRevealed =
      typeof extra.cardRevealed === 'boolean'
        ? extra.cardRevealed
        : currentScreen !== 4 ||
          !(document.getElementById('screen-4') && document.getElementById('screen-4').classList.contains('is-popping'));
    window.TapTapAsk.sync({
      screen: currentScreen,
      cardRevealed,
      stationSlug: station ? toPublicRagSlug(station.slug) : null,
      stationName: station ? station.name : null
    });
  }

  function getSecretById(id) {
    if (!appData || !appData.secretCards || !id) return null;
    return appData.secretCards.find((s) => s.id === id) || null;
  }

  function isCollected(stationId) {
    return state.collectedIds.includes(stationId);
  }

  function isWrappedUnlocked() {
    const params = new URLSearchParams(window.location.search);
    return state.collectedIds.length >= 15 || params.get('demo') === 'full';
  }

  function getNextSuggestedStation() {
    if (!appData || !appData.stations) return null;
    const uncollected = appData.stations.filter((s) => !isCollected(s.id));
    if (uncollected.length > 0) {
      const tiger = uncollected.find((s) => s.id === 'tiger');
      return tiger || uncollected[0];
    }
    return getStationById('tiger') || appData.stations[0];
  }

  function setThemeColors(cardObj) {
    const frame = document.getElementById('appFrame');
    if (!frame) return;
    if (cardObj && cardObj.pastel) {
      frame.style.setProperty('--theme-pastel', cardObj.pastel);
      frame.style.setProperty('--theme-accent', cardObj.accent || '#d95326');
      frame.style.setProperty('--theme-glow', cardObj.glow || 'rgba(255,213,194,0.65)');
    } else {
      frame.style.setProperty('--theme-pastel', '#ffd5c2');
      frame.style.setProperty('--theme-accent', '#e06d2b');
      frame.style.setProperty('--theme-glow', 'rgba(255, 213, 194, 0.55)');
    }
  }

  function updateGlobalCounters() {
    const count = state.collectedIds.length;
    const topCounterText = document.getElementById('topCounterText');
    if (topCounterText) {
      topCounterText.textContent = `${count}/15`;
    }
  }

  // ================= NAVIGATION (EXACTLY 9 SCREENS) =================
  const BOTTOM_NAV_SCREENS = new Set([1, 5, 8, 9]);

  function showScreen(screenNum, options = {}) {
    if (currentScreen === 2 && screenNum !== 2) {
      stopStationVideo();
    }
    if (currentScreen === 7 && screenNum !== 7) {
      closeWrappedStory(false);
    }

    currentScreen = screenNum;

    const appFrame = document.getElementById('appFrame');
    if (appFrame) {
      appFrame.classList.toggle('is-fullscreen-intro', screenNum === 2);
      appFrame.classList.toggle('is-wrapped-open', screenNum === 7);
    }

    document.querySelectorAll('.screen').forEach((el) => {
      const n = Number(el.dataset.screen);
      el.classList.toggle('is-active', n === screenNum);
    });

    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) {
      bottomNav.classList.toggle('is-hidden', !BOTTOM_NAV_SCREENS.has(screenNum));
      bottomNav.querySelectorAll('.nav-tab').forEach((btn) => {
        btn.classList.toggle('is-active', Number(btn.dataset.target) === screenNum);
      });
    }

    if (screenNum === 1) renderScreen1Home();
    if (screenNum === 2) renderScreen2Station(options.station || activeStation);
    if (screenNum === 3) renderScreen3Login();
    if (screenNum === 4) renderScreen4CardQuiz(options.station || activeStation, !!options.openQuiz);
    if (screenNum === 5) renderScreen5Collection();
    if (screenNum === 6) renderScreen6CardDetail(options.card || activeDetailCard);
    if (screenNum === 7) renderScreen7Wrapped();
    if (screenNum === 8) renderScreen8Profile();
    if (screenNum === 9) renderScreen9Map(options.focusStationId);

    notifyAskContext({
      station: options.station || options.card || null
    });
  }

  // ================= FLOW A ENTRY: TAP NFC STATION =================
  function triggerNfcTapFlow(stationQuery) {
    const station =
      getStationByIdOrSlug(stationQuery) ||
      (stationQuery === 'tiger' ? getStationById('tiger') : getNextSuggestedStation());
    activeStation = station;
    setThemeColors(station);
    showScreen(2, { station });
  }

  // ================= SCREEN 1: TRANG CHỦ =================
  function renderScreen1Home() {
    setThemeColors(null);
    const count = state.collectedIds.length;
    const pct = Math.round((count / 15) * 100);
    const progText = document.getElementById('homeProgressText');
    const progFill = document.getElementById('homeProgressFill');
    const nextBtnLabel = document.getElementById('homeTapNextLabel');

    if (progText) progText.textContent = `${count}/15`;
    if (progFill) progFill.style.width = `${pct}%`;

    const nextSt = getNextSuggestedStation();
    if (nextBtnLabel && nextSt) {
      nextBtnLabel.textContent = `Chạm NFC: #${String(nextSt.number).padStart(2, '0')} ${nextSt.name}`;
    }
  }

  // ================= SCREEN 2: TRANG TRẠM (TRUE FULL SCREEN INTRO) =================
  function stopStationVideo() {
    const vid = document.getElementById('stationIntroVideo');
    if (vid) vid.pause();
  }

  function finishStationIntroAndProceed() {
    stopStationVideo();
    const station = activeStation || getStationById('tiger') || getNextSuggestedStation();
    activeStation = station;
    // Flow A: NFC video ends -> Card reveal (3D tilt/flip) on Screen 4
    showScreen(4, { station });
  }

  function renderScreen2Station(station) {
    if (!station && appData) station = getNextSuggestedStation();
    activeStation = station;
    setThemeColors(station);

    const vid = document.getElementById('stationIntroVideo');
    if (vid) {
      const targetSrc = station.introVideo || 'intro-anim/tiger_v2_trim.mp4';
      if (!vid.getAttribute('src') || vid.getAttribute('src') !== targetSrc) {
        vid.setAttribute('src', targetSrc);
      }
      vid.muted = true;
      vid.currentTime = 0;
      const playPromise = vid.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    }
  }

  // ================= SCREEN 3: ĐĂNG NHẬP GOOGLE =================
  function renderScreen3Login() {}

  function handleMockGoogleSignIn() {
    state.signedIn = true;
    state.userName = 'Minh Anh';
    saveState();
    showToast('Đã đăng nhập Google');
    if (activeStation) {
      showScreen(4, { station: activeStation });
    } else {
      showScreen(5);
    }
  }

  // ================= SCREEN 4: THẺ THÚ + QUIZ =================
  function renderScreen4CardQuiz(station, openQuizDirectly = false) {
    if (!station && appData) {
      station = activeStation || getStationById('tiger') || getNextSuggestedStation();
    }
    activeStation = station;
    setThemeColors(station);
    quizResolvedForStation = false;
    currentQuizIndex = -1;

    // Immediately mark card as collected upon entering Screen 4
    const prevCount = state.collectedIds.length;
    if (!isCollected(station.id)) {
      state.collectedIds.push(station.id);
      justWonStationId = station.id;
      state.favoriteStationId = station.id;
      saveState();

      const newCount = state.collectedIds.length;
      if (
        (prevCount < 5 && newCount >= 5) ||
        (prevCount < 10 && newCount >= 10) ||
        (prevCount < 15 && newCount >= 15)
      ) {
        const tier = newCount >= 15 ? 15 : newCount >= 10 ? 10 : 5;
        setTimeout(() => showMilestoneModal(tier), 650);
      }
    }

    const screenEl = document.getElementById('screen-4');
    const factEl = document.getElementById('cqFunFactText');
    const authBox = document.getElementById('cqAuthBox');
    const promptBox = document.getElementById('cqChallengePrompt');
    const quizBox = document.getElementById('quizBox');
    const postWinActions = document.getElementById('cqPostWinActions');

    if (factEl) factEl.textContent = station.funFact;
    if (postWinActions) postWinActions.style.display = 'none';
    if (quizBox) quizBox.style.display = 'none';
    if (promptBox) promptBox.style.display = 'none';
    if (authBox) authBox.style.display = 'none';

    // Hide post-reveal UI while card pops out; Hỏi Tap Tap waits until the card lands
    if (screenEl) screenEl.classList.add('is-popping');
    notifyAskContext({ station, cardRevealed: false });

    const mountEl = document.getElementById('cqCardMount');
    if (mountEl) {
      if (!quizCard3D) {
        quizCard3D = new window.TapTapCard3D(mountEl);
      }
      quizCard3D.setCardData(station);
      quizCard3D.playPopReveal(() => {
        if (screenEl) screenEl.classList.remove('is-popping');
        notifyAskContext({ station, cardRevealed: true });
        // Once card lands: user enjoys card (tilt/flip, fun fact)
        if (openQuizDirectly) {
          if (authBox) authBox.style.display = 'none';
          if (promptBox) promptBox.style.display = 'none';
          if (quizBox) quizBox.style.display = 'flex';
        } else if (!state.signedIn) {
          // If guest, show auth prompt first
          if (authBox) authBox.style.display = 'flex';
          if (promptBox) promptBox.style.display = 'none';
          if (quizBox) quizBox.style.display = 'none';
        } else {
          // Soft optional prompt: 'Có thử thách nè, chơi không?'
          if (authBox) authBox.style.display = 'none';
          if (promptBox) promptBox.style.display = 'flex';
          if (quizBox) quizBox.style.display = 'none';
        }
      });
    } else if (screenEl) {
      screenEl.classList.remove('is-popping');
      notifyAskContext({ station, cardRevealed: true });
    }

    loadRandomQuizQuestion(station, -1);
  }

  function proceedToPromptAfterAuth() {
    const authBox = document.getElementById('cqAuthBox');
    const promptBox = document.getElementById('cqChallengePrompt');
    const quizBox = document.getElementById('quizBox');
    if (authBox) authBox.style.display = 'none';
    if (promptBox) promptBox.style.display = 'flex';
    if (quizBox) quizBox.style.display = 'none';
  }

  function loadRandomQuizQuestion(station, excludeIdx) {
    const pool = station.quiz || [];
    if (!pool.length) return;

    let candidates = pool.map((_, idx) => idx);
    if (pool.length > 1 && excludeIdx >= 0) {
      candidates = candidates.filter((i) => i !== excludeIdx);
    }
    const chosenPoolIdx = candidates[Math.floor(Math.random() * candidates.length)];
    currentQuizIndex = chosenPoolIdx;

    const qObj = pool[chosenPoolIdx];
    const qTextEl = document.getElementById('quizQuestionText');
    const optsWrap = document.getElementById('quizOptionsList');

    if (qTextEl) qTextEl.textContent = qObj.q;

    const indexedOptions = qObj.options.map((text, idx) => ({
      text,
      isCorrect: idx === qObj.answer
    }));
    for (let i = indexedOptions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indexedOptions[i], indexedOptions[j]] = [indexedOptions[j], indexedOptions[i]];
    }

    if (optsWrap) {
      const letters = ['A', 'B', 'C'];
      optsWrap.innerHTML = indexedOptions
        .map(
          (opt, i) => `
          <button type="button" class="quiz-opt-btn" data-correct="${opt.isCorrect}">
            <span><strong>${letters[i]}.</strong> ${opt.text}</span>
            <span class="opt-status-icon"></span>
          </button>
        `
        )
        .join('');

      optsWrap.querySelectorAll('.quiz-opt-btn').forEach((btn) => {
        btn.addEventListener('click', () => handleQuizAnswerClick(btn, station));
      });
    }
  }

  function handleQuizAnswerClick(clickedBtn, station) {
    if (quizResolvedForStation) return;

    const isCorrect = clickedBtn.dataset.correct === 'true';
    const statusIcon = clickedBtn.querySelector('.opt-status-icon');
    const postWinActions = document.getElementById('cqPostWinActions');

    if (isCorrect) {
      quizResolvedForStation = true;
      clickedBtn.classList.add('is-correct');
      if (statusIcon) statusIcon.textContent = '✓';

      if (!isCollected(station.id)) {
        state.collectedIds.push(station.id);
      }
      state.quizCorrectCount = (state.quizCorrectCount || 0) + 1;
      saveState();

      if (quizCard3D) quizCard3D.burstParticles();

      if (postWinActions) {
        postWinActions.style.display = 'flex';
        const colBtn = document.getElementById('cqGoCollectionBtn');
        if (colBtn) {
          colBtn.querySelector('span').textContent = `Xem Bộ sưu tập (${state.collectedIds.length}/15)`;
        }
      }
    } else {
      clickedBtn.classList.add('is-wrong');
      clickedBtn.disabled = true;
      if (statusIcon) statusIcon.textContent = '✕';

      clearTimeout(handleQuizAnswerClick._retryTimer);
      handleQuizAnswerClick._retryTimer = setTimeout(() => {
        if (currentScreen === 4 && !quizResolvedForStation) {
          loadRandomQuizQuestion(station, currentQuizIndex);
        }
      }, 850);
    }
  }

  // ================= MILESTONE BADGE MODAL =================
  function showMilestoneModal(tier) {
    const modal = document.getElementById('milestoneModal');
    const img = document.getElementById('milestoneModalImg');
    const name = document.getElementById('milestoneModalName');
    const desc = document.getElementById('milestoneModalDesc');
    if (!modal) return;

    if (img) img.src = `assets/badges/tier_${tier}.webp`;
    if (name) name.textContent = `Mốc ${tier} thẻ thú`;
    if (desc) {
      desc.textContent =
        tier === 15
          ? 'Đủ bộ 15 thẻ thú! Bạn đã mở khóa Tap Tap Wrapped.'
          : tier === 10
          ? 'Tuyệt đỉnh! Đã hoàn thành 2/3 hành trình.'
          : 'Collector chính hiệu! Tiếp tục săn thẻ nào.';
    }
    modal.classList.add('is-open');
  }

  function closeMilestoneModal() {
    const modal = document.getElementById('milestoneModal');
    if (modal) modal.classList.remove('is-open');
  }

  // ================= SCREEN 5: BỘ SƯU TẬP =================
  function renderScreen5Collection() {
    setThemeColors(null);
    const count = state.collectedIds.length;
    const pct = Math.round((count / 15) * 100);

    const countBadge = document.getElementById('colCountBadge');
    const progFill = document.getElementById('colProgressFill');
    const wrappedBanner = document.getElementById('colWrappedBanner');

    if (countBadge) {
      if (justWonStationId && count > 0) {
        const prev = Math.max(0, count - 1);
        countBadge.textContent = `${prev}/15`;
        setTimeout(() => {
          countBadge.textContent = `${count}/15`;
          if (window.gsap) {
            gsap.fromTo(countBadge, { scale: 1.25 }, { scale: 1, duration: 0.4, ease: 'back.out(2.2)' });
          }
        }, 220);
      } else {
        countBadge.textContent = `${count}/15`;
      }
    }

    if (progFill) progFill.style.width = `${pct}%`;
    if (wrappedBanner) wrappedBanner.classList.toggle('is-visible', isWrappedUnlocked());

    // U7 Badges Row (5 / 10 / 15) using assets/badges/tier_*.webp
    const badgesGrid = document.getElementById('colBadgesGrid');
    if (badgesGrid && appData) {
      badgesGrid.innerHTML = appData.badges
        .map((b) => {
          const unlocked = count >= b.milestone;
          const badgeImg = b.img || `assets/badges/tier_${b.milestone}.webp`;
          return `
            <div class="u7-badge-card ${unlocked ? 'is-unlocked' : ''}">
              <div class="u7-badge-art-wrap" style="background:${b.bg}; color:${b.accent};">
                <img class="u7-badge-img" src="${badgeImg}" alt="${b.title}"
                  onload="this.parentElement.classList.add('has-badge-img')"
                  onerror="this.style.display='none'" />
                <span class="u7-badge-fallback">${b.milestone}/15</span>
              </div>
              <div class="u7-badge-name">${b.title}</div>
            </div>
          `;
        })
        .join('');
    }

    // Numbered Grid (#01 - #15)
    const dexGrid = document.getElementById('colDexGrid');
    if (dexGrid && appData) {
      dexGrid.innerHTML = appData.stations
        .map((st) => {
          const collected = isCollected(st.id);
          const isJustWon = justWonStationId === st.id;
          const numStr = String(st.number).padStart(2, '0');

          if (!collected) {
            return `
              <button type="button" class="dex-slot is-empty" data-empty-station="${st.id}" aria-label="#${numStr}">
                <span class="dex-slot-num-empty">#${numStr}</span>
              </button>
            `;
          }

          return `
            <button type="button" class="dex-slot is-collected ${isJustWon ? 'is-just-won' : ''}" data-collected-station="${st.id}">
              <div class="dex-mini-art" style="--slot-pastel:${st.pastel};">
                <span class="dex-slot-badge-num">#${numStr}</span>
                <img src="${st.cardArt}" alt="${st.name}" loading="lazy" />
              </div>
              <div class="dex-mini-caption">${st.name}</div>
            </button>
          `;
        })
        .join('');

      dexGrid.querySelectorAll('[data-collected-station]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const st = getStationById(btn.dataset.collectedStation);
          if (st) {
            activeDetailCard = st;
            showScreen(6, { card: st });
          }
        });
      });

      dexGrid.querySelectorAll('[data-empty-station]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const st = getStationById(btn.dataset.emptyStation);
          if (st) {
            showScreen(9, { focusStationId: st.id });
          }
        });
      });

      if (justWonStationId) {
        setTimeout(() => {
          justWonStationId = null;
        }, 900);
      }
    }

    // Secret Cards Row
    const secretGrid = document.getElementById('colSecretGrid');
    if (secretGrid && appData) {
      secretGrid.innerHTML = appData.secretCards
        .map((sc) => {
          const unlocked = state.unlockedSecrets.includes(sc.id);
          if (!unlocked) {
            return `
              <button type="button" class="secret-slot" data-secret-id="${sc.id}" data-locked="true">
                <div class="secret-q-mark">?</div>
              </button>
            `;
          }
          return `
            <button type="button" class="secret-slot is-unlocked" data-secret-id="${sc.id}" data-locked="false">
              <div class="dex-mini-art" style="--slot-pastel:${sc.pastel};">
                <img src="${sc.cardArt}" alt="${sc.name}" loading="lazy" />
              </div>
              <div class="dex-mini-caption">${sc.name}</div>
            </button>
          `;
        })
        .join('');

      secretGrid.querySelectorAll('[data-secret-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sc = getSecretById(btn.dataset.secretId);
          if (!sc || btn.dataset.locked === 'true') return;
          activeDetailCard = sc;
          showScreen(6, { card: sc });
        });
      });
    }
  }

  // ================= SCREEN 6: CHI TIẾT THẺ =================
  function renderScreen6CardDetail(card) {
    if (!card && appData) {
      const firstCollected = state.collectedIds[0] ? getStationById(state.collectedIds[0]) : null;
      card = firstCollected || getStationById('tiger') || appData.stations[0];
    }
    activeDetailCard = card;
    setThemeColors(card);

    const mountEl = document.getElementById('cdCardMount');
    if (mountEl) {
      if (!detailCard3D) {
        detailCard3D = new window.TapTapCard3D(mountEl);
      }
      detailCard3D.setCardData(card);
      detailCard3D.playPopReveal();
    }

    const titleEl = document.getElementById('cdBottomTitle');
    const factEl = document.getElementById('cdBottomFact');

    if (titleEl) {
      titleEl.textContent = card.number
        ? `#${String(card.number).padStart(2, '0')} • ${card.name}`
        : `${card.code} • ${card.name}`;
    }
    if (factEl) factEl.textContent = card.funFact;
    notifyAskContext({ station: card, cardRevealed: true });
  }

  function stepDetailCard(dir) {
    if (!appData) return;
    const pool =
      state.collectedIds.length > 0
        ? appData.stations.filter((s) => state.collectedIds.includes(s.id))
        : appData.stations;
    if (!pool.length) return;
    const curIdx = pool.findIndex((s) => s.id === (activeDetailCard && activeDetailCard.id));
    const nextIdx = (curIdx + dir + pool.length) % pool.length;
    renderScreen6CardDetail(pool[nextIdx]);
  }

  // ================= SCREEN 7: WRAPPED (IFRAME UNDER wrapped/) =================
  function renderScreen7Wrapped() {
    if (!isWrappedUnlocked()) {
      showToast('Cần đủ 15/15 thẻ thú để mở Wrapped!');
      showScreen(5);
      return;
    }

    const frame = document.getElementById('appFrame');
    if (frame) frame.classList.add('is-wrapped-open');

    const iframe = document.getElementById('wrappedIframe');
    if (iframe) {
      iframe.src = 'wrapped/index.html';
    }
  }

  function closeWrappedStory(navigateBack = true) {
    const frame = document.getElementById('appFrame');
    if (frame) frame.classList.remove('is-wrapped-open');

    const iframe = document.getElementById('wrappedIframe');
    if (iframe) {
      iframe.src = 'about:blank';
    }

    if (navigateBack) {
      showScreen(5);
    }
  }

  // ================= SCREEN 8: HỒ SƠ =================
  function renderScreen8Profile() {
    setThemeColors(null);
    const count = state.collectedIds.length;
    const badgesCount = (count >= 5 ? 1 : 0) + (count >= 10 ? 1 : 0) + (count >= 15 ? 1 : 0);
    const secretsCount = state.unlockedSecrets.length;

    const nameEl = document.getElementById('profUserName');
    const statCards = document.getElementById('profStatCards');
    const statBadges = document.getElementById('profStatBadges');
    const statSecrets = document.getElementById('profStatSecrets');
    const authActionBtn = document.getElementById('profAuthActionBtn');
    const openWrappedBtn = document.getElementById('profOpenWrappedBtn');

    if (nameEl) nameEl.textContent = state.signedIn ? state.userName : 'Khách vãng lai';
    if (statCards) statCards.textContent = `${count}/15`;
    if (statBadges) statBadges.textContent = `${badgesCount}/3`;
    if (statSecrets) statSecrets.textContent = `${secretsCount}/3`;

    if (authActionBtn) {
      const span = authActionBtn.querySelector('span');
      const text = state.signedIn ? 'Đăng xuất' : 'Đăng nhập Google';
      if (span) span.textContent = text;
      else authActionBtn.textContent = text;
    }

    if (openWrappedBtn) {
      const unlocked = isWrappedUnlocked();
      openWrappedBtn.classList.add('btn-main');
      openWrappedBtn.classList.toggle('btn-accent', unlocked);
      openWrappedBtn.classList.toggle('btn-cream', !unlocked);
      const span = openWrappedBtn.querySelector('span');
      const label = unlocked ? 'Mở Tap Tap Wrapped' : 'Mở Wrapped (cần 15/15)';
      if (span) span.textContent = label;
      else openWrappedBtn.textContent = label;
    }
  }

  // ================= SCREEN 9: BẢN ĐỒ TRẠM NFC (LANDSCAPE MAP) =================
  function renderScreen9Map(focusStationId) {
    setThemeColors(null);
    const nextStation = getNextSuggestedStation();
    const nextTextEl = document.getElementById('mapNextStationText');
    const nextBtn = document.getElementById('mapNextSuggestionBtn');

    if (nextTextEl && nextStation) {
      nextTextEl.textContent = `#${String(nextStation.number).padStart(2, '0')} ${nextStation.name} • ${nextStation.zone}`;
    }
    if (nextBtn && nextStation) {
      nextBtn.onclick = () => openMapStationSheet(nextStation.id);
    }

    const pinsContainer = document.getElementById('mapPinsContainer');
    if (!pinsContainer || !appData) return;

    pinsContainer.innerHTML = appData.stations
      .map((st) => {
        const collected = isCollected(st.id);
        const isNext = nextStation && nextStation.id === st.id && !collected;
        const selected = selectedMapStationId === st.id;
        const numStr = String(st.number).padStart(2, '0');
        return `
          <button type="button"
            class="map-stamp-pin ${collected ? 'is-collected' : ''} ${isNext ? 'is-next' : ''} ${selected ? 'is-selected' : ''}"
            data-pin-station="${st.id}"
            style="left:${st.mapPin.x}%; top:${st.mapPin.y}%; --pin-pastel:${st.pastel};"
            aria-label="Trạm #${numStr} ${st.name}">
            <span class="pin-badge">${collected ? '✓' : numStr}</span>
          </button>
        `;
      })
      .join('');

    pinsContainer.querySelectorAll('[data-pin-station]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMapStationSheet(btn.dataset.pinStation);
      });
    });

    requestAnimationFrame(() => {
      setMapZoom(mapZoom);
      const targetId = focusStationId || (nextStation ? nextStation.id : null);
      if (targetId) {
        openMapStationSheet(targetId);
      }
    });
  }

  function openMapStationSheet(stationId) {
    const st = getStationById(stationId);
    if (!st) return;
    selectedMapStationId = st.id;

    document.querySelectorAll('.map-stamp-pin').forEach((pin) => {
      pin.classList.toggle('is-selected', pin.dataset.pinStation === st.id);
    });

    const sheet = document.getElementById('mapBottomSheet');
    const photoSlotEl = document.getElementById('mapSheetPhotoSlot');
    const titleEl = document.getElementById('mapSheetTitle');
    const zoneEl = document.getElementById('mapSheetZone');
    const primaryBtn = document.getElementById('mapSheetPrimaryBtn');

    if (photoSlotEl) photoSlotEl.textContent = st.name;
    if (titleEl) titleEl.textContent = `#${String(st.number).padStart(2, '0')} • ${st.name}`;
    if (zoneEl) zoneEl.textContent = st.zone;
    if (primaryBtn) {
      primaryBtn.textContent = 'Xem vị trí NFC';
      primaryBtn.onclick = () => {
        triggerNfcTapFlow(st.id);
      };
    }

    if (sheet) {
      sheet.classList.add('is-open');
    }

    notifyAskContext({ station: st, cardRevealed: true });
    panMapToStation(st, true);
  }

  // ================= MAP PAN + ZOOM =================
  const MAP_RATIO = 2752 / 1536;
  const MAP_MIN_ZOOM = 1;
  const MAP_MAX_ZOOM = 2.6;
  let mapZoom = 1;

  function getMapEls() {
    return {
      vp: document.getElementById('mapViewportCard'),
      canvas: document.getElementById('mapCanvasInner')
    };
  }

  function setMapZoom(nextZoom, fx, fy) {
    const { vp, canvas } = getMapEls();
    if (!vp || !canvas || !vp.clientHeight) return;
    const z = Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, nextZoom));
    const oldW = canvas.offsetWidth || vp.clientHeight * MAP_RATIO;
    const oldH = canvas.offsetHeight || vp.clientHeight;
    if (fx == null) fx = vp.clientWidth / 2;
    if (fy == null) fy = vp.clientHeight / 2;
    const relX = (vp.scrollLeft + fx) / oldW;
    const relY = (vp.scrollTop + fy) / oldH;

    const newH = vp.clientHeight * z;
    const newW = newH * MAP_RATIO;
    canvas.style.height = `${newH}px`;
    canvas.style.width = `${newW}px`;
    mapZoom = z;

    vp.scrollLeft = relX * newW - fx;
    if (z <= 1.02) {
      vp.scrollTop = 0;
    } else {
      vp.scrollTop = relY * newH - fy;
    }
  }

  function panMapToStation(st, smooth) {
    const { vp, canvas } = getMapEls();
    if (!vp || !canvas || !st || !st.mapPin) return;
    if (!canvas.style.height) setMapZoom(mapZoom);
    const px = (st.mapPin.x / 100) * canvas.offsetWidth;
    const py = (st.mapPin.y / 100) * canvas.offsetHeight;
    const maxScrollLeft = Math.max(0, canvas.offsetWidth - vp.clientWidth);
    const targetLeft = Math.max(0, Math.min(maxScrollLeft, px - vp.clientWidth / 2));
    const maxScrollTop = Math.max(0, canvas.offsetHeight - vp.clientHeight);
    const targetTop = maxScrollTop > 0 ? Math.max(0, Math.min(maxScrollTop, py - vp.clientHeight / 2)) : 0;
    vp.scrollTo({
      left: targetLeft,
      top: targetTop,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  function setupMapPanZoom() {
    const { vp } = getMapEls();
    if (!vp) return;

    const pointers = new Map();
    let panStart = null;
    let pinchStart = null;

    vp.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        panStart = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop, moved: false, id: e.pointerId };
      } else if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const rect = vp.getBoundingClientRect();
        pinchStart = {
          dist: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1,
          zoom: mapZoom,
          fx: (p1.x + p2.x) / 2 - rect.left,
          fy: (p1.y + p2.y) / 2 - rect.top
        };
        panStart = null;
      }
    });

    vp.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinchStart && pointers.size >= 2) {
        const [p1, p2] = [...pointers.values()];
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
        setMapZoom(pinchStart.zoom * (dist / pinchStart.dist), pinchStart.fx, pinchStart.fy);
        return;
      }

      if (panStart && e.pointerId === panStart.id) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        if (!panStart.moved && Math.hypot(dx, dy) > 6) {
          panStart.moved = true;
          vp.classList.add('is-panning');
          try { vp.setPointerCapture(e.pointerId); } catch (_) {}
        }
        if (panStart.moved) {
          vp.scrollLeft = panStart.left - dx;
          if (mapZoom > 1.02) {
            vp.scrollTop = panStart.top - dy;
          } else {
            vp.scrollTop = 0;
          }
        }
      }
    });

    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) {
        panStart = null;
        vp.classList.remove('is-panning');
      }
    };
    vp.addEventListener('pointerup', endPointer);
    vp.addEventListener('pointercancel', endPointer);

    vp.addEventListener(
      'wheel',
      (e) => {
        const rect = vp.getBoundingClientRect();
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setMapZoom(mapZoom * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
        } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          vp.scrollLeft += e.deltaY;
        }
      },
      { passive: false }
    );

    const zoomIn = document.getElementById('mapZoomInBtn');
    const zoomOut = document.getElementById('mapZoomOutBtn');
    if (zoomIn) zoomIn.addEventListener('click', () => setMapZoom(mapZoom * 1.35));
    if (zoomOut) zoomOut.addEventListener('click', () => setMapZoom(mapZoom / 1.35));

    window.addEventListener('resize', () => {
      if (currentScreen === 9) setMapZoom(mapZoom);
    });
  }

  // ================= HIDDEN DEV PANEL =================
  function setupDevPanel() {
    const logoBtn = document.getElementById('topBrandLogoBtn');
    const devBackdrop = document.getElementById('devModalBackdrop');
    const devCloseBtn = document.getElementById('devCloseBtn');
    const devStationList = document.getElementById('devStationButtons');

    let tapTimes = [];
    if (logoBtn) {
      logoBtn.addEventListener('click', () => {
        const now = performance.now();
        tapTimes = tapTimes.filter((t) => now - t < 900);
        tapTimes.push(now);
        if (tapTimes.length >= 3) {
          tapTimes = [];
          openDevPanel();
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      if ((e.key === 'D' || e.key === 'd') && e.shiftKey) {
        openDevPanel();
      }
    });

    if (devCloseBtn && devBackdrop) {
      devCloseBtn.addEventListener('click', () => devBackdrop.classList.remove('is-open'));
      devBackdrop.addEventListener('click', (e) => {
        if (e.target === devBackdrop) devBackdrop.classList.remove('is-open');
      });
    }

    if (devStationList && appData) {
      devStationList.innerHTML = appData.stations
        .map(
          (st) => `
          <button type="button" class="dev-chip-btn" data-dev-station="${st.id}">
            #${String(st.number).padStart(2, '0')} ${st.id}
          </button>
        `
        )
        .join('');

      devStationList.querySelectorAll('[data-dev-station]').forEach((btn) => {
        btn.addEventListener('click', () => {
          devBackdrop.classList.remove('is-open');
          triggerNfcTapFlow(btn.dataset.devStation);
        });
      });
    }

    document.querySelectorAll('[data-dev-fill]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const count = Number(btn.dataset.devFill);
        state.collectedIds = appData.stations.slice(0, count).map((s) => s.id);
        justWonStationId = count > 0 ? state.collectedIds[count - 1] : null;
        saveState();
        devBackdrop.classList.remove('is-open');
        showScreen(5);
      });
    });

    const devToggleSecretsBtn = document.getElementById('devToggleSecretsBtn');
    if (devToggleSecretsBtn) {
      devToggleSecretsBtn.addEventListener('click', () => {
        if (state.unlockedSecrets.length === 3) {
          state.unlockedSecrets = [];
        } else {
          state.unlockedSecrets = appData.secretCards.map((s) => s.id);
        }
        saveState();
        devBackdrop.classList.remove('is-open');
        showScreen(5);
      });
    }

    document.querySelectorAll('[data-dev-screen]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sc = Number(btn.dataset.devScreen);
        devBackdrop.classList.remove('is-open');
        showScreen(sc);
      });
    });
  }

  function openDevPanel() {
    const devBackdrop = document.getElementById('devModalBackdrop');
    if (devBackdrop) devBackdrop.classList.add('is-open');
  }

  // ================= EVENT BINDINGS =================
  function bindStaticEvents() {
    const topDexBtn = document.getElementById('topDexCounterBtn');
    if (topDexBtn) topDexBtn.addEventListener('click', () => showScreen(5));

    document.querySelectorAll('.nav-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        showScreen(Number(btn.dataset.target));
      });
    });

    // Screen 1 single primary CTA
    const homeTapNextBtn = document.getElementById('homeTapNextBtn');
    if (homeTapNextBtn) {
      homeTapNextBtn.addEventListener('click', () => {
        const nextSt = getNextSuggestedStation();
        triggerNfcTapFlow(nextSt ? nextSt.id : 'tiger');
      });
    }

    // Screen 2 fullscreen intro video
    const stVideo = document.getElementById('stationIntroVideo');
    if (stVideo) {
      stVideo.addEventListener('ended', finishStationIntroAndProceed);
      stVideo.addEventListener('click', () => {
        stVideo.muted = !stVideo.muted;
      });
    }

    // Screen 3 (Google Login)
    const googleLoginBtn = document.getElementById('mockGoogleSignInBtn');
    const skipLoginBtn = document.getElementById('skipLoginToCardBtn');
    if (googleLoginBtn) googleLoginBtn.addEventListener('click', handleMockGoogleSignIn);
    if (skipLoginBtn) {
      skipLoginBtn.addEventListener('click', () => {
        if (activeStation) {
          showScreen(4, { station: activeStation });
        } else {
          showScreen(1);
        }
      });
    }

    // Screen 4: Auth prompt buttons
    const cqGoogleBtn = document.getElementById('cqGoogleSignInBtn');
    const cqSkipBtn = document.getElementById('cqSkipAuthBtn');
    if (cqGoogleBtn) {
      cqGoogleBtn.addEventListener('click', () => {
        state.signedIn = true;
        state.userName = 'Minh Anh';
        saveState();
        showToast('Đã đăng nhập Google');
        proceedToPromptAfterAuth();
      });
    }
    if (cqSkipBtn) {
      cqSkipBtn.addEventListener('click', proceedToPromptAfterAuth);
    }

    // Screen 4: Soft optional challenge prompt buttons
    const cqPlayQuizBtn = document.getElementById('cqPlayQuizBtn');
    const cqLaterQuizBtn = document.getElementById('cqLaterQuizBtn');
    if (cqPlayQuizBtn) {
      cqPlayQuizBtn.addEventListener('click', () => {
        const promptBox = document.getElementById('cqChallengePrompt');
        const quizBox = document.getElementById('quizBox');
        if (promptBox) promptBox.style.display = 'none';
        if (quizBox) quizBox.style.display = 'flex';
      });
    }
    if (cqLaterQuizBtn) {
      cqLaterQuizBtn.addEventListener('click', () => {
        const promptBox = document.getElementById('cqChallengePrompt');
        const postWinActions = document.getElementById('cqPostWinActions');
        if (promptBox) promptBox.style.display = 'none';
        if (postWinActions) postWinActions.style.display = 'flex';
      });
    }

    // Screen 4 (Card + Quiz)
    const cqBackBtn = document.getElementById('cqBackBtn');
    const cqFlipBtn = document.getElementById('cqFlipCardBtn');
    const cqNextMapBtn = document.getElementById('cqNextMapBtn');
    const cqGoCollectionBtn = document.getElementById('cqGoCollectionBtn');
    if (cqBackBtn) cqBackBtn.addEventListener('click', () => showScreen(5));
    if (cqFlipBtn) {
      cqFlipBtn.addEventListener('click', () => {
        if (quizCard3D) quizCard3D.flipCard();
      });
    }
    if (cqNextMapBtn) {
      cqNextMapBtn.addEventListener('click', () => {
        const nextSt = getNextSuggestedStation();
        showScreen(9, { focusStationId: nextSt ? nextSt.id : null });
      });
    }
    if (cqGoCollectionBtn) {
      cqGoCollectionBtn.addEventListener('click', () => showScreen(5));
    }

    // Milestone Modal
    const milestoneModalCloseBtn = document.getElementById('milestoneModalCloseBtn');
    if (milestoneModalCloseBtn) {
      milestoneModalCloseBtn.addEventListener('click', closeMilestoneModal);
    }

    // Screen 5 (Collection)
    const openWrappedFromColBtn = document.getElementById('openWrappedFromColBtn');
    if (openWrappedFromColBtn) {
      openWrappedFromColBtn.addEventListener('click', () => showScreen(7));
    }

    // Screen 6 (Card Detail)
    const cdBackBtn = document.getElementById('cdBackColBtn');
    const cdFlipBtn = document.getElementById('cdFlipBtn');
    const cdChallengeBtn = document.getElementById('cdChallengeBtn');
    const cdPrevBtn = document.getElementById('cdPrevCardBtn');
    const cdNextBtn = document.getElementById('cdNextCardBtn');
    if (cdBackBtn) cdBackBtn.addEventListener('click', () => showScreen(5));
    if (cdFlipBtn) {
      cdFlipBtn.addEventListener('click', () => {
        if (detailCard3D) detailCard3D.flipCard();
      });
    }
    if (cdChallengeBtn) {
      cdChallengeBtn.addEventListener('click', () => {
        if (activeDetailCard) {
          showScreen(4, { station: activeDetailCard, openQuiz: true });
        }
      });
    }
    if (cdPrevBtn) cdPrevBtn.addEventListener('click', () => stepDetailCard(-1));
    if (cdNextBtn) cdNextBtn.addEventListener('click', () => stepDetailCard(1));

    // Screen 7 (Wrapped close button)
    const wrappedCloseBtn = document.getElementById('wrappedCloseBtn');
    if (wrappedCloseBtn) {
      wrappedCloseBtn.addEventListener('click', () => closeWrappedStory(true));
    }

    // Screen 8 (Profile)
    const profAuthActionBtn = document.getElementById('profAuthActionBtn');
    const profOpenWrappedBtn = document.getElementById('profOpenWrappedBtn');
    const profResetProgressBtn = document.getElementById('profResetProgressBtn');

    if (profAuthActionBtn) {
      profAuthActionBtn.addEventListener('click', () => {
        if (state.signedIn) {
          state.signedIn = false;
          saveState();
          renderScreen8Profile();
          showToast('Đã đăng xuất');
        } else {
          activeStation = null;
          showScreen(3);
        }
      });
    }

    if (profOpenWrappedBtn) {
      profOpenWrappedBtn.addEventListener('click', () => {
        if (isWrappedUnlocked()) {
          showScreen(7);
        } else {
          showToast('Cần đủ 15/15 thẻ thú để mở Wrapped!');
        }
      });
    }

    if (profResetProgressBtn) {
      profResetProgressBtn.addEventListener('click', () => {
        localStorage.removeItem(STORAGE_KEY);
        state = {
          ...defaultState,
          collectedIds: [],
          unlockedSecrets: [],
          quizCorrectCount: 0
        };
        saveState();
        showToast('Đã đặt lại tiến độ!');
        renderScreen8Profile();
        updateGlobalCounters();
      });
    }

    // Screen 9 (Map)
    const mapCloseSheetBtn = document.getElementById('mapCloseSheetBtn');
    if (mapCloseSheetBtn) {
      mapCloseSheetBtn.addEventListener('click', () => {
        const sheet = document.getElementById('mapBottomSheet');
        if (sheet) sheet.classList.remove('is-open');
      });
    }

    // Listen for close message from Wrapped iframe
    window.addEventListener('message', (e) => {
      if (e.data === 'taptap-wrapped-close' || (e.data && e.data.type === 'CLOSE_WRAPPED')) {
        closeWrappedStory(true);
      }
    });
  }

  async function initApp() {
    try {
      const res = await fetch('./data/stations.json');
      if (res.ok) {
        appData = await res.json();
      } else {
        appData = window.TAPTAP_FALLBACK_DATA;
      }
    } catch (_) {
      appData = window.TAPTAP_FALLBACK_DATA;
    }

    const params = new URLSearchParams(window.location.search);
    const hasStored = !!localStorage.getItem(STORAGE_KEY);

    // If ?demo=full is present, immediately unlock 15/15 cards & secrets
    if (params.get('demo') === 'full') {
      window.TapTapApp.setDemoState(15);
    } else if (!hasStored) {
      // Default state is EMPTY (0/15, no pre-seeded collected cards)
      state = {
        ...defaultState,
        signedIn: false,
        userName: 'Minh Anh',
        collectedIds: [],
        unlockedSecrets: [],
        quizCorrectCount: 0,
        favoriteStationId: 'tiger'
      };
      saveState();
    }

    updateGlobalCounters();
    bindStaticEvents();
    setupDevPanel();
    setupMapPanZoom();

    const stationParam = params.get('station');
    const screenParam = Number(params.get('screen'));

    if (stationParam) {
      triggerNfcTapFlow(stationParam);
      return;
    }

    if (screenParam >= 1 && screenParam <= 9) {
      showScreen(screenParam);
      return;
    }

    showScreen(1);
  }

  window.TapTapApp = {
    showScreen,
    triggerNfcTapFlow,
    finishStationIntroAndProceed,
    openDevPanel,
    showMilestoneModal,
    tiltDetailCard() {
      if (detailCard3D) detailCard3D.startGentleShowcaseTilt(-11, 14);
    },
    setDemoState(count = 10) {
      if (!appData) return;
      state.signedIn = true;
      state.userName = 'Minh Anh';
      if (count >= 15) {
        state.collectedIds = appData.stations.map((s) => s.id);
        state.unlockedSecrets = appData.secretCards.map((s) => s.id);
        state.quizCorrectCount = 15;
      } else {
        const DEMO_IDS = ['elephant', 'giraffe', 'capybara', 'meerkat', 'sunbear', 'raccoon', 'rhino', 'gibbon', 'flamingo', 'peafowl'];
        state.collectedIds = DEMO_IDS.filter((id) => getStationById(id));
        state.unlockedSecrets = ['mika'];
        state.quizCorrectCount = 10;
      }
      state.favoriteStationId = 'capybara';
      justWonStationId = null;
      activeDetailCard = null;
      activeStation = getStationById('tiger');
      saveState();
    },
    setProgress(count, unlockSecrets = false) {
      if (!appData) return;
      state.signedIn = true;
      state.userName = 'Minh Anh';
      state.collectedIds = appData.stations.slice(0, count).map((s) => s.id);
      if (unlockSecrets) {
        state.unlockedSecrets = appData.secretCards.map((s) => s.id);
      } else {
        state.unlockedSecrets = [];
      }
      saveState();
    }
  };

  window.addEventListener('DOMContentLoaded', initApp);
})();
