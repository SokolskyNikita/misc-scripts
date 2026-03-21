// ==UserScript==
// @name         Photofeeler Auto-Submit
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Auto-fills and auto-advances through Photofeeler test setup
// @match        https://www.photofeeler.com/*
// @grant        none
// ==/UserScript==

"use strict";

/* ══════════════════════════════════════════════════════════════════════════
 *  CONFIGURATION
 *
 *  category   : 'dating' | 'business' | 'social'
 *
 *  subject.gender : 'MALE' | 'FEMALE'
 *  subject.age    : 18–99
 *
 *  voters.gender      : 'MALE' | 'FEMALE' | 'BOTH'
 *  voters.ageSliderMin: lower handle (0 = no lower bound, leave at 0)
 *  voters.ageSliderMax: upper handle step → displayed age cap:
 *                         1 → Up to ~24   2 → Up to ~29   3 → Up to ~34
 *                         4 → Up to ~44   5 → Any age
 *
 *  testSize   : 0 (Karma/free) | 10 | 20 | 40 | 80  credits
 *
 *  autoNext   : true = auto-click Next after subject & voter screens
 * ══════════════════════════════════════════════════════════════════════════ */
const CFG = {
  category: "dating",
  subject: { gender: "MALE", age: 28 },
  voters: { gender: "FEMALE", ageSliderMin: 0, ageSliderMax: 2 },
  testSize: 20,
  autoNext: true,
};
/* ══════════════════════════════════════════════════════════════════════════ */

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
  handleCategory();
  handleSubject();
  handleTarget();
  handleTestSize();
}

// Debounced MutationObserver to catch Vue re-renders
let timer;
new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(run, 250);
}).observe(document.documentElement, { childList: true, subtree: true });

setTimeout(run, 800);
