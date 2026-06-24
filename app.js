const storageKey = "github-pages-todo-list";
const syncStorageKey = "github-pages-todo-sync";
const clientStorageKey = "github-pages-todo-client";
const gistFileName = "todo-list-data.json";
const syncDebounceMs = 1200;
const autoSyncIntervalMs = 60000;

const state = {
  tasks: [],
  filter: "all",
  query: "",
  sync: {
    token: "",
    gistId: "",
    syncing: false,
    timer: 0,
    interval: 0,
    queuedMode: "",
    lastSyncedAt: 0,
  },
};

const els = {
  form: document.querySelector("#task-form"),
  title: document.querySelector("#task-title"),
  priority: document.querySelector("#task-priority"),
  due: document.querySelector("#task-due"),
  list: document.querySelector("#task-list"),
  template: document.querySelector("#task-template"),
  empty: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  remaining: document.querySelector("#remaining-count"),
  done: document.querySelector("#done-count"),
  clearCompleted: document.querySelector("#clear-completed"),
  search: document.querySelector("#search-input"),
  segments: Array.from(document.querySelectorAll(".segment")),
  syncToggle: document.querySelector("#sync-toggle"),
  syncPanel: document.querySelector("#sync-panel"),
  syncBadge: document.querySelector("#sync-badge"),
  syncStatus: document.querySelector("#sync-status"),
  syncForm: document.querySelector("#sync-form"),
  syncToken: document.querySelector("#sync-token"),
  syncGist: document.querySelector("#sync-gist"),
  syncCreate: document.querySelector("#sync-create"),
  syncNow: document.querySelector("#sync-now"),
  syncPull: document.querySelector("#sync-pull"),
};

function normalizeTask(task) {
  const now = Date.now();
  return {
    id: task.id || crypto.randomUUID(),
    title: task.title || "",
    priority: task.priority || "normal",
    due: task.due || "",
    done: Boolean(task.done),
    deleted: Boolean(task.deleted),
    createdAt: task.createdAt || now,
    updatedAt: task.updatedAt || now,
    deletedAt: task.deletedAt || 0,
  };
}

function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    state.tasks = Array.isArray(saved) ? saved.map(normalizeTask) : [];
  } catch {
    state.tasks = [];
  }
}

function saveTasks() {
  localStorage.setItem(storageKey, JSON.stringify(state.tasks));
}

function loadSyncConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(syncStorageKey) || "{}");
    state.sync.token = saved.token || "";
    state.sync.gistId = saved.gistId || "";
    state.sync.lastSyncedAt = saved.lastSyncedAt || 0;
  } catch {
    state.sync.token = "";
    state.sync.gistId = "";
  }

  els.syncToken.value = state.sync.token;
  els.syncGist.value = state.sync.gistId;
  setSyncStatus(hasSyncConfig() ? "GitHub 自动同步已开启" : "未配置 GitHub 同步");
}

function saveSyncConfig() {
  localStorage.setItem(syncStorageKey, JSON.stringify({
    token: state.sync.token,
    gistId: state.sync.gistId,
    lastSyncedAt: state.sync.lastSyncedAt,
  }));
}

function getClientId() {
  let clientId = localStorage.getItem(clientStorageKey);
  if (!clientId) {
    clientId = crypto.randomUUID();
    localStorage.setItem(clientStorageKey, clientId);
  }
  return clientId;
}

function activeTasks() {
  return state.tasks.filter((task) => !task.deleted);
}

function todayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setDefaultDueDate() {
  els.due.value = todayISO();
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

function visibleTasks() {
  const query = state.query.trim().toLowerCase();
  return activeTasks()
    .filter((task) => {
      if (state.filter === "active") return !task.done;
      if (state.filter === "done") return task.done;
      return true;
    })
    .filter((task) => !query || task.title.toLowerCase().includes(query))
    .sort((a, b) => {
      if (a.done !== b.done) return Number(a.done) - Number(b.done);
      const rank = { high: 0, normal: 1, low: 2 };
      return rank[a.priority] - rank[b.priority] || b.createdAt - a.createdAt;
    });
}

function renderStats() {
  const tasks = activeTasks();
  const done = tasks.filter((task) => task.done).length;
  els.done.textContent = done;
  els.remaining.textContent = tasks.length - done;
  els.clearCompleted.disabled = done === 0;
}

function renderEmpty(tasks) {
  const hasTasks = activeTasks().length > 0;
  els.empty.hidden = tasks.length > 0;
  if (tasks.length > 0) return;
  if (!hasTasks) {
    els.emptyTitle.textContent = "没有任务";
  } else if (state.query.trim()) {
    els.emptyTitle.textContent = "没有匹配结果";
  } else {
    els.emptyTitle.textContent = state.filter === "done" ? "还没有完成项" : "这里已经清空";
  }
}

function updateSegments() {
  els.segments.forEach((button) => {
    const selected = button.dataset.filter === state.filter;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
}

function setSyncStatus(message) {
  els.syncStatus.textContent = message;
}

function hasSyncConfig() {
  return Boolean(state.sync.token && state.sync.gistId);
}

function formatSyncTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "";
}

function renderSync() {
  const configured = hasSyncConfig();
  els.syncBadge.textContent = state.sync.syncing ? "同步中" : configured ? "自动同步" : "未同步";
  els.syncToggle.classList.toggle("is-syncing", state.sync.syncing);
  els.syncCreate.disabled = state.sync.syncing || !state.sync.token;
  els.syncNow.disabled = state.sync.syncing || !configured;
  els.syncPull.disabled = state.sync.syncing || !configured;
}

function renderTask(task) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const checkbox = node.querySelector(".task-check");
  const edit = node.querySelector(".task-edit");
  const priority = node.querySelector(".task-priority-edit");
  const due = node.querySelector(".task-due-edit");
  const editBtn = node.querySelector(".edit-btn");
  const deleteBtn = node.querySelector(".delete-btn");

  node.dataset.id = task.id;
  node.classList.toggle("is-done", task.done);
  checkbox.checked = task.done;
  edit.value = task.title;
  priority.value = task.priority;
  priority.className = `task-priority-edit priority-${task.priority}`;
  due.value = task.due || todayISO();
  due.classList.toggle("due-overdue", !task.done && Boolean(task.due) && task.due < todayISO());

  checkbox.addEventListener("change", () => {
    task.done = checkbox.checked;
    task.updatedAt = Date.now();
    saveTasks();
    scheduleSync();
    render();
  });

  edit.addEventListener("change", () => {
    const title = edit.value.trim();
    if (!title) {
      edit.value = task.title;
      return;
    }
    task.title = title;
    task.updatedAt = Date.now();
    saveTasks();
    scheduleSync();
    render();
  });

  edit.addEventListener("keydown", (event) => {
    if (event.key === "Enter") edit.blur();
    if (event.key === "Escape") {
      edit.value = task.title;
      edit.blur();
    }
  });

  priority.addEventListener("change", () => {
    task.priority = priority.value;
    task.updatedAt = Date.now();
    saveTasks();
    scheduleSync();
    render();
  });

  due.addEventListener("change", () => {
    task.due = due.value || todayISO();
    task.updatedAt = Date.now();
    saveTasks();
    scheduleSync();
    render();
  });

  editBtn.addEventListener("click", () => {
    edit.focus();
    edit.select();
  });

  deleteBtn.addEventListener("click", () => {
    task.deleted = true;
    task.deletedAt = Date.now();
    task.updatedAt = task.deletedAt;
    saveTasks();
    scheduleSync();
    render();
  });

  return node;
}

function render() {
  const tasks = visibleTasks();
  els.list.replaceChildren(...tasks.map(renderTask));
  renderStats();
  renderEmpty(tasks);
  updateSegments();
  renderSync();
}

function makeSyncPayload() {
  return {
    version: 1,
    clientId: getClientId(),
    updatedAt: Date.now(),
    tasks: state.tasks.map(normalizeTask),
  };
}

function parseRemoteData(content) {
  if (!content) return { version: 1, tasks: [] };
  const data = JSON.parse(content);
  return {
    version: data.version || 1,
    tasks: Array.isArray(data.tasks) ? data.tasks.map(normalizeTask) : [],
  };
}

function mergeRemoteTasks(remoteTasks) {
  const merged = new Map();
  [...state.tasks, ...remoteTasks].forEach((task) => {
    const normalized = normalizeTask(task);
    const existing = merged.get(normalized.id);
    if (!existing || normalized.updatedAt >= existing.updatedAt) {
      merged.set(normalized.id, normalized);
    }
  });
  state.tasks = Array.from(merged.values()).sort((a, b) => b.createdAt - a.createdAt);
  pruneDeletedTasks();
}

function pruneDeletedTasks() {
  const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 45;
  state.tasks = state.tasks.filter((task) => !task.deleted || task.deletedAt > cutoff);
}

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${state.sync.token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...githubHeaders(),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `GitHub API ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

function ensureToken() {
  if (!state.sync.token) {
    throw new Error("缺少 GitHub token");
  }
}

function ensureSyncConfig() {
  ensureToken();
  if (!state.sync.gistId) {
    throw new Error("缺少 Gist ID");
  }
}

async function createGist() {
  state.sync.syncing = true;
  renderSync();
  setSyncStatus("正在新建 Gist...");
  try {
    ensureToken();
    const gist = await githubRequest("https://api.github.com/gists", {
      method: "POST",
      body: JSON.stringify({
        description: "Todo List sync data",
        public: false,
        files: {
          [gistFileName]: {
            content: JSON.stringify(makeSyncPayload(), null, 2),
          },
        },
      }),
    });
    state.sync.gistId = gist.id;
    state.sync.lastSyncedAt = Date.now();
    els.syncGist.value = gist.id;
    saveSyncConfig();
    startAutoSync();
    setSyncStatus(`已新建 Gist，自动同步已开启：${gist.id}`);
  } catch (error) {
    setSyncStatus(`同步失败：${error.message}`);
  } finally {
    state.sync.syncing = false;
    renderSync();
  }
}

async function fetchRemoteTasks() {
  const gist = await githubRequest(`https://api.github.com/gists/${state.sync.gistId}`);
  const file = gist.files && gist.files[gistFileName];
  return parseRemoteData(file ? file.content : "");
}

async function pushRemoteTasks() {
  await githubRequest(`https://api.github.com/gists/${state.sync.gistId}`, {
    method: "PATCH",
    body: JSON.stringify({
      files: {
        [gistFileName]: {
          content: JSON.stringify(makeSyncPayload(), null, 2),
        },
      },
    }),
  });
}

async function syncTasks(mode = "merge") {
  if (state.sync.syncing) {
    state.sync.queuedMode = mode === "pull" ? "merge" : mode;
    return;
  }

  state.sync.syncing = true;
  renderSync();
  setSyncStatus(mode === "pull" ? "正在拉取..." : "正在同步...");
  try {
    ensureSyncConfig();
    if (mode === "pull" || mode === "merge") {
      const remote = await fetchRemoteTasks();
      mergeRemoteTasks(remote.tasks);
      saveTasks();
    }
    if (mode === "push" || mode === "merge") {
      await pushRemoteTasks();
    }
    state.sync.lastSyncedAt = Date.now();
    saveSyncConfig();
    render();
    setSyncStatus(`自动同步已开启，上次同步：${formatSyncTime(state.sync.lastSyncedAt)}`);
  } catch (error) {
    setSyncStatus(`同步失败：${error.message}`);
  } finally {
    state.sync.syncing = false;
    renderSync();
    if (state.sync.queuedMode && hasSyncConfig()) {
      const nextMode = state.sync.queuedMode;
      state.sync.queuedMode = "";
      queueSync(nextMode, 200);
    }
  }
}

function queueSync(mode = "merge", delay = syncDebounceMs) {
  if (!hasSyncConfig()) return;
  clearTimeout(state.sync.timer);
  state.sync.timer = window.setTimeout(() => {
    syncTasks(mode).catch((error) => setSyncStatus(`同步失败：${error.message}`));
  }, delay);
}

function scheduleSync() {
  queueSync("merge", syncDebounceMs);
}

function startAutoSync() {
  clearInterval(state.sync.interval);
  if (!hasSyncConfig()) return;

  state.sync.interval = window.setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine !== false) {
      queueSync("merge", 0);
    }
  }, autoSyncIntervalMs);
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = els.title.value.trim();
  if (!title) return;

  state.tasks.push({
    id: crypto.randomUUID(),
    title,
    priority: els.priority.value,
    due: els.due.value || todayISO(),
    done: false,
    deleted: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: 0,
  });

  els.form.reset();
  els.priority.value = "normal";
  setDefaultDueDate();
  els.title.focus();
  saveTasks();
  scheduleSync();
  render();
});

