import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";

const store = await Store.load("dim-settings.json");
const monitorsContainer = document.getElementById("monitors");
const layoutContainer = document.getElementById("layout");
const autostartToggle = document.getElementById("autostart-toggle");
const closeBehaviorInputs = document.querySelectorAll('input[name="close-behavior"]');
const identifyBtn = document.getElementById("identify-btn");

let monitors = []; // raw list from Rust, fixed for the session
let monitorsById = new Map();
let currentOrder = []; // monitor ids, in display order (index = assigned number - 1)
const cards = new Map(); // monitor.id -> { slider, valueLabel, linkBtn }

function displayName(id, index) {
  return store.get(`name:${id}`).then((n) => n ?? `Display ${index + 1}`);
}

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
  await store.set(`dim:${id}`, value);
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
  if (!source?.linkBtn.classList.contains("active")) return;

  for (const [id, card] of cards) {
    if (id === monitorId || !card.linkBtn.classList.contains("active")) continue;
    applyValueToCard(id, value);
    await setDim(id, value);
  }
}

async function resolveOrder() {
  const saved = (await store.get("display-order")) ?? [];
  const knownIds = new Set(monitors.map((m) => m.id));
  const order = saved.filter((id) => knownIds.has(id));
  for (const m of monitors) {
    if (!order.includes(m.id)) order.push(m.id);
  }
  return order;
}

async function persistOrder() {
  await store.set("display-order", currentOrder);
  await store.save();
}

function swapOrder(idA, idB) {
  const a = currentOrder.indexOf(idA);
  const b = currentOrder.indexOf(idB);
  if (a === -1 || b === -1) return;
  [currentOrder[a], currentOrder[b]] = [currentOrder[b], currentOrder[a]];
}

function computeRects() {
  const width = layoutContainer.clientWidth;
  const height = layoutContainer.clientHeight;
  const padding = 20;

  const minX = Math.min(...monitors.map((m) => m.x));
  const minY = Math.min(...monitors.map((m) => m.y));
  const maxX = Math.max(...monitors.map((m) => m.x + m.width));
  const maxY = Math.max(...monitors.map((m) => m.y + m.height));
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);

  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const totalW = spanX * scale;
  const totalH = spanY * scale;
  const offsetX = (width - totalW) / 2;
  const offsetY = (height - totalH) / 2;

  const rects = new Map();
  for (const m of monitors) {
    rects.set(m.id, {
      left: offsetX + (m.x - minX) * scale,
      top: offsetY + (m.y - minY) * scale,
      width: m.width * scale - 6,
      height: m.height * scale - 6,
    });
  }
  return rects;
}

async function renderLayout() {
  layoutContainer.innerHTML = "";
  const rects = computeRects();
  const boxes = new Map();

  for (const [index, id] of currentOrder.entries()) {
    const rect = rects.get(id);
    if (!rect) continue;

    const box = document.createElement("div");
    box.className = "layout-box";
    box.dataset.id = id;
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const name = await displayName(id, index);
    box.innerHTML = `<span class="number">${index + 1}</span><span class="name">${name}</span>`;

    layoutContainer.appendChild(box);
    boxes.set(id, box);
  }

  for (const box of boxes.values()) {
    box.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      box.setPointerCapture(e.pointerId);
      box.classList.add("dragging");
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = rects.get(box.dataset.id);
      let hoveredId = null;

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        box.style.transform = `translate(${dx}px, ${dy}px)`;

        const centerX = origin.left + origin.width / 2 + dx;
        const centerY = origin.top + origin.height / 2 + dy;
        hoveredId = null;
        for (const [otherId, other] of boxes) {
          if (otherId === box.dataset.id) continue;
          const r = rects.get(otherId);
          const inside =
            centerX >= r.left && centerX <= r.left + r.width && centerY >= r.top && centerY <= r.top + r.height;
          other.classList.toggle("drop-target", inside);
          if (inside) hoveredId = otherId;
        }
      }

      function onUp(ev) {
        box.releasePointerCapture(ev.pointerId);
        box.removeEventListener("pointermove", onMove);
        box.removeEventListener("pointerup", onUp);
        box.classList.remove("dragging");
        box.style.transform = "";
        for (const other of boxes.values()) other.classList.remove("drop-target");

        if (hoveredId) {
          swapOrder(box.dataset.id, hoveredId);
          persistOrder();
          renderLayout();
          renderCards();
        }
      }

      box.addEventListener("pointermove", onMove);
      box.addEventListener("pointerup", onUp);
    });
  }
}

async function renderCards() {
  monitorsContainer.innerHTML = "";
  cards.clear();

  for (const [index, id] of currentOrder.entries()) {
    const monitor = monitorsById.get(id);
    if (!monitor) continue;

    const defaultLabel = `Display ${index + 1}`;
    const saved = (await store.get(`dim:${id}`)) ?? 0;
    const name = (await store.get(`name:${id}`)) ?? defaultLabel;
    const linked = (await store.get(`linked:${id}`)) ?? false;

    const card = document.createElement("div");
    card.className = "monitor-card";
    card.innerHTML = `
      <div class="row">
        <input type="text" class="name-input" value="${name}" placeholder="${defaultLabel}" spellcheck="false" />
        <span class="value">${saved}%</span>
      </div>
      <div class="dims">${monitor.width}×${monitor.height}</div>
      <input type="range" min="0" max="100" value="${saved}" />
      <button type="button" class="link-btn${linked ? " active" : ""}">Link</button>
    `;

    const nameInput = card.querySelector(".name-input");
    const valueLabel = card.querySelector(".value");
    const slider = card.querySelector("input[type=range]");
    const linkBtn = card.querySelector(".link-btn");
    setSliderFill(slider);

    cards.set(id, { slider, valueLabel, linkBtn });

    slider.addEventListener("input", () => {
      handleSliderChange(id, Number(slider.value));
    });

    nameInput.addEventListener("change", async () => {
      const value = nameInput.value.trim();
      if (value === "" || value === defaultLabel) {
        nameInput.value = defaultLabel;
        await store.delete(`name:${id}`);
      } else {
        await store.set(`name:${id}`, value);
      }
      await store.save();
      renderLayout();
    });

    linkBtn.addEventListener("click", async () => {
      const active = linkBtn.classList.toggle("active");
      await store.set(`linked:${id}`, active);
      await store.save();

      if (!active) return;
      const otherLinked = [...cards.entries()].find(
        ([otherId, c]) => otherId !== id && c.linkBtn.classList.contains("active")
      );
      if (otherLinked) {
        const value = Number(otherLinked[1].slider.value);
        handleSliderChange(id, value);
      }
    });

    monitorsContainer.appendChild(card);

    if (saved > 0) {
      await invoke("set_dim", { id, value: saved });
    }
  }
}

async function init() {
  monitors = await invoke("list_monitors");
  monitorsById = new Map(monitors.map((m) => [m.id, m]));
  currentOrder = await resolveOrder();
  await persistOrder();

  await renderLayout();
  await renderCards();
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
    if (input.checked) updateSegmentActive(input);
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
    invoke("identify_displays", { order: currentOrder });
  });
}

init();
setupAutostart();
setupCloseBehavior();
setupTabs();
setupIdentify();
