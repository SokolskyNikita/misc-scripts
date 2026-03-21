// ==UserScript==
// @name         Photofeeler Auto-Submit
// @namespace    https://github.com/SokolskyNikita/misc-scripts
// @version      3.0
// @description  Auto-fills Photofeeler setup with configurable in-page settings UI
// @match        https://www.photofeeler.com/*
// @homepageURL  https://github.com/SokolskyNikita/misc-scripts
// @supportURL   https://github.com/SokolskyNikita/misc-scripts/issues
// @updateURL    https://raw.githubusercontent.com/SokolskyNikita/misc-scripts/main/tampermonkey/photofeeler-auto-submit.js
// @downloadURL  https://raw.githubusercontent.com/SokolskyNikita/misc-scripts/main/tampermonkey/photofeeler-auto-submit.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

"use strict";

const STORAGE_KEY = "pfAutoSubmitSettingsV1";
const VALID = {
  category: ["dating", "business", "social"],
  subjectGender: ["MALE", "FEMALE"],
  votersGender: ["MALE", "FEMALE", "BOTH"],
  testSize: [0, 10, 20, 40, 80],
};
const DEFAULT_CFG = {
  category: "dating",
  subject: { gender: "MALE", age: 28 },
  voters: { gender: "FEMALE", ageSliderMin: 0, ageSliderMax: 2 },
  testSize: 20,
  autoNext: true,
};
let CFG = clone(DEFAULT_CFG);
let settingsReady = false;
let settingsDialog;
let settingsHost;
let settingsRoot;
let settingsErrorEl;
let settingsSavedEl;

const CREDIT_LABEL = {
  0: "Karma Test",
  10: "Rough Test",
  20: "Standard Test",
  40: "Precise Test",
  80: "Very Precise Test",
};

// Per-run state — reset whenever the category panel transitions from hidden → visible
let done = { category: false, subject: false, target: false, testSize: false };
let categoryWasVisible = false;
let timer;

function isVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function fire(el, ...types) {
  types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
}

function safeClick(el) {
  if (el && typeof el.click === "function") {
    el.click();
    return true;
  }
  return false;
}

function clone(val) {
  return JSON.parse(JSON.stringify(val));
}

function asInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeCfg(raw) {
  const source = raw && typeof raw === "object" ? raw : {};

  const category = VALID.category.includes(source.category)
    ? source.category
    : DEFAULT_CFG.category;

  const subjectGender = VALID.subjectGender.includes(source.subject?.gender)
    ? source.subject.gender
    : DEFAULT_CFG.subject.gender;
  const subjectAge = clamp(asInt(source.subject?.age, DEFAULT_CFG.subject.age), 18, 99);

  const votersGender = VALID.votersGender.includes(source.voters?.gender)
    ? source.voters.gender
    : DEFAULT_CFG.voters.gender;

  let ageSliderMin = clamp(
    asInt(source.voters?.ageSliderMin, DEFAULT_CFG.voters.ageSliderMin),
    0,
    5,
  );
  let ageSliderMax = clamp(
    asInt(source.voters?.ageSliderMax, DEFAULT_CFG.voters.ageSliderMax),
    1,
    5,
  );
  if (ageSliderMin > ageSliderMax) {
    ageSliderMin = ageSliderMax;
  }

  const testSize = VALID.testSize.includes(asInt(source.testSize, NaN))
    ? asInt(source.testSize, DEFAULT_CFG.testSize)
    : DEFAULT_CFG.testSize;

  const autoNext =
    typeof source.autoNext === "boolean" ? source.autoNext : DEFAULT_CFG.autoNext;

  return {
    category,
    subject: { gender: subjectGender, age: subjectAge },
    voters: { gender: votersGender, ageSliderMin, ageSliderMax },
    testSize,
    autoNext,
  };
}

async function tmGetValue(key, fallback) {
  if (typeof GM_getValue !== "function") return fallback;
  const result = GM_getValue(key, fallback);
  if (result && typeof result.then === "function") {
    return await result;
  }
  return result;
}

async function tmSetValue(key, value) {
  if (typeof GM_setValue !== "function") return;
  const result = GM_setValue(key, value);
  if (result && typeof result.then === "function") {
    await result;
  }
}

function resetFlowState() {
  done = { category: false, subject: false, target: false, testSize: false };
  categoryWasVisible = false;
}

async function loadSettings() {
  const stored = await tmGetValue(STORAGE_KEY, DEFAULT_CFG);
  CFG = sanitizeCfg(stored);
  settingsReady = true;

  // Persist normalized settings in case old/invalid values existed.
  await tmSetValue(STORAGE_KEY, CFG);
  console.log("[PF] settings loaded:", CFG);
}