els.segments.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    render();
  });
});

els.search.addEventListener("input", () => {
  state.query = els.search.value;
  render();
});

els.clearCompleted.addEventListener("click", () => {
  const now = Date.now();
  state.tasks.forEach((task) => {
    if (task.done && !task.deleted) {
      task.deleted = true;
      task.deletedAt = now;
      task.updatedAt = now;
    }
  });
  saveTasks();
  scheduleSync();
  render();
});

els.syncToggle.addEventListener("click", () => {
  const shouldOpen = els.syncPanel.hidden;
  els.syncPanel.hidden = !shouldOpen;
  els.syncToggle.setAttribute("aria-expanded", String(shouldOpen));
});

els.syncForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.sync.token = els.syncToken.value.trim();
  state.sync.gistId = els.syncGist.value.trim();
  saveSyncConfig();
  startAutoSync();
  renderSync();
  if (hasSyncConfig()) {
    setSyncStatus("同步配置已保存，正在自动同步...");
    queueSync("merge", 0);
  } else {
    setSyncStatus("Token 已保存，可新建 Gist");
  }
});

els.syncCreate.addEventListener("click", () => {
  state.sync.token = els.syncToken.value.trim();
  state.sync.gistId = els.syncGist.value.trim();
  saveSyncConfig();
  createGist();
});

els.syncNow.addEventListener("click", () => {
  state.sync.token = els.syncToken.value.trim();
  state.sync.gistId = els.syncGist.value.trim();
  saveSyncConfig();
  startAutoSync();
  syncTasks("merge");
});

els.syncPull.addEventListener("click", () => {
  state.sync.token = els.syncToken.value.trim();
  state.sync.gistId = els.syncGist.value.trim();
  saveSyncConfig();
  startAutoSync();
  syncTasks("pull");
});

loadTasks();
loadSyncConfig();
setDefaultDueDate();
render();

startAutoSync();
queueSync("merge", 500);

window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    queueSync("merge", 300);
  }
});

window.addEventListener("online", () => {
  queueSync("merge", 300);
});
