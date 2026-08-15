import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";

const store = await Store.load("dim-settings.json");
const container = document.getElementById("monitors");
const autostartToggle = document.getElementById("autostart-toggle");
const closeBehaviorInputs = document.querySelectorAll('input[name="close-behavior"]');
const identifyBtn = document.getElementById("identify-btn");

const cards = new Map(); // monitor.id -> { slider, valueLabel, linkCheckbox }

function setSliderFill(slider) {
  slider.style.setProperty("--fill", `${slider.value}%`);
}

function updateSegmentActive(input) {
  const segment = input.closest(".segment");
  const group = segment.parentElement;
  for (const s of group.querySelectorAll(".segment")) {
    s.classList.toggle("active", s === segment);
  }
}

async function setDim(id, value) {
  await invoke("set_dim", { id, value });
  await store.set(id, value);
  await store.save();
}

function applyValueToCard(id, value) {
  const card = cards.get(id);
  if (!card) return;
  card.slider.value = value;
  card.valueLabel.textContent = `${value}%`;
  setSliderFill(card.slider);
}

async function handleSliderChange(monitorId, value) {
  applyValueToCard(monitorId, value);
  await setDim(monitorId, value);

  const source = cards.get(monitorId);
  if (!source?.linkCheckbox.checked) return;

  for (const [id, card] of cards) {
    if (id === monitorId || !card.linkCheckbox.checked) continue;
    applyValueToCard(id, value);
    await setDim(id, value);
  }
}

async function renderMonitors() {
  const monitors = await invoke("list_monitors");
  container.innerHTML = "";
  cards.clear();

  for (const monitor of monitors) {
    const saved = (await store.get(`dim:${monitor.id}`)) ?? 0;
    const name = (await store.get(`name:${monitor.id}`)) ?? monitor.label;
    const linked = (await store.get(`linked:${monitor.id}`)) ?? false;

    const card = document.createElement("div");
    card.className = "monitor-card";
    card.innerHTML = `
      <div class="row">
        <input type="text" class="name-input" value="${name}" placeholder="${monitor.label}" spellcheck="false" />
        <span class="value">${saved}%</span>
      </div>
      <div class="dims">${monitor.width}×${monitor.height}</div>
      <input type="range" min="0" max="100" value="${saved}" />
      <label class="link-row">
        <input type="checkbox" class="link-checkbox" ${linked ? "checked" : ""} />
        <span class="custom-checkbox"></span>
        <span class="link-text">Link with other linked displays</span>
      </label>
    `;

    const nameInput = card.querySelector(".name-input");
    const valueLabel = card.querySelector(".value");
    const slider = card.querySelector("input[type=range]");
    const linkCheckbox = card.querySelector(".link-checkbox");
    setSliderFill(slider);

    cards.set(monitor.id, { slider, valueLabel, linkCheckbox });

    slider.addEventListener("input", () => {
      handleSliderChange(monitor.id, Number(slider.value));
    });

    nameInput.addEventListener("change", async () => {
      const value = nameInput.value.trim();
      if (value === "" || value === monitor.label) {
        nameInput.value = monitor.label;
        await store.delete(`name:${monitor.id}`);
      } else {
        await store.set(`name:${monitor.id}`, value);
      }
      await store.save();
    });

    linkCheckbox.addEventListener("change", async () => {
      await store.set(`linked:${monitor.id}`, linkCheckbox.checked);
      await store.save();

      if (!linkCheckbox.checked) return;
      const otherLinked = [...cards.entries()].find(
        ([id, c]) => id !== monitor.id && c.linkCheckbox.checked
      );
      if (otherLinked) {
        const value = Number(otherLinked[1].slider.value);
        handleSliderChange(monitor.id, value);
      }
    });

    container.appendChild(card);

    if (saved > 0) {
      await invoke("set_dim", { id: monitor.id, value: saved });
    }
  }
}

async function setupAutostart() {
  autostartToggle.checked = await invoke("get_autostart");
  autostartToggle.addEventListener("change", () => {
    invoke("set_autostart", { enabled: autostartToggle.checked });
  });
}

async function setupCloseBehavior() {
  const saved = (await store.get("close-behavior")) ?? "minimize";
  for (const input of closeBehaviorInputs) {
    input.checked = input.value === saved;
    updateSegmentActive(input);
  }
  await invoke("set_close_behavior", { minimize: saved === "minimize" });

  for (const input of closeBehaviorInputs) {
    input.addEventListener("change", async () => {
      if (!input.checked) return;
      updateSegmentActive(input);
      await invoke("set_close_behavior", { minimize: input.value === "minimize" });
      await store.set("close-behavior", input.value);
      await store.save();
    });
  }
}

function setupTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      for (const b of tabButtons) b.classList.toggle("active", b === button);
      for (const panel of panels) {
        panel.classList.toggle("active", panel.id === `tab-${button.dataset.tab}`);
      }
    });
  }
}

function setupIdentify() {
  identifyBtn.addEventListener("click", () => {
    invoke("identify_displays");
  });
}

renderMonitors();
setupAutostart();
setupCloseBehavior();
setupTabs();
setupIdentify();