async function saveSettings(nextCfg) {
  CFG = sanitizeCfg(nextCfg);
  await tmSetValue(STORAGE_KEY, CFG);
  resetFlowState();
  run();
}

function optionHtml(value, label) {
  return `<option value="${String(value)}">${label}</option>`;
}

function ensureSettingsUi() {
  if (settingsDialog) return;

  settingsHost = document.createElement("div");
  settingsHost.id = "pf-auto-submit-settings-host";
  document.documentElement.appendChild(settingsHost);

  settingsRoot = settingsHost.attachShadow({ mode: "open" });
  settingsRoot.innerHTML = `
    <style>
      :host { all: initial; }
      dialog {
        width: min(520px, calc(100vw - 24px));
        border: 0;
        border-radius: 16px;
        padding: 0;
        box-shadow: 0 18px 70px rgba(0, 0, 0, 0.4);
        background: #ffffff;
        color: #111827;
        font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      }
      dialog::backdrop { background: rgba(17, 24, 39, 0.55); backdrop-filter: blur(2px); }
      .head {
        padding: 16px 18px 12px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }
      .title { font-size: 16px; font-weight: 700; margin: 0; }
      .sub { font-size: 12px; color: #6b7280; }
      form { padding: 14px 18px 18px; }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .field { display: flex; flex-direction: column; gap: 6px; }
      .field.full { grid-column: 1 / -1; }
      label { font-weight: 600; font-size: 12px; color: #374151; }
      input, select {
        border: 1px solid #d1d5db;
        border-radius: 10px;
        padding: 9px 10px;
        background: #fff;
        color: #111827;
        outline: none;
      }
      input:focus, select:focus {
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
      }
      .hint { font-size: 11px; color: #6b7280; }
      .check {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .check input {
        width: 16px;
        height: 16px;
        margin: 0;
        box-shadow: none;
      }
      .status {
        min-height: 18px;
        margin-top: 8px;
        font-size: 12px;
      }
      .error { color: #b91c1c; }
      .saved { color: #047857; }
      .actions {
        margin-top: 12px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      button {
        border: 1px solid transparent;
        border-radius: 10px;
        padding: 8px 12px;
        cursor: pointer;
        font-weight: 600;
      }
      .secondary { background: #f3f4f6; color: #111827; border-color: #e5e7eb; }
      .danger { background: #fff; color: #b91c1c; border-color: #fecaca; margin-right: auto; }
      .primary { background: #2563eb; color: #fff; }
      .shortcut { color: #6b7280; font-size: 11px; margin-top: 8px; text-align: right; }
    </style>
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
              ${optionHtml("dating", "Dating")}
              ${optionHtml("business", "Business")}
              ${optionHtml("social", "Social")}
            </select>
          </div>
          <div class="field">
            <label for="pf-test-size">Test size</label>
            <select id="pf-test-size" name="testSize">
              ${optionHtml(0, "Karma (0)")}
              ${optionHtml(10, "Rough (10)")}
              ${optionHtml(20, "Standard (20)")}
              ${optionHtml(40, "Precise (40)")}
              ${optionHtml(80, "Very precise (80)")}
            </select>
          </div>
          <div class="field">
            <label for="pf-subject-gender">Subject gender</label>
            <select id="pf-subject-gender" name="subjectGender">
              ${optionHtml("MALE", "Male")}
              ${optionHtml("FEMALE", "Female")}
            </select>
          </div>
          <div class="field">
            <label for="pf-subject-age">Subject age</label>
            <input id="pf-subject-age" name="subjectAge" type="number" min="18" max="99" step="1" />
          </div>
          <div class="field">
            <label for="pf-voters-gender">Voters gender</label>
            <select id="pf-voters-gender" name="votersGender">
              ${optionHtml("MALE", "Male")}
              ${optionHtml("FEMALE", "Female")}
              ${optionHtml("BOTH", "Both")}
            </select>
          </div>
          <div class="field">
            <label for="pf-voters-min">Voters age slider min</label>
            <input id="pf-voters-min" name="votersAgeSliderMin" type="number" min="0" max="5" step="1" />
          </div>
          <div class="field">
            <label for="pf-voters-max">Voters age slider max</label>
            <input id="pf-voters-max" name="votersAgeSliderMax" type="number" min="1" max="5" step="1" />
            <div class="hint">Slider scale on Photofeeler UI: 1..5 (higher = wider range).</div>
          </div>
          <div class="field full">
            <label class="check">
              <input id="pf-auto-next" name="autoNext" type="checkbox" />
              <span>Auto-click Next on subject and target steps</span>
            </label>
          </div>
        </div>
        <div class="status">
          <div id="pf-settings-error" class="error"></div>
          <div id="pf-settings-saved" class="saved"></div>
        </div>
        <div class="actions">
          <button type="button" id="pf-reset" class="danger">Reset defaults</button>
          <button type="button" id="pf-cancel" class="secondary">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
        <div class="shortcut">Tip: open settings with Alt+Shift+P</div>
      </form>
    </dialog>
  `;

  settingsDialog = settingsRoot.getElementById("pf-settings-dialog");
  settingsErrorEl = settingsRoot.getElementById("pf-settings-error");
  settingsSavedEl = settingsRoot.getElementById("pf-settings-saved");
  const form = settingsRoot.getElementById("pf-settings-form");
  const cancelBtn = settingsRoot.getElementById("pf-cancel");
  const resetBtn = settingsRoot.getElementById("pf-reset");

  cancelBtn.addEventListener("click", () => settingsDialog.close());
  settingsDialog.addEventListener("close", () => clearStatus());

  resetBtn.addEventListener("click", async () => {
    clearStatus();
    await saveSettings(DEFAULT_CFG);
    fillForm(CFG);
    settingsSavedEl.textContent = "Defaults restored.";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    try {
      const next = readForm();
      await saveSettings(next);
      settingsSavedEl.textContent = "Settings saved.";
      setTimeout(() => settingsDialog.close(), 250);
    } catch (err) {
      settingsErrorEl.textContent = err?.message || "Failed to save settings.";
    }
  });
}

