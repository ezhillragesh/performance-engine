// Budgets popover: edit PerformanceBudgets -> SET_BUDGETS, persisted in chrome.storage.local.
import { h, icon } from "../dom.js";
import { BUDGET_KEYS } from "../validate.js";
import { DEFAULT_BUDGETS, BUDGET_META } from "../derive.js";

const STORAGE_KEY = "perfEngine.budgets";

export async function loadStoredBudgets() {
  try {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    const raw = got?.[STORAGE_KEY];
    if (!raw || typeof raw !== "object") return null;
    const out = {};
    for (const k of BUDGET_KEYS) if (typeof raw[k] === "number" && Number.isFinite(raw[k]) && raw[k] >= 0) out[k] = raw[k];
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

async function saveStoredBudgets(budgets) {
  try {
    if (budgets) await chrome.storage.local.set({ [STORAGE_KEY]: budgets });
    else await chrome.storage.local.remove(STORAGE_KEY);
  } catch {
    /* storage unavailable (e.g. context invalidated) */
  }
}

/** Creates the popover; call open(anchor) to show it. */
export function createBudgetsPopover(ctx) {
  let pop = null;
  let anchorEl = null;

  function close() {
    if (!pop) return;
    pop.remove();
    pop = null;
    document.removeEventListener("pointerdown", onOutside, true);
    anchorEl?.setAttribute("aria-expanded", "false");
    anchorEl?.focus();
  }

  function onOutside(e) {
    if (pop && !pop.contains(e.target) && e.target !== anchorEl && !anchorEl?.contains(e.target)) close();
  }

  function open(anchor) {
    if (pop) return close();
    anchorEl = anchor;
    const current = ctx.store.budgets();
    const inputs = {};
    const error = h("p", { class: "form-error caption", role: "alert", hidden: true });
    const rows = BUDGET_KEYS.map((k) => {
      const meta = BUDGET_META[k];
      const id = `budget-${k}`;
      inputs[k] = h("input", { id, type: "number", min: 0, step: meta.unit === "ms" ? 1 : 1, class: "num-input", value: String(current[k]), required: true });
      return h(
        "div",
        { class: "form-row" },
        h("label", { for: id, text: meta.label }),
        h("div", { class: "input-unit" }, inputs[k], h("span", { class: "unit caption", text: meta.unit === "count" ? "×" : meta.unit })),
        h("span", { class: "caption muted default-hint", text: `default ${DEFAULT_BUDGETS[k]}` }),
      );
    });
    const form = h(
      "form",
      {
        class: "budget-form",
        onSubmit: async (e) => {
          e.preventDefault();
          const next = {};
          for (const k of BUDGET_KEYS) {
            const v = Number(inputs[k].value);
            if (!Number.isFinite(v) || v < 0) {
              error.textContent = `${BUDGET_META[k].label} must be a non-negative number.`;
              error.hidden = false;
              inputs[k].focus();
              return;
            }
            next[k] = v;
          }
          await saveStoredBudgets(next);
          ctx.actions.command("SET_BUDGETS", next);
          close();
        },
      },
      rows,
      error,
      h(
        "div",
        { class: "form-actions" },
        h(
          "button",
          {
            type: "button",
            class: "btn",
            onClick: async () => {
              for (const k of BUDGET_KEYS) inputs[k].value = String(DEFAULT_BUDGETS[k]);
              await saveStoredBudgets(null);
              ctx.actions.command("SET_BUDGETS", { ...DEFAULT_BUDGETS });
              close();
            },
            text: "Reset to defaults",
          },
        ),
        h("span", { class: "spacer" }),
        h("button", { type: "button", class: "btn", onClick: close, text: "Cancel" }),
        h("button", { type: "submit", class: "btn btn-accent", text: "Apply" }),
      ),
    );
    pop = h(
      "div",
      { class: "popover", role: "dialog", "aria-modal": "false", "aria-label": "Performance budgets" },
      h("div", { class: "popover-head" }, icon("gauge", 16), h("h2", { text: "Performance budgets" }), h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onClick: close }, icon("close", 14))),
      h("p", { class: "caption muted", text: "Applied to the inspected page and re-sent whenever the engine attaches." }),
      form,
    );
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    });
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.top = `${Math.round(r.bottom + 6)}px`;
    pop.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)))}px`;
    anchor.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
    inputs[BUDGET_KEYS[0]].focus();
  }

  return { open, close, get isOpen() { return !!pop; } };
}
