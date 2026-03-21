// ==UserScript==
// @name         Photofeeler Auto-Submit
// @namespace    https://github.com/SokolskyNikita/misc-scripts
// @version      3.2
// @description  Auto-fills Photofeeler setup with robust, persistent in-page settings UI
// @match        https://www.photofeeler.com/*
// @homepageURL  https://github.com/SokolskyNikita/misc-scripts
// @supportURL   https://github.com/SokolskyNikita/misc-scripts/issues
// @updateURL    https://raw.githubusercontent.com/SokolskyNikita/misc-scripts/main/tampermonkey/photofeeler-auto-submit.js
// @downloadURL  https://raw.githubusercontent.com/SokolskyNikita/misc-scripts/main/tampermonkey/photofeeler-auto-submit.js
// @run-at       document-idle
// @noframes
// @require      https://cdn.jsdelivr.net/npm/nouislider@15.8.1/dist/nouislider.min.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

"use strict";

(function main() {
  const LOG_PREFIX = "[PF Auto-Submit]";
  const STORAGE_KEY = "pfAutoSubmitSettingsV1";
  const UI = {
    hostId: "pf-auto-submit-settings-host",
    menuLabel: "Open Photofeeler Auto-Submit settings",
    shortcutLabel: "Alt+Shift+P",
  };
  const SELECTORS = {
    categoryPanel: ".panel-new-category-25b",
    subjectForm: "form.panel-subject",
    targetForm: "form.panel-target",
    testSizePanel: ".panel-test-size-25",
    testSizeOption: ".menu-option-25",
    testSizeLabel: ".size-label",
    nextButton: 'button[type="submit"]',
  };

  const VALID = Object.freeze({
    category: ["dating", "business", "social"],
    subjectGender: ["MALE", "FEMALE"],
    votersGender: ["MALE", "FEMALE", "BOTH"],
    testSize: [0, 10, 20, 40, 80],
  });

  const CREDIT_LABEL = Object.freeze({
    0: "Karma Test",
    10: "Rough Test",
    20: "Standard Test",
    40: "Precise Test",
    80: "Very Precise Test",
  });
  const AGE_MAX_LABEL = Object.freeze({
    1: 24,
    2: 29,
    3: 34,
    4: 44,
  });
  const AGE_MIN_LABEL = Object.freeze({
    1: 25,
    2: 30,
    3: 35,
    4: 45,
  });
  const DEFAULT_SETTINGS = deepFreeze({
    category: "dating",
    subject: { gender: "MALE", age: 28 },
    voters: { gender: "FEMALE", ageSliderMin: 0, ageSliderMax: 2 },
    testSize: 20,
    autoNext: true,
  });

  const state = {
    settings: clone(DEFAULT_SETTINGS),
    loaded: false,
    flow: { category: false, subject: false, target: false, testSize: false },
    categoryVisiblePreviously: false,
    observerDebounce: null,
  };

  function deepFreeze(obj) {
    Object.freeze(obj);
    Object.getOwnPropertyNames(obj).forEach((prop) => {
      const value = obj[prop];
      if (value && typeof value === "object" && !Object.isFrozen(value)) {
        deepFreeze(value);
      }
    });
    return obj;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function toInt(value, fallback) {
    const n = Number(value);
    return Number.isInteger(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function triggerEvents(el, ...types) {
    types.forEach((type) => {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }

  function clickIfPossible(el) {
    if (el && typeof el.click === "function") {
      el.click();
      return true;
    }
    return false;
  }

  function findVisible(root, selector) {
    return [...root.querySelectorAll(selector)].find((el) => isVisible(el)) || null;
  }

  function schedule(delayMs, fn) {
    setTimeout(fn, delayMs);
  }

  function sanitizeSettings(raw) {
    const src = raw && typeof raw === "object" ? raw : {};

    const category = VALID.category.includes(src.category)
      ? src.category
      : DEFAULT_SETTINGS.category;

    const subjectGender = VALID.subjectGender.includes(src.subject?.gender)
      ? src.subject.gender
      : DEFAULT_SETTINGS.subject.gender;
    const subjectAge = clamp(
      toInt(src.subject?.age, DEFAULT_SETTINGS.subject.age),
      18,
      99,
    );

    const votersGender = VALID.votersGender.includes(src.voters?.gender)
      ? src.voters.gender
      : DEFAULT_SETTINGS.voters.gender;

    let ageSliderMin = clamp(
      toInt(src.voters?.ageSliderMin, DEFAULT_SETTINGS.voters.ageSliderMin),
      0,
      5,
    );
    let ageSliderMax = clamp(
      toInt(src.voters?.ageSliderMax, DEFAULT_SETTINGS.voters.ageSliderMax),
      1,
      5,
    );
    if (ageSliderMin > ageSliderMax) ageSliderMin = ageSliderMax;

    const testSizeRaw = toInt(src.testSize, Number.NaN);
    const testSize = VALID.testSize.includes(testSizeRaw)
      ? testSizeRaw
      : DEFAULT_SETTINGS.testSize;

    const autoNext =
      typeof src.autoNext === "boolean" ? src.autoNext : DEFAULT_SETTINGS.autoNext;

    return {
      category,
      subject: { gender: subjectGender, age: subjectAge },
      voters: { gender: votersGender, ageSliderMin, ageSliderMax },
      testSize,
      autoNext,
    };
  }

  function formatAgeRangeLabel(min, max) {
    if (min === 0 && max === 5) return "All ages";
    if (min === 0 && AGE_MAX_LABEL[max]) return `Up to ${AGE_MAX_LABEL[max]}`;
    if (max === 5 && AGE_MIN_LABEL[min]) return `${AGE_MIN_LABEL[min]} and up`;
    if (AGE_MIN_LABEL[min] && AGE_MAX_LABEL[max]) {
      return `${AGE_MIN_LABEL[min]} to ${AGE_MAX_LABEL[max]}`;
    }
    return `Slider steps ${min}..${max}`;
  }

  function normalizeRange(min, max) {
    let clampedMin = clamp(toInt(min, DEFAULT_SETTINGS.voters.ageSliderMin), 0, 4);
    let clampedMax = clamp(toInt(max, DEFAULT_SETTINGS.voters.ageSliderMax), 1, 5);
    if (clampedMax <= clampedMin) {
      if (clampedMin >= 4) {
        clampedMin = 4;
        clampedMax = 5;
      } else {
        clampedMax = clampedMin + 1;
      }
    }
    return { min: clampedMin, max: clampedMax };
  }

  async function gmGetValue(key, fallback) {
    if (typeof GM_getValue !== "function") return fallback;
    const result = GM_getValue(key, fallback);
    return result && typeof result.then === "function" ? await result : result;
  }

  async function gmSetValue(key, value) {
    if (typeof GM_setValue !== "function") return;
    const result = GM_setValue(key, value);
    if (result && typeof result.then === "function") {
      await result;
    }
  }

  const store = {
    async init() {
      const stored = await gmGetValue(STORAGE_KEY, DEFAULT_SETTINGS);
      state.settings = sanitizeSettings(stored);
      state.loaded = true;
      await gmSetValue(STORAGE_KEY, state.settings);
      log("settings loaded", state.settings);
    },
    get() {
      return state.settings;
    },
    async save(next) {
      state.settings = sanitizeSettings(next);
      await gmSetValue(STORAGE_KEY, state.settings);
    },
    async reset() {
      await this.save(DEFAULT_SETTINGS);
    },
  };

  const automation = {
    resetFlow() {
      state.flow = { category: false, subject: false, target: false, testSize: false };
      state.categoryVisiblePreviously = false;
    },

    run() {
      if (!state.loaded) return;
      this.handleCategory();
      this.handleSubject();
      this.handleTarget();
      this.handleTestSize();
    },

    scheduleRun(delayMs = 250) {
      clearTimeout(state.observerDebounce);
      state.observerDebounce = setTimeout(() => this.run(), delayMs);
    },

    startObserver() {
      new MutationObserver(() => this.scheduleRun(250)).observe(
        document.documentElement,
        { childList: true, subtree: true },
      );
    },

    handleCategory() {
      const panel = document.querySelector(SELECTORS.categoryPanel);
      const visible = !!panel && isVisible(panel);

      if (!visible) {
        state.categoryVisiblePreviously = false;
        return false;
      }

      if (!state.categoryVisiblePreviously) {
        this.resetFlow();
        state.categoryVisiblePreviously = true;
      }

      if (state.flow.category) return false;

      const target = panel.querySelector(`.category.${store.get().category}`);
      if (!target) {
        warn("category not found", store.get().category);
        return false;
      }

      target.click();
      state.flow.category = true;
      log("clicked category", store.get().category);
      return true;
    },

    handleSubject() {
      if (!state.flow.category || state.flow.subject) return false;

      const form = findVisible(document, SELECTORS.subjectForm);
      if (!form) return false;

      const [genderSelect, ageSelect] = form.querySelectorAll("select.native");
      if (!genderSelect || !ageSelect) return false;

      const settings = store.get();
      const targetAge = String(settings.subject.age);

      if (genderSelect.value !== settings.subject.gender) {
        genderSelect.value = settings.subject.gender;
        triggerEvents(genderSelect, "input", "change");
      }

      if (ageSelect.value !== targetAge) {
        ageSelect.value = targetAge;
        triggerEvents(ageSelect, "input", "change");
      }

      if (
        genderSelect.value !== settings.subject.gender ||
        ageSelect.value !== targetAge
      ) {
        return false;
      }

      state.flow.subject = true;
      log("subject filled", `${settings.subject.gender}, ${settings.subject.age}`);

      if (settings.autoNext) {
        schedule(150, () => {
          clickIfPossible(form.querySelector(SELECTORS.nextButton));
          log("clicked Next (subject)");
        });
      }
      return true;
    },

    handleTarget() {
      if (!state.flow.subject || state.flow.target) return false;

      const form = findVisible(document, SELECTORS.targetForm);
      if (!form) return false;

      const settings = store.get();

      const radio = form.querySelector(
        `input[name="target-gender"][value="${settings.voters.gender}"]`,
      );
      if (radio && !radio.checked) {
        clickIfPossible(radio.closest("label")) || clickIfPossible(radio);
      }

      const slider = form.querySelector(".pf-slider");
      if (slider?.noUiSlider) {
        const raw = slider.noUiSlider.get();
        const values = Array.isArray(raw) ? raw.map(Number) : [Number(raw)];
        if (
          values.length > 1 &&
          (values[0] !== settings.voters.ageSliderMin ||
            values[1] !== settings.voters.ageSliderMax)
        ) {
          slider.noUiSlider.set([
            settings.voters.ageSliderMin,
            settings.voters.ageSliderMax,
          ]);
        }
      }

      state.flow.target = true;
      log(
        "voters filled",
        `${settings.voters.gender}, slider max ${settings.voters.ageSliderMax}`,
      );

      if (settings.autoNext) {
        schedule(150, () => {
          clickIfPossible(form.querySelector(SELECTORS.nextButton));
          log("clicked Next (target)");
        });
      }
      return true;
    },

    handleTestSize() {
      if (!state.flow.target || state.flow.testSize) return false;

      const panels = [...document.querySelectorAll(SELECTORS.testSizePanel)].filter((p) =>
        isVisible(p),
      );
      if (!panels.length) return false;

      const targetLabel = CREDIT_LABEL[store.get().testSize];
      if (!targetLabel) {
        warn("unknown testSize", store.get().testSize);
        return false;
      }

      for (const panel of panels) {
        const options = panel.querySelectorAll(SELECTORS.testSizeOption);
        for (const option of options) {
          const label = option.querySelector(SELECTORS.testSizeLabel);
          if (label && label.textContent?.trim() === targetLabel) {
            option.click();
            state.flow.testSize = true;
            log("clicked test size", targetLabel);
            return true;
          }
        }
      }
      return false;
    },
  };

  const settingsUi = (() => {
    let host;
    let root;
    let dialog;
    let form;
    let statusError;
    let statusSaved;
    let votersSlider;

    function option(value, label) {
      return `<option value="${String(value)}">${label}</option>`;
    }

    function render() {
      if (dialog) return;

      host = document.createElement("div");
      host.id = UI.hostId;
      document.documentElement.appendChild(host);

      root = host.attachShadow({ mode: "open" });
      root.innerHTML = `
        <style>
          :host { all: initial; }
          .fab {
            position: fixed;
            right: 16px;
            bottom: 16px;
            border: 0;
            border-radius: 999px;
            background: linear-gradient(120deg, #f58b4a, #ec4f8f);
            color: #ffffff;
            box-shadow: 0 10px 24px rgba(236, 79, 143, 0.35);
            cursor: pointer;
            z-index: 2147483646;
            font-size: 13px;
            font-weight: 700;
            line-height: 1.2;
            padding: 10px 12px;
          }
          .fab:hover { filter: brightness(1.05); }
          dialog {
            width: min(540px, calc(100vw - 24px));
            border: 0;
            border-radius: 22px;
            padding: 0;
            box-shadow: 0 24px 80px rgba(17, 24, 39, 0.28);
            background: #f8f8fb;
            color: #2a2e38;
            font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          }
          dialog::backdrop {
            background: rgba(17, 24, 39, 0.52);
            backdrop-filter: blur(2px);
          }
          .head {
            padding: 18px 20px 13px;
            border-bottom: 1px solid #e6e8ef;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 8px;
          }
          .title {
            margin: 0;
            font-size: 17px;
            font-weight: 700;
          }
          .sub {
            font-size: 12px;
            color: #7b8091;
          }
          form {
            padding: 14px 20px 18px;
          }
          .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 13px;
          }
          .field {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .full {
            grid-column: 1 / -1;
          }
          label {
            font-weight: 600;
            font-size: 12px;
            color: #3b3f4a;
          }
          input, select {
            border: 1px solid #d9dbe3;
            border-radius: 14px;
            padding: 10px 12px;
            background: #ffffff;
            color: #2a2e38;
            outline: none;
            font-size: 15px;
          }
          input:focus, select:focus {
            border-color: #84a7ea;
            box-shadow: 0 0 0 4px rgba(132, 167, 234, 0.26);
          }
          .hint {
            font-size: 11px;
            color: #7b8091;
          }
          .age-readout {
            font-size: 14px;
            font-weight: 700;
            color: #2f3442;
            margin-top: 1px;
          }
          .pf-slider {
            margin-top: 6px;
            border: 0;
            box-shadow: none;
            background: transparent;
            height: 18px;
          }
          /* noUiSlider functional CSS (required for correct geometry) */
          .pf-slider,
          .pf-slider * {
            box-sizing: border-box;
            user-select: none;
            touch-action: none;
          }
          .pf-slider.noUi-target {
            position: relative;
          }
          .pf-slider .noUi-base,
          .pf-slider .noUi-connects {
            width: 100%;
            height: 100%;
            position: relative;
            z-index: 1;
          }
          .pf-slider .noUi-connects {
            overflow: hidden;
            z-index: 0;
          }
          .pf-slider .noUi-connect,
          .pf-slider .noUi-origin {
            will-change: transform;
            position: absolute;
            z-index: 1;
            top: 0;
            right: 0;
            height: 100%;
            width: 100%;
            transform-origin: 0 0;
          }
          .pf-slider.noUi-horizontal .noUi-origin {
            height: 0;
          }
          .pf-slider .noUi-handle {
            position: absolute;
            backface-visibility: hidden;
            width: 18px;
            height: 18px;
            border-radius: 999px;
            border: 0;
            background: #875be2;
            box-shadow: 0 0 0 2px #ffffff;
            right: -9px;
            top: -7px;
            cursor: pointer;
          }
          .pf-slider .noUi-touch-area {
            width: 100%;
            height: 100%;
          }

          /* noUiSlider visual theme overrides */
          .pf-slider .noUi-base {
            height: 5px;
            top: 6px;
          }
          .pf-slider .noUi-connects {
            border-radius: 999px;
            background: #dfdfe7;
          }
          .pf-slider .noUi-connect {
            background: #8d62e0;
          }
          .pf-slider .noUi-handle::before,
          .pf-slider .noUi-handle::after {
            display: none;
          }
          .range-steps {
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: #8b90a1;
            margin-top: 2px;
          }
          .preview {
            border: 1px solid #e5e7ef;
            border-radius: 12px;
            background: #ffffff;
            color: #4b5565;
            padding: 9px 11px;
            font-size: 12px;
          }
          .check {
            display: flex;
            gap: 8px;
            align-items: center;
            margin-top: 2px;
          }
          .check input {
            width: 16px;
            height: 16px;
            margin: 0;
          }
          .status {
            min-height: 18px;
            margin-top: 10px;
            font-size: 12px;
          }
          .error { color: #b91c1c; }
          .saved { color: #047857; }
          .actions {
            margin-top: 12px;
            display: flex;
            gap: 8px;
            justify-content: flex-end;
          }
          button {
            border: 1px solid #e1e3ea;
            border-radius: 14px;
            padding: 9px 16px;
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
          }
          .secondary {
            background: #eceef4;
            color: #2f3442;
            border-color: #dde0ea;
          }
          .danger {
            background: #fff6f6;
            color: #b91c1c;
            border-color: #ffd3d3;
            margin-right: auto;
          }
          .primary {
            border: 0;
            background: linear-gradient(120deg, #f58b4a, #ec4f8f);
            color: #ffffff;
          }
          .shortcut {
            color: #7b8091;
            font-size: 11px;
            margin-top: 8px;
            text-align: right;
          }
        </style>
        <button id="pf-fab" class="fab" type="button" title="Open script settings">Auto setup</button>
        <dialog id="pf-settings-dialog" aria-label="Photofeeler Auto-Submit settings">
          <div class="head">
            <h2 class="title">Photofeeler Auto-Submit</h2>
            <div class="sub">Settings</div>
          </div>
          <form id="pf-settings-form" method="dialog">
            <div class="grid">
              <div class="field">
                <label for="pf-category">Category</label>
                <select id="pf-category" name="category">
                  ${option("dating", "Dating")}
                  ${option("business", "Business")}
                  ${option("social", "Social")}
                </select>
              </div>
              <div class="field">
                <label for="pf-test-size">Test size</label>
                <select id="pf-test-size" name="testSize">
                  ${option(0, "Karma (0)")}
                  ${option(10, "Rough (10)")}
                  ${option(20, "Standard (20)")}
                  ${option(40, "Precise (40)")}
                  ${option(80, "Very precise (80)")}
                </select>
              </div>
              <div class="field">
                <label for="pf-subject-gender">Subject gender</label>
                <select id="pf-subject-gender" name="subjectGender">
                  ${option("MALE", "Male")}
                  ${option("FEMALE", "Female")}
                </select>
              </div>
              <div class="field">
                <label for="pf-subject-age">Subject age</label>
                <input id="pf-subject-age" name="subjectAge" type="number" min="18" max="99" step="1" />
              </div>
              <div class="field">
                <label for="pf-voters-gender">Voters gender</label>
                <select id="pf-voters-gender" name="votersGender">
                  ${option("MALE", "Male")}
                  ${option("FEMALE", "Female")}
                  ${option("BOTH", "Both")}
                </select>
              </div>
              <div class="field">
                <label>Voters age range</label>
                <div id="pf-voters-age-readout" class="age-readout">Ages: Up to 29</div>
                <div id="pf-voters-slider" class="pf-slider"></div>
                <div class="range-steps">
                  <span>18</span><span>24</span><span>29</span><span>34</span><span>44</span><span>Any</span>
                </div>
              </div>
              <div class="field full">
                <label class="check">
                  <input id="pf-auto-next" name="autoNext" type="checkbox" />
                  <span>Auto-click Next on subject and target steps</span>
                </label>
              </div>
            </div>
            <div class="status">
              <div id="pf-status-error" class="error"></div>
              <div id="pf-status-saved" class="saved"></div>
            </div>
            <div class="actions">
              <button type="button" id="pf-reset" class="danger">Reset defaults</button>
              <button type="button" id="pf-cancel" class="secondary">Cancel</button>
              <button type="submit" class="primary">Save</button>
            </div>
            <div class="shortcut">Tip: open settings with ${UI.shortcutLabel}</div>
          </form>
        </dialog>
      `;

      dialog = root.getElementById("pf-settings-dialog");
      form = root.getElementById("pf-settings-form");
      statusError = root.getElementById("pf-status-error");
      statusSaved = root.getElementById("pf-status-saved");

      root.getElementById("pf-fab").addEventListener("click", () => this.open());
      root.getElementById("pf-cancel").addEventListener("click", () => dialog.close());
      root.getElementById("pf-reset").addEventListener("click", () => this.onReset());
      dialog.addEventListener("close", () => this.clearStatus());
      form.addEventListener("submit", (event) => this.onSubmit(event));
    }

    function getById(id) {
      return root.getElementById(id);
    }

    function ensureSlider() {
      if (votersSlider) return;
      const sliderEl = root.getElementById("pf-voters-slider");
      if (typeof noUiSlider === "undefined") {
        throw new Error("noUiSlider failed to load.");
      }
      if (!sliderEl?.noUiSlider) {
        noUiSlider.create(sliderEl, {
          start: [DEFAULT_SETTINGS.voters.ageSliderMin, DEFAULT_SETTINGS.voters.ageSliderMax],
          step: 1,
          connect: true,
          margin: 1,
          range: { min: 0, max: 5 },
        });
      }
      votersSlider = sliderEl.noUiSlider;
      votersSlider.on("update", () => this.updateRangeUi());
    }

    function getSliderRange() {
      if (!votersSlider) {
        return {
          min: DEFAULT_SETTINGS.voters.ageSliderMin,
          max: DEFAULT_SETTINGS.voters.ageSliderMax,
        };
      }
      const raw = votersSlider.get();
      const [min, max] = Array.isArray(raw)
        ? raw.map((v) => Math.round(Number(v)))
        : [DEFAULT_SETTINGS.voters.ageSliderMin, DEFAULT_SETTINGS.voters.ageSliderMax];
      return normalizeRange(min, max);
    }

    function setSliderRange(min, max) {
      const range = normalizeRange(min, max);
      if (votersSlider) {
        votersSlider.set([range.min, range.max]);
      }
      return range;
    }

    function readFormData() {
      const range = getSliderRange();

      const next = {
        category: getById("pf-category").value,
        subject: {
          gender: getById("pf-subject-gender").value,
          age: toInt(getById("pf-subject-age").value, DEFAULT_SETTINGS.subject.age),
        },
        voters: {
          gender: getById("pf-voters-gender").value,
          ageSliderMin: range.min,
          ageSliderMax: range.max,
        },
        testSize: toInt(getById("pf-test-size").value, DEFAULT_SETTINGS.testSize),
        autoNext: getById("pf-auto-next").checked,
      };

      if (next.voters.ageSliderMin > next.voters.ageSliderMax) {
        throw new Error("Voters age slider min cannot be greater than max.");
      }

      return sanitizeSettings(next);
    }

    return {
      mount() {
        render.call(this);
      },
      fill(settings) {
        getById("pf-category").value = settings.category;
        getById("pf-test-size").value = String(settings.testSize);
        getById("pf-subject-gender").value = settings.subject.gender;
        getById("pf-subject-age").value = String(settings.subject.age);
        getById("pf-voters-gender").value = settings.voters.gender;
        const range = normalizeRange(settings.voters.ageSliderMin, settings.voters.ageSliderMax);
        setSliderRange(range.min, range.max);
        this.updateRangeUi();

        getById("pf-auto-next").checked = settings.autoNext;
      },
      updateRangeUi() {
        const range = getSliderRange();
        getById("pf-voters-age-readout").textContent = `Ages: ${formatAgeRangeLabel(
          range.min,
          range.max,
        )}`;
      },
      clearStatus() {
        statusError.textContent = "";
        statusSaved.textContent = "";
      },
      showSaved(message) {
        this.clearStatus();
        statusSaved.textContent = message;
      },
      showError(message) {
        this.clearStatus();
        statusError.textContent = message;
      },
      open() {
        if (typeof dialog.showModal === "function") {
          dialog.showModal();
        } else {
          dialog.setAttribute("open", "");
        }
        ensureSlider.call(this);
        this.fill(store.get());
        this.clearStatus();
        // noUiSlider may render with stale geometry if initialized while hidden.
        setTimeout(() => {
          const range = getSliderRange();
          setSliderRange(range.min, range.max);
          this.updateRangeUi();
        }, 0);
      },
      close() {
        dialog.close();
      },
      async onReset() {
        try {
          await store.reset();
          automation.resetFlow();
          this.fill(store.get());
          this.showSaved("Defaults restored.");
          automation.scheduleRun(50);
        } catch (error) {
          this.showError(error?.message || "Failed to reset settings.");
        }
      },
      async onSubmit(event) {
        event.preventDefault();
        try {
          const next = readFormData();
          await store.save(next);
          automation.resetFlow();
          this.showSaved("Settings saved.");
          automation.scheduleRun(50);
          schedule(220, () => this.close());
        } catch (error) {
          this.showError(error?.message || "Failed to save settings.");
        }
      },
    };
  })();

  function registerTriggers() {
    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand(UI.menuLabel, () => settingsUi.open());
    }

    window.addEventListener("keydown", (event) => {
      const target = event.target;
      const editable =
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (editable) return;

      if (event.altKey && event.shiftKey && event.code === "KeyP") {
        event.preventDefault();
        settingsUi.open();
      }
    });
  }

  function log(msg, data) {
    if (typeof data === "undefined") {
      console.log(`${LOG_PREFIX} ${msg}`);
    } else {
      console.log(`${LOG_PREFIX} ${msg}:`, data);
    }
  }

  function warn(msg, data) {
    if (typeof data === "undefined") {
      console.warn(`${LOG_PREFIX} ${msg}`);
    } else {
      console.warn(`${LOG_PREFIX} ${msg}:`, data);
    }
  }

  async function init() {
    settingsUi.mount();
    registerTriggers();
    await store.init();
    automation.startObserver();
    automation.scheduleRun(800);
  }

  init().catch((error) => {
    console.error(`${LOG_PREFIX} init failed:`, error);
  });
})();
