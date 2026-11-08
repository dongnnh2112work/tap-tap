/* ==========================================================================
   Tap Tap — Reusable Card Motion v7 Component (js/card-motion.js)
   Uses tightly cropped art-only images (assets/cards/art/<slug>.png) with
   object-fit: cover, HTML animal name, transparent logo on back, and motion-v7.
   ========================================================================== */

(function (global) {
  'use strict';

  const MAX_TILT_DEG = 22;

  class TapTapCard3D {
    constructor(mountEl, options = {}) {
      this.mountEl = mountEl;
      this.options = options;
      this.isFlipped = false;
      this.isRevealing = false;
      this.isFlipping = false;
      this.isDragging = false;
      this.autoDemoActive = false;
      this.demoRafId = null;
      this.demoStartTime = 0;

      this.tiltState = { rotX: 0, rotY: 0, flipY: 0, scale: 1 };
      this.holoState = {
        glareX: 50, glareY: 50,
        specX: 50, specY: 50, specAngle: 126,
        holoX: 50, holoY: 50, holoAngle: 118,
        specOpacity: 0, holoOpacity: 0, glareOpacity: 0
      };

      this._buildDOM();
      this._initQuickHolo();
      this._bindEvents();
    }

    _buildDOM() {
      this.mountEl.innerHTML = `
        <div class="tt-card-stage">
          <div class="nfc-ripple-stage" aria-hidden="true">
            <div class="nfc-ring nfc-ring-1"></div>
            <div class="nfc-ring nfc-ring-2"></div>
            <div class="nfc-ring nfc-ring-3"></div>
          </div>

          <div class="particles-layer" aria-hidden="true"></div>

          <div class="card-fly-wrapper">
            <div class="card-ground-shadow"></div>
            <div class="card-tilt-stage">
              <div class="card-rotator">
                <div class="card-edge-plate"></div>

                <!-- FRONT SIDE -->
                <div class="card-face card-face-front">
                  <div class="card-art-viewport">
                    <img class="card-art-img" src="" alt="" draggable="false" />
                  </div>

                  <div class="card-paper-frame">
                    <span class="card-top-stamp js-code-stamp">#01</span>
                    <div class="art-window-bevel"></div>
                  </div>

                  <div class="card-caption-plate">
                    <div class="card-series-tag js-zone-tag">Khu vực</div>
                    <h2 class="card-animal-name js-animal-name">Tên thú</h2>
                  </div>

                  <div class="card-paper-texture"></div>
                  <div class="card-holo-specular"></div>
                  <div class="card-holo-rainbow"></div>
                  <div class="card-holo-glare"></div>
                </div>

                <!-- BACK SIDE -->
                <div class="card-face card-face-back">
                  <div class="back-ornament-frame"></div>

                  <div class="back-header">
                    <img class="back-logo-img" src="assets/logo/taptap_logo_brown_transparent.webp" alt="Tap Tap" />
                  </div>

                  <div class="back-fact-card">
                    <h3 class="back-animal-title js-back-title">Tên thú</h3>
                    <p class="back-fact-text js-back-fact"></p>
                  </div>

                  <div class="card-paper-texture"></div>
                  <div class="card-holo-specular"></div>
                  <div class="card-holo-rainbow"></div>
                  <div class="card-holo-glare"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      this.stageEl = this.mountEl.querySelector('.tt-card-stage');
      this.nfcRing1 = this.stageEl.querySelector('.nfc-ring-1');
      this.nfcRing2 = this.stageEl.querySelector('.nfc-ring-2');
      this.nfcRing3 = this.stageEl.querySelector('.nfc-ring-3');
      this.particlesLayer = this.stageEl.querySelector('.particles-layer');
      this.cardFlyWrapper = this.stageEl.querySelector('.card-fly-wrapper');
      this.cardRotator = this.stageEl.querySelector('.card-rotator');
      this.cardFront = this.stageEl.querySelector('.card-face-front');
      this.cardBack = this.stageEl.querySelector('.card-face-back');
      this.cardArtImg = this.stageEl.querySelector('.card-art-img');
      this.cardPaperFrame = this.stageEl.querySelector('.card-paper-frame');
      this.artWindowBevel = this.stageEl.querySelector('.art-window-bevel');
      this.cardCaptionPlate = this.stageEl.querySelector('.card-caption-plate');
      this.backFactCard = this.stageEl.querySelector('.back-fact-card');
      this.codeStampEl = this.stageEl.querySelector('.js-code-stamp');
      this.zoneTagEl = this.stageEl.querySelector('.js-zone-tag');
      this.animalNameEl = this.stageEl.querySelector('.js-animal-name');
      this.backTitleEl = this.stageEl.querySelector('.js-back-title');
      this.backFactEl = this.stageEl.querySelector('.js-back-fact');

      this.motes = [];
      for (let i = 0; i < 12; i++) {
        const m = document.createElement('div');
        m.className = 'mote';
        this.particlesLayer.appendChild(m);
        this.motes.push(m);
      }
    }

    _syncHoloVars() {
      const s = this.stageEl.style;
      const h = this.holoState;
      s.setProperty('--glare-x', `${h.glareX.toFixed(2)}%`);
      s.setProperty('--glare-y', `${h.glareY.toFixed(2)}%`);
      s.setProperty('--spec-x', `${h.specX.toFixed(2)}%`);
      s.setProperty('--spec-y', `${h.specY.toFixed(2)}%`);
      s.setProperty('--spec-angle', `${h.specAngle.toFixed(2)}deg`);
      s.setProperty('--holo-x', `${h.holoX.toFixed(2)}%`);
      s.setProperty('--holo-y', `${h.holoY.toFixed(2)}%`);
      s.setProperty('--holo-angle', `${h.holoAngle.toFixed(2)}deg`);
      s.setProperty('--spec-opacity', h.specOpacity.toFixed(3));
      s.setProperty('--holo-opacity', h.holoOpacity.toFixed(3));
      s.setProperty('--glare-opacity', h.glareOpacity.toFixed(3));
    }

    _initQuickHolo() {
      const update = () => this._syncHoloVars();
      if (global.gsap) {
        const h = this.holoState;
        this.quickHolo = {
          glareX: gsap.quickTo(h, 'glareX', { duration: 0.26, ease: 'power3.out', onUpdate: update }),
          glareY: gsap.quickTo(h, 'glareY', { duration: 0.26, ease: 'power3.out', onUpdate: update }),
          specX: gsap.quickTo(h, 'specX', { duration: 0.32, ease: 'power3.out', onUpdate: update }),
          specY: gsap.quickTo(h, 'specY', { duration: 0.32, ease: 'power3.out', onUpdate: update }),
          specAngle: gsap.quickTo(h, 'specAngle', { duration: 0.34, ease: 'power3.out', onUpdate: update }),
          holoX: gsap.quickTo(h, 'holoX', { duration: 0.36, ease: 'power3.out', onUpdate: update }),
          holoY: gsap.quickTo(h, 'holoY', { duration: 0.36, ease: 'power3.out', onUpdate: update }),
          holoAngle: gsap.quickTo(h, 'holoAngle', { duration: 0.36, ease: 'power3.out', onUpdate: update }),
          specOpacity: gsap.quickTo(h, 'specOpacity', { duration: 0.3, ease: 'power2.out', onUpdate: update }),
          holoOpacity: gsap.quickTo(h, 'holoOpacity', { duration: 0.3, ease: 'power2.out', onUpdate: update }),
          glareOpacity: gsap.quickTo(h, 'glareOpacity', { duration: 0.3, ease: 'power2.out', onUpdate: update })
        };
      } else {
        this.quickHolo = null;
      }
    }

    updateHoloTextMasks() {
      const pct = (v, h) => `${Math.max(0, Math.min(100, (v / h) * 100)).toFixed(2)}%`;
      const topIn = (el, face) => {
        let y = 0, n = el;
        while (n && n !== face) { y += n.offsetTop; n = n.offsetParent; }
        return y;
      };
      if (this.cardFront && this.cardFront.offsetHeight) {
        this.cardFront.style.setProperty(
          '--mf-text-top',
          pct(topIn(this.cardCaptionPlate, this.cardFront) - 4, this.cardFront.offsetHeight)
        );
      }
      if (this.cardBack && this.cardBack.offsetHeight) {
        const H = this.cardBack.offsetHeight;
        const head = this.cardBack.querySelector('.back-header');
        const fact = this.cardBack.querySelector('.back-fact-card');
        if (head) this.cardBack.style.setProperty('--mb-head-end', pct(topIn(head, this.cardBack) + head.offsetHeight + 4, H));
        if (fact) {
          this.cardBack.style.setProperty('--mb-fact-top', pct(topIn(fact, this.cardBack) - 4, H));
          this.cardBack.style.setProperty('--mb-fact-end', pct(topIn(fact, this.cardBack) + fact.offsetHeight + 4, H));
        }
      }
    }

    setCardData(card) {
      this.currentCard = card;
      this.isFlipped = false;
      this.tiltState.rotX = 0;
      this.tiltState.rotY = 0;
      this.tiltState.flipY = 0;
      this.tiltState.scale = 1;

      this.stageEl.style.setProperty('--theme-pastel', card.pastel || '#ffd5c2');
      this.stageEl.style.setProperty('--theme-accent', card.accent || '#d95326');
      this.stageEl.style.setProperty('--theme-glow', card.glow || 'rgba(255,213,194,0.7)');

      this.codeStampEl.textContent = card.code || `#${String(card.number || 1).padStart(2, '0')}`;
      this.zoneTagEl.textContent = card.zone || 'Thảo Cầm Viên';
      this.animalNameEl.textContent = card.name;
      this.backTitleEl.textContent = card.name;
      this.backFactEl.textContent = card.funFact;

      this.cardArtImg.src = card.cardArt;
      this.cardArtImg.alt = card.name;

      this.renderCard3D();
      requestAnimationFrame(() => this.updateHoloTextMasks());
    }

    renderCard3D() {
      const rx = this.tiltState.rotX;
      const ry = this.tiltState.rotY;
      const totalY = ry + this.tiltState.flipY;

      this.cardRotator.style.transform =
        `rotateX(${rx.toFixed(2)}deg) rotateY(${totalY.toFixed(2)}deg) scale3d(${this.tiltState.scale.toFixed(3)}, ${this.tiltState.scale.toFixed(3)}, 1)`;

      const normX = Math.max(-1, Math.min(1, ry / MAX_TILT_DEG));
      const normY = Math.max(-1, Math.min(1, -rx / MAX_TILT_DEG));

      // Subtle parallax: full art at rest, tiny overscan only while tilting
      const parallaxMag = Math.min(1, Math.hypot(normX, normY));
      const artShiftX = -normX * 4;
      const artShiftY = -normY * 4;
      const artScale = 1 + parallaxMag * 0.04;
      this.cardArtImg.style.transform = `translate3d(${artShiftX.toFixed(1)}px, ${artShiftY.toFixed(1)}px, 0px) scale(${artScale.toFixed(3)})`;

      const frameShiftX = normX * 3;
      const frameShiftY = normY * 3;
      this.cardPaperFrame.style.transform = `translate3d(${frameShiftX.toFixed(1)}px, ${frameShiftY.toFixed(1)}px, 0px)`;
      this.artWindowBevel.style.boxShadow =
        `inset ${(-normX * 5).toFixed(1)}px ${(-normY * 5 + 2).toFixed(1)}px 7px rgba(44, 34, 30, 0.14), ` +
        `inset 0 0 0 1px rgba(44, 34, 30, 0.07), 0 0 0 18px #ffffff`;

      this.cardCaptionPlate.style.transform = `translate3d(${(normX * 4).toFixed(1)}px, ${(normY * 4).toFixed(1)}px, 0px)`;
      this.backFactCard.style.transform = `translate3d(${(-normX * 4).toFixed(1)}px, ${(normY * 4).toFixed(1)}px, 0px)`;

      const targetGlareX = 50 - normX * 36;
      const targetGlareY = 48 - normY * 36;
      const targetSpecX = 50 + normX * 26 - normY * 12;
      const targetSpecY = 50 + normY * 26 - normX * 10;
      const targetSpecAngle = 126 + normX * 18 - normY * 12;
      const targetHoloX = 50 - normX * 28;
      const targetHoloY = 50 - normY * 28;
      const targetHoloAngle = 118 - normX * 20 + normY * 14;

      const tiltMagnitude = Math.min(1.0, Math.hypot(normX, normY));
      const tiltEase = tiltMagnitude * tiltMagnitude * (3 - 2 * tiltMagnitude);
      const targetSpecOpacity = Math.min(0.95, tiltEase * 1.1);
      const targetHoloOpacity = Math.max(0, (tiltMagnitude - 0.25) / 0.75) ** 1.4 * 0.55;
      const targetGlareOpacity = tiltEase * 0.22;

      if (this.quickHolo) {
        this.quickHolo.glareX(targetGlareX);
        this.quickHolo.glareY(targetGlareY);
        this.quickHolo.specX(targetSpecX);
        this.quickHolo.specY(targetSpecY);
        this.quickHolo.specAngle(targetSpecAngle);
        this.quickHolo.holoX(targetHoloX);
        this.quickHolo.holoY(targetHoloY);
        this.quickHolo.holoAngle(targetHoloAngle);
        this.quickHolo.specOpacity(targetSpecOpacity);
        this.quickHolo.holoOpacity(targetHoloOpacity);
        this.quickHolo.glareOpacity(targetGlareOpacity);
      } else {
        Object.assign(this.holoState, {
          glareX: targetGlareX, glareY: targetGlareY,
          specX: targetSpecX, specY: targetSpecY, specAngle: targetSpecAngle,
          holoX: targetHoloX, holoY: targetHoloY, holoAngle: targetHoloAngle,
          specOpacity: targetSpecOpacity, holoOpacity: targetHoloOpacity, glareOpacity: targetGlareOpacity
        });
        this._syncHoloVars();
      }

      const shadowX = -normX * 18;
      const shadowY = 20 + normY * 12;
      const shadowBlur = 32 + tiltMagnitude * 10;
      this.stageEl.style.setProperty('--shadow-x', `${shadowX.toFixed(1)}px`);
      this.stageEl.style.setProperty('--shadow-y', `${shadowY.toFixed(1)}px`);
      this.stageEl.style.setProperty('--shadow-blur', `${shadowBlur.toFixed(1)}px`);
    }

    burstParticles() {
      if (!global.gsap || !this.currentCard) return;
      const accent = this.currentCard.accent || '#d95326';
      const pastel = this.currentCard.pastel || '#ffd5c2';
      this.motes.forEach((mote, i) => {
        const angle = (i / this.motes.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
        const dist = 105 + Math.random() * 55;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;
        const size = 6 + Math.round(Math.random() * 6);
        mote.style.width = `${size}px`;
        mote.style.height = `${size}px`;
        mote.style.background = i % 2 === 0 ? accent : pastel;

        gsap.killTweensOf(mote);
        gsap.fromTo(
          mote,
          { x: 0, y: 0, scale: 0.2, opacity: 0.95 },
          { x: tx, y: ty, scale: 1, opacity: 0, duration: 0.7 + Math.random() * 0.2, ease: 'power3.out' }
        );
      });
    }

    playPopReveal(onLanded) {
      if (!global.gsap) {
        this.cardFlyWrapper.style.opacity = '1';
        this.isRevealing = false;
        if (typeof onLanded === 'function') onLanded();
        return;
      }

      this.isRevealing = true;
      gsap.killTweensOf(this.tiltState);
      gsap.killTweensOf(this.cardFlyWrapper);
      gsap.killTweensOf([this.nfcRing1, this.nfcRing2, this.nfcRing3]);

      gsap.set(this.cardFlyWrapper, {
        opacity: 0,
        y: 160,
        z: -220,
        scale: 0.42,
        rotationZ: -6
      });
      gsap.set([this.nfcRing1, this.nfcRing2, this.nfcRing3], { scale: 0.35, opacity: 0.85 });

      const tl = gsap.timeline({
        onComplete: () => {
          this.isRevealing = false;
          this.updateHoloTextMasks();
          if (typeof onLanded === 'function') onLanded();
        }
      });

      tl.to([this.nfcRing1, this.nfcRing2, this.nfcRing3], {
        scale: (i) => 2.0 + i * 0.48,
        opacity: 0,
        duration: 0.4,
        stagger: 0.05,
        ease: 'power2.out'
      }, 0);

      tl.add(() => this.burstParticles(), 0.14);

      tl.to(this.cardFlyWrapper, { opacity: 1, duration: 0.14, ease: 'none' }, 0.12);
      tl.to(this.cardFlyWrapper, {
        y: 0,
        z: 0,
        scale: 1,
        rotationZ: 0,
        duration: 0.82,
        ease: 'elastic.out(1, 0.58)'
      }, 0.12);

      tl.fromTo(
        this.tiltState,
        { rotX: 22, rotY: -20 },
        {
          rotX: 0,
          rotY: 0,
          duration: 0.86,
          ease: 'elastic.out(1, 0.52)',
          onUpdate: () => this.renderCard3D()
        },
        0.12
      );
    }

    flipCard() {
      if (this.isRevealing) return;
      this.isFlipped = !this.isFlipped;
      this.isFlipping = true;
      const targetFlipY = this.isFlipped ? 180 : 0;

      if (!global.gsap) {
        this.tiltState.flipY = targetFlipY;
        this.isFlipping = false;
        this.renderCard3D();
        return;
      }

      gsap.to(this.tiltState, {
        flipY: targetFlipY,
        rotX: 0,
        rotY: 0,
        duration: 0.65,
        ease: 'back.out(1.35)',
        overwrite: 'auto',
        onUpdate: () => this.renderCard3D(),
        onComplete: () => {
          this.isFlipping = false;
        }
      });

      gsap.fromTo(
        this.tiltState,
        { scale: 1 },
        {
          scale: 1.05,
          duration: 0.18,
          yoyo: true,
          repeat: 1,
          ease: 'power2.out',
          onUpdate: () => this.renderCard3D()
        }
      );
    }

    springReturnToCenter() {
      if (!global.gsap) {
        this.tiltState.rotX = 0;
        this.tiltState.rotY = 0;
        this.tiltState.scale = 1;
        this.renderCard3D();
        return;
      }
      gsap.to(this.tiltState, {
        rotX: 0,
        rotY: 0,
        scale: 1,
        duration: 0.8,
        ease: 'elastic.out(1, 0.5)',
        overwrite: 'auto',
        onUpdate: () => this.renderCard3D()
      });
    }

    updateTiltFromPointer(clientX, clientY) {
      const rect = this.cardFlyWrapper.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = Math.max(-1.25, Math.min(1.25, (clientX - centerX) / (rect.width * 0.5)));
      const dy = Math.max(-1.25, Math.min(1.25, (clientY - centerY) / (rect.height * 0.5)));

      const targetRotY = dx * MAX_TILT_DEG;
      const targetRotX = -dy * MAX_TILT_DEG;

      if (global.gsap) {
        gsap.to(this.tiltState, {
          rotX: targetRotX,
          rotY: targetRotY,
          scale: 1.022,
          duration: 0.16,
          ease: 'power2.out',
          overwrite: 'auto',
          onUpdate: () => this.renderCard3D()
        });
      } else {
        this.tiltState.rotX = targetRotX;
        this.tiltState.rotY = targetRotY;
        this.renderCard3D();
      }
    }

    _bindEvents() {
      let pointerDownInfo = null;

      this.cardFlyWrapper.addEventListener('pointerdown', (e) => {
        if (this.isRevealing) return;
        this.isDragging = true;
        pointerDownInfo = { x: e.clientX, y: e.clientY, time: performance.now(), moved: false };
        try { this.cardFlyWrapper.setPointerCapture(e.pointerId); } catch (_) {}
      });

      this.cardFlyWrapper.addEventListener('pointermove', (e) => {
        if (this.isRevealing) return;
        if (this.isDragging && pointerDownInfo) {
          if (Math.hypot(e.clientX - pointerDownInfo.x, e.clientY - pointerDownInfo.y) > 7) {
            pointerDownInfo.moved = true;
          }
          if (pointerDownInfo.moved) {
            this.updateTiltFromPointer(e.clientX, e.clientY);
          }
        } else if (e.pointerType === 'mouse' && !this.autoDemoActive) {
          this.updateTiltFromPointer(e.clientX, e.clientY);
        }
      });

      const onEnd = () => {
        if (!this.isDragging) return;
        this.isDragging = false;
        const info = pointerDownInfo;
        pointerDownInfo = null;
        if (info && !info.moved && performance.now() - info.time < 450) {
          this.flipCard();
        } else if (!this.autoDemoActive) {
          this.springReturnToCenter();
        }
      };

      this.cardFlyWrapper.addEventListener('pointerup', onEnd);
      this.cardFlyWrapper.addEventListener('pointercancel', onEnd);
      this.cardFlyWrapper.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse' && !this.isDragging && !this.autoDemoActive) {
          this.springReturnToCenter();
        }
      });
    }

    startGentleShowcaseTilt(degX = -11, degY = 14) {
      if (global.gsap) {
        gsap.to(this.tiltState, {
          rotX: degX,
          rotY: degY,
          scale: 1.02,
          duration: 0.45,
          ease: 'power2.out',
          onUpdate: () => this.renderCard3D()
        });
      }
    }
  }

  global.TapTapCard3D = TapTapCard3D;
})(window);