function clearStatus() {
  if (settingsErrorEl) settingsErrorEl.textContent = "";
  if (settingsSavedEl) settingsSavedEl.textContent = "";
}

function readForm() {
  const category = settingsRoot.getElementById("pf-category").value;
  const testSize = asInt(settingsRoot.getElementById("pf-test-size").value, DEFAULT_CFG.testSize);
  const subjectGender = settingsRoot.getElementById("pf-subject-gender").value;
  const subjectAge = asInt(
    settingsRoot.getElementById("pf-subject-age").value,
    DEFAULT_CFG.subject.age,
  );
  const votersGender = settingsRoot.getElementById("pf-voters-gender").value;
  const votersAgeSliderMin = asInt(
    settingsRoot.getElementById("pf-voters-min").value,
    DEFAULT_CFG.voters.ageSliderMin,
  );
  const votersAgeSliderMax = asInt(
    settingsRoot.getElementById("pf-voters-max").value,
    DEFAULT_CFG.voters.ageSliderMax,
  );
  const autoNext = settingsRoot.getElementById("pf-auto-next").checked;

  const next = sanitizeCfg({
    category,
    subject: { gender: subjectGender, age: subjectAge },
    voters: {
      gender: votersGender,
      ageSliderMin: votersAgeSliderMin,
      ageSliderMax: votersAgeSliderMax,
    },
    testSize,
    autoNext,
  });

  if (next.voters.ageSliderMin > next.voters.ageSliderMax) {
    throw new Error("Voters age slider min cannot be greater than max.");
  }
  return next;
}

function fillForm(cfg) {
  settingsRoot.getElementById("pf-category").value = cfg.category;
  settingsRoot.getElementById("pf-test-size").value = String(cfg.testSize);
  settingsRoot.getElementById("pf-subject-gender").value = cfg.subject.gender;
  settingsRoot.getElementById("pf-subject-age").value = String(cfg.subject.age);
  settingsRoot.getElementById("pf-voters-gender").value = cfg.voters.gender;
  settingsRoot.getElementById("pf-voters-min").value = String(cfg.voters.ageSliderMin);
  settingsRoot.getElementById("pf-voters-max").value = String(cfg.voters.ageSliderMax);
  settingsRoot.getElementById("pf-auto-next").checked = cfg.autoNext;
}

function openSettingsUi() {
  ensureSettingsUi();
  clearStatus();
  fillForm(CFG);
  if (typeof settingsDialog.showModal === "function") {
    settingsDialog.showModal();
  } else {
    // Fallback for environments without modal dialog support.
    settingsDialog.setAttribute("open", "");
  }
}

function registerUiTriggers() {
  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("Open Photofeeler Auto-Submit settings", openSettingsUi);
  }

  window.addEventListener("keydown", (event) => {
    const isEditable =
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
    if (isEditable) return;

    if (event.altKey && event.shiftKey && event.code === "KeyP") {
      event.preventDefault();
      openSettingsUi();
    }
  });
}

// ── Step 1: Click the correct category ──────────────────────────────────────
function handleCategory() {
  const panel = document.querySelector(".panel-new-category-25b");
  const visible = panel && isVisible(panel);

  if (!visible) {
    categoryWasVisible = false;
    return false;
  }

  // Panel just appeared → new test flow, reset all state
  if (!categoryWasVisible) {
    done = { category: false, subject: false, target: false, testSize: false };
    categoryWasVisible = true;
  }

  if (done.category) return false;

  const target = panel.querySelector(`.category.${CFG.category}`);
  if (!target) {
    console.warn("[PF] category not found:", CFG.category);
    return false;
  }

  target.click();
  done.category = true;
  console.log("[PF] clicked category:", CFG.category);
  return true;
}

// ── Step 2: Fill subject (gender + age) and optionally click Next ────────────
function handleSubject() {
  if (!done.category || done.subject) return false;

  const form = [...document.querySelectorAll("form.panel-subject")].find((f) =>
    isVisible(f),
  );
  if (!form) return false;

  const [genderSel, ageSel] = form.querySelectorAll("select.native");
  if (!genderSel || !ageSel) return false;

  if (genderSel.value !== CFG.subject.gender) {
    genderSel.value = CFG.subject.gender;
    fire(genderSel, "input", "change");
  }

  const ageStr = String(CFG.subject.age);
  if (ageSel.value !== ageStr) {
    ageSel.value = ageStr;
    fire(ageSel, "input", "change");
  }

  // Only proceed to Next if both values are set
  if (genderSel.value !== CFG.subject.gender || ageSel.value !== ageStr)
    return false;

  done.subject = true;
  console.log("[PF] subject filled:", CFG.subject.gender, CFG.subject.age);

  if (CFG.autoNext) {
    setTimeout(() => {
      const btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.click();
        console.log("[PF] clicked Next (subject)");
      }
    }, 150);
  }
  return true;
}

// ── Step 3: Fill voter gender + age slider and optionally click Next ─────────
function handleTarget() {
  if (!done.subject || done.target) return false;

  const form = [...document.querySelectorAll("form.panel-target")].find((f) =>
    isVisible(f),
  );
  if (!form) return false;

  // Gender radio
  const radio = form.querySelector(
    `input[name="target-gender"][value="${CFG.voters.gender}"]`,
  );
  if (radio && !radio.checked) {
    // Prefer clicking the label (matches real user interaction); fallback to the input.
    safeClick(radio.closest("label")) || safeClick(radio);
  }

  // noUiSlider
  const slider = form.querySelector(".pf-slider");
  if (slider?.noUiSlider) {
    const rawVals = slider.noUiSlider.get();
    const vals = Array.isArray(rawVals) ? rawVals.map(Number) : [Number(rawVals)];
    if (
      vals.length > 1 &&
      (vals[0] !== CFG.voters.ageSliderMin ||
      vals[1] !== CFG.voters.ageSliderMax
      )
    ) {
      slider.noUiSlider.set([CFG.voters.ageSliderMin, CFG.voters.ageSliderMax]);
    }
  }

  done.target = true;
  console.log(
    "[PF] voters filled:",
    CFG.voters.gender,
    "slider max:",
    CFG.voters.ageSliderMax,
  );

  if (CFG.autoNext) {
    setTimeout(() => {
      const btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.click();
        console.log("[PF] clicked Next (target)");
      }
    }, 150);
  }
  return true;
}

// ── Step 4: Click the correct test size option ───────────────────────────────
function handleTestSize() {
  if (!done.target || done.testSize) return false;

  // Find a visible test-size panel
  const panels = [...document.querySelectorAll(".panel-test-size-25")].filter(
    (p) => isVisible(p),
  );
  if (!panels.length) return false;

  const targetLabel = CREDIT_LABEL[CFG.testSize];
  if (!targetLabel) {
    console.warn("[PF] unknown testSize:", CFG.testSize);
    return false;
  }

  for (const panel of panels) {
    const options = panel.querySelectorAll(".menu-option-25");
    for (const opt of options) {
      const label = opt.querySelector(".size-label");
      if (label && label.textContent?.trim() === targetLabel) {
        opt.click();
        done.testSize = true;
        console.log("[PF] clicked test size:", targetLabel);
        return true;
      }
    }
  }
  return false;
}

// ── Main orchestrator ────────────────────────────────────────────────────────
function run() {
  if (!settingsReady) return;
  handleCategory();
  handleSubject();
  handleTarget();
  handleTestSize();
}

function startAutomationObserver() {
  // Debounced MutationObserver to catch Vue re-renders
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

async function init() {
  registerUiTriggers();
  await loadSettings();
  startAutomationObserver();
  setTimeout(run, 800);
}

init().catch((err) => {
  console.error("[PF] init failed:", err);
});
