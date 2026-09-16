// flashcards/wlp/index-autogen.js
// Stage 5E.2
// Guest-default / Admin UI mode + remember admin + show/hide password

const TSV_URL =
  "flashcards/wlp/wlp-flashcard-master.tsv?v=20260909";

const mount =
  document.getElementById("auto-decks");

// Stage 5E.1 — lightweight Guest / Admin UI mode.
// IMPORTANT: this is UI-level protection only. The static TSV is still delivered
// to the browser and is not protected from a technically knowledgeable visitor.
// Everyone defaults to Guest. Admin can be session-only or remembered on this device.
const WLP_UI_ROLE_KEY = "wlp:ui-role:v2"; // persistent remembered-admin flag
const WLP_UI_SESSION_ADMIN_KEY = "wlp:session-admin:v1";
const WLP_ADMIN_PASSWORD_SHA256 =
  "d199aa3ab28923618bab089d78e8faa5e5004d0bc37c22ae5589454d575d192c";

function getWlpUiRole() {
  const rememberedAdmin = localStorage.getItem(WLP_UI_ROLE_KEY) === "admin";
  const sessionAdmin = sessionStorage.getItem(WLP_UI_SESSION_ADMIN_KEY) === "admin";
  return rememberedAdmin || sessionAdmin ? "admin" : "guest";
}

function clearWlpAdminAccess() {
  localStorage.removeItem(WLP_UI_ROLE_KEY);
  sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY);
}

function setWlpAdminAccess(rememberOnDevice) {
  if (rememberOnDevice) {
    localStorage.setItem(WLP_UI_ROLE_KEY, "admin");
    sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY);
  } else {
    localStorage.removeItem(WLP_UI_ROLE_KEY);
    sessionStorage.setItem(WLP_UI_SESSION_ADMIN_KEY, "admin");
  }
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function requestAdminAccess() {
  return new Promise(resolve => {
    const existing = document.getElementById("wlp-admin-login-gate");
    if (existing) existing.remove();

    const gate = document.createElement("div");
    gate.id = "wlp-admin-login-gate";
    gate.className = "wlp-access-gate";
    gate.innerHTML = `
      <form class="wlp-access-card wlp-admin-login-card" role="dialog" aria-modal="true" aria-label="Admin login">
        <h2>Admin Login</h2>
        <p>Enter the admin password to unlock editing and import/export tools.</p>
        <label class="wlp-admin-password-label">
          <span>Password</span>
          <span class="wlp-password-wrap">
            <input id="wlp-admin-password" type="password" autocomplete="current-password" required>
            <button type="button" id="wlp-password-toggle" class="wlp-password-toggle" aria-label="Show password" aria-pressed="false" title="Show password">👁</button>
          </span>
        </label>
        <label class="wlp-remember-admin">
          <input id="wlp-remember-admin" type="checkbox">
          <span>Remember Admin on this device</span>
        </label>
        <p id="wlp-admin-login-error" class="wlp-admin-login-error" hidden>Incorrect admin password.</p>
        <div class="wlp-access-actions">
          <button type="button" data-action="cancel">Cancel</button>
          <button type="submit">Login as Admin</button>
        </div>
      </form>
    `;
    document.body.appendChild(gate);

    const form = gate.querySelector("form");
    const password = gate.querySelector("#wlp-admin-password");
    const passwordToggle = gate.querySelector("#wlp-password-toggle");
    const remember = gate.querySelector("#wlp-remember-admin");
    const error = gate.querySelector("#wlp-admin-login-error");

    passwordToggle.addEventListener("click", () => {
      const showing = password.type === "text";
      password.type = showing ? "password" : "text";
      passwordToggle.setAttribute("aria-pressed", String(!showing));
      passwordToggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      passwordToggle.title = showing ? "Show password" : "Hide password";
      password.focus();
    });

    const finish = value => {
      gate.remove();
      resolve(value);
    };

    gate.querySelector('[data-action="cancel"]').addEventListener("click", () => finish(false));
    gate.addEventListener("click", event => {
      if (event.target === gate) finish(false);
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const hash = await sha256Hex(password.value);
      if (hash !== WLP_ADMIN_PASSWORD_SHA256) {
        error.hidden = false;
        password.select();
        return;
      }
      setWlpAdminAccess(remember.checked);
      finish(true);
    });

    requestAnimationFrame(() => password.focus());
  });
}

let wlpRows = [];
let wlpRowByWordId = new Map();

// Stage 5B — browser-local draft additions.
// These are intentionally separate from the canonical Master TSV.
const LOCAL_ADDITIONS_KEY =
  "wlp:local-additions:v1";

let localAdditions = [];

// Stage 5D — reversible browser-local edits for official Master cards.
const LOCAL_OVERRIDES_KEY =
  "wlp:local-overrides:v1";

const LOCAL_OVERRIDE_FIELDS = [
  "Word",
  "IPA",
  "Part of Speech",
  "Definition",
  "Synonym(s)",
  "Example Sentence",
  "Note(s)",
  "Category",
  "Source"
];

let localOverrides = {};

// Stage 5A — canonical WLP export order.
const WLP_EXPORT_COLUMNS = [
  "Batch #",
  "Guidance #",
  "WordID",
  "Word",
  "IPA",
  "Part of Speech",
  "Definition",
  "Synonym(s)",
  "Example Sentence",
  "Note(s)",
  "Category",
  "Source"
];

// Stage 5C.2 — metadata appended only to Draft-only exports.
// The first 12 columns remain the canonical WLP card columns.
const WLP_DRAFT_METADATA_COLUMNS = [
  "Local Draft ID",
  "Created At",
  "Updated At"
];

const WLP_DRAFT_EXPORT_COLUMNS = [
  ...WLP_EXPORT_COLUMNS,
  ...WLP_DRAFT_METADATA_COLUMNS
];

// =============================================================
// BASIC HELPERS
// =============================================================

function pad3(n) {
  return String(n).padStart(3, "0");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// =============================================================
// TSV
// =============================================================

async function loadTSVRows() {

  const res =
    await fetch(
      TSV_URL,
      { cache: "no-cache" }
    );

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status}`
    );
  }

  const txt =
    await res.text();

  // Quote-aware TSV parser.
  // This safely preserves tabs/newlines inside quoted fields.
  const table = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (
    let i = 0;
    i < txt.length;
    i++
  ) {

    const ch = txt[i];
    const next = txt[i + 1];

    if (ch === '"') {

      if (
        inQuotes &&
        next === '"'
      ) {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (
      ch === "\t" &&
      !inQuotes
    ) {
      row.push(field);
      field = "";
      continue;
    }

    if (
      (
        ch === "\n" ||
        ch === "\r"
      ) &&
      !inQuotes
    ) {

      if (
        ch === "\r" &&
        next === "\n"
      ) {
        i++;
      }

      row.push(field);

      if (
        row.some(
          value =>
            String(value)
              .trim() !== ""
        )
      ) {
        table.push(row);
      }

      row = [];
      field = "";
      continue;
    }

    field += ch;
  }

  row.push(field);

  if (
    row.some(
      value =>
        String(value)
          .trim() !== ""
    )
  ) {
    table.push(row);
  }

  if (!table.length) {
    return [];
  }

  const header =
    table[0].map(
      value =>
        String(value || "")
          .trim()
    );

  return table
    .slice(1)
    .map(cols => {

      const obj = {};

      header.forEach(
        (h, i) => {
          obj[h] =
            String(
              cols[i] ?? ""
            ).trim();
        }
      );

      return obj;
    });
}

function parseTSVText(text) {

  const txt = String(text ?? "")
    .replace(/^\uFEFF/, "");

  const table = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < txt.length; i++) {

    const ch = txt[i];
    const next = txt[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "\t" && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") {
        i++;
      }

      row.push(field);

      if (row.some(value => String(value).trim() !== "")) {
        table.push(row);
      }

      row = [];
      field = "";
      continue;
    }

    field += ch;
  }

  row.push(field);

  if (row.some(value => String(value).trim() !== "")) {
    table.push(row);
  }

  if (!table.length) {
    return { headers: [], rows: [] };
  }

  const headers = table[0].map(value => String(value || "").trim());

  const rows = table.slice(1).map(cols => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = String(cols[index] ?? "").trim();
    });
    return obj;
  });

  return { headers, rows };
}

function indexRowsByWordId(rows) {

  const map =
    new Map();

  rows.forEach(row => {

    const wordId =
      String(
        row["WordID"] || ""
      ).trim();

    if (wordId) {
      map.set(
        wordId,
        row
      );
    }

  });

  return map;

}

// =============================================================
// NORMAL DECK AUTO-GENERATION
// =============================================================

function getLastExistingBatch() {

  const links =
    [
      ...document.querySelectorAll(
        ".deck-links a"
      )
    ];

  const nums =
    links
      .map(a => {

        try {

          const u =
            new URL(
              a.getAttribute(
                "href"
              ),
              location.href
            );

          return Number(
            new URLSearchParams(
              u.search
            ).get("batch")
          );

        } catch {

          return NaN;

        }

      })
      .filter(
        n =>
          Number.isFinite(n)
      );

  return nums.length
    ? Math.max(...nums)
    : 0;

}

function getMaxBatchFromRows(rows) {

  let max = 0;

  rows.forEach(row => {

    const n =
      Number(
        row["Batch #"] ??
        row["Batch"] ??
        0
      );

    if (
      Number.isFinite(n) &&
      n > max
    ) {
      max = n;
    }

  });

  return max;

}

function buildGroups(
  start,
  end
) {

  const details =
    document.createElement(
      "details"
    );

  details.innerHTML = `
    <summary class="main-group">
      Decks ${start}–${end}
    </summary>

    <div class="subgroup"></div>
  `;

  const sg =
    details.querySelector(
      ".subgroup"
    );

  for (
    let r = start;
    r <= end;
    r += 10
  ) {

    const rEnd =
      Math.min(
        r + 9,
        end
      );

    const sub =
      document.createElement(
        "details"
      );

    sub.innerHTML = `
      <summary>
        <img
          src="assets/skull-crossbones.png"
          class="subgroup-icon skull-crossbones-icon"
        />
        ${pad3(r)}–${pad3(rEnd)}
      </summary>

      <ul class="deck-links"></ul>
    `;

    const ul =
      sub.querySelector("ul");

    for (
      let b = r;
      b <= rEnd;
      b++
    ) {

      const li =
        document.createElement(
          "li"
        );

      li.innerHTML = `
        <a
          href="flashcards/wlp/batch.html?batch=${pad3(b)}"
        >
          Deck ${pad3(b)}
        </a>
      `;

      ul.appendChild(li);

    }

    sg.appendChild(sub);

  }

  return details;

}

function buildMissingDeckGroups(
  rows
) {

  if (!mount) {
    return;
  }

  const last =
    getLastExistingBatch();

  const max =
    getMaxBatchFromRows(
      rows
    );

  if (
    !max ||
    last >= max
  ) {
    return;
  }

  let start =
    last + 1;

  const mod =
    (start - 1) % 50;

  if (mod !== 0) {

    start +=
      50 - mod;

  }

  for (
    let s = start;
    s <= max;
    s += 50
  ) {

    const e =
      Math.min(
        s + 49,
        max
      );

    mount.appendChild(
      buildGroups(
        s,
        e
      )
    );

  }

}

// =============================================================
// PROGRESS STORAGE
// =============================================================

function getAllProgressRecords() {

  const records = [];

  for (
    let i = 0;
    i < localStorage.length;
    i++
  ) {

    const key =
      localStorage.key(i);

    if (
      !key ||
      !key.startsWith(
        "fc:wordid:"
      )
    ) {
      continue;
    }

    try {

      const data =
        JSON.parse(
          localStorage.getItem(
            key
          ) || "{}"
        );

      const wordId =
        String(
          data.wordId ||
          key.replace(
            "fc:wordid:",
            ""
          )
        ).trim();

      if (!wordId) {
        continue;
      }

      records.push({

        wordId,

        studyCount:
          Number(
            data.studyCount || 0
          ),

        reviewCount:
          Number(
            data.reviewCount || 0
          ),

        attempts:
          Number(
            data.attempts || 0
          ),

        known:
          data.known === true,

        review:
          data.review === true,

        lastResult:
          data.lastResult || "",

        firstSeen:
          Number(
            data.firstSeen || 0
          ),

        lastSeen:
          Number(
            data.lastSeen || 0
          )

      });

    } catch (e) {

      console.warn(
        "Could not read progress:",
        key,
        e
      );

    }

  }

  return records;

}

// =============================================================
// PROGRESS EXPORT / IMPORT
// =============================================================

function getProgressBackupObject() {
  const records = {};

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);

    if (!key || !key.startsWith("fc:wordid:")) {
      continue;
    }

    try {
      const raw = localStorage.getItem(key);

      if (raw !== null) {
        records[key] = JSON.parse(raw);
      }
    } catch (e) {
      console.warn(
        "Skipping unreadable progress record:",
        key,
        e
      );
    }
  }

  return {
    format: "wlp-progress-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    recordCount: Object.keys(records).length,
    records
  };
}


function exportProgress() {
  const backup =
    getProgressBackupObject();

  const blob =
    new Blob(
      [
        JSON.stringify(
          backup,
          null,
          2
        )
      ],
      {
        type: "application/json"
      }
    );

  const now =
    new Date();

  const dateStamp =
    [
      now.getFullYear(),
      String(
        now.getMonth() + 1
      ).padStart(2, "0"),
      String(
        now.getDate()
      ).padStart(2, "0")
    ].join("-");

  const url =
    URL.createObjectURL(blob);

  const a =
    document.createElement("a");

  a.href = url;

  a.download =
    `wlp-progress-backup-${dateStamp}.json`;

  document.body.appendChild(a);

  a.click();

  a.remove();

  setTimeout(
    () => URL.revokeObjectURL(url),
    0
  );
}


function validateProgressBackup(backup) {
  if (
    !backup ||
    typeof backup !== "object"
  ) {
    throw new Error(
      "This is not a valid WLP progress backup."
    );
  }

  if (
    backup.format !==
      "wlp-progress-backup" ||
    backup.version !== 1
  ) {
    throw new Error(
      "This file is not a supported WLP progress backup."
    );
  }

  if (
    !backup.records ||
    typeof backup.records !== "object" ||
    Array.isArray(backup.records)
  ) {
    throw new Error(
      "The backup does not contain valid progress records."
    );
  }

  const entries =
    Object.entries(
      backup.records
    );

  entries.forEach(
    ([key, value]) => {
      if (
        !key.startsWith(
          "fc:wordid:"
        )
      ) {
        throw new Error(
          `Unexpected progress key: ${key}`
        );
      }

      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        throw new Error(
          `Invalid progress record: ${key}`
        );
      }
    }
  );

  return entries;
}


function replaceProgressFromBackup(backup) {
  const entries =
    validateProgressBackup(backup);

  const currentKeys = [];

  for (
    let i = 0;
    i < localStorage.length;
    i++
  ) {
    const key =
      localStorage.key(i);

    if (
      key &&
      key.startsWith(
        "fc:wordid:"
      )
    ) {
      currentKeys.push(key);
    }
  }

  currentKeys.forEach(
    key =>
      localStorage.removeItem(key)
  );

  entries.forEach(
    ([key, value]) => {
      localStorage.setItem(
        key,
        JSON.stringify(value)
      );
    }
  );

  return entries.length;
}


async function importProgressFile(file) {
  if (!file) {
    return;
  }

  try {
    const rawText =
      await file.text();

    const backup =
      JSON.parse(rawText);

    const entries =
      validateProgressBackup(backup);

    const ok =
      confirm(
        `${entries.length} progress record${
          entries.length === 1
            ? ""
            : "s"
        } found.\n\n` +
        "Importing will REPLACE the current WLP progress stored in this browser.\n\n" +
        "Continue?"
      );

    if (!ok) {
      return;
    }

    const count =
      replaceProgressFromBackup(
        backup
      );

    renderProgress();
    renderReviewDecks();

    alert(
      `Imported ${count} progress record${
        count === 1
          ? ""
          : "s"
      }.`
    );
  } catch (e) {
    console.error(
      "Progress import failed:",
      e
    );

    alert(
      "Could not import this progress backup.\n\n" +
      (
        e && e.message
          ? e.message
          : "Invalid JSON file."
      )
    );
  }
}

// =============================================================
// PROGRESS CLEAR / RESET
// =============================================================

function clearProgressForWordId(wordId) {
  const id = String(wordId || "").trim();
  if (!id) return false;

  const key = `fc:wordid:${id}`;
  if (localStorage.getItem(key) === null) return false;

  localStorage.removeItem(key);
  return true;
}

function clearAllProgressRecords() {
  const keys = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);

    if (
      key &&
      key.startsWith("fc:wordid:")
    ) {
      keys.push(key);
    }
  }

  keys.forEach(
    key =>
      localStorage.removeItem(key)
  );

  return keys.length;
}

function confirmAndClearProgress(wordId) {
  const id =
    String(wordId || "").trim();

  if (!id) {
    return;
  }

  const row =
    wlpRowByWordId.get(id) || {};

  const word =
    row["Word"] ||
    `WordID ${id}`;

  const ok =
    confirm(
      `Clear progress for “${word}” (WID ${id})?\n\n` +
      "This removes only this card's Studied / Review history and current status from this browser.\n\n" +
      "This cannot be undone unless you restore it from an exported Progress backup."
    );

  if (!ok) {
    return;
  }

  clearProgressForWordId(id);

  renderProgress();
  renderReviewDecks();
}

function confirmAndClearAllProgress() {
  const count =
    getAllProgressRecords().length;

  if (!count) {
    alert(
      "There is no WLP progress to clear."
    );
    return;
  }

  const ok =
    confirm(
      "CLEAR ALL WLP PROGRESS?\n\n" +
      `This will permanently remove all ${count} Progress record${count === 1 ? "" : "s"} stored in this browser.\n\n` +
      "Studied counts, Review counts, Attempts, and current statuses will all be erased.\n\n" +
      "Strongly recommended: Cancel now and use Export Progress first if you do not already have a backup.\n\n" +
      "Press OK only if you really want to clear everything."
    );

  if (!ok) {
    return;
  }

  const cleared =
    clearAllProgressRecords();

  renderProgress();
  renderReviewDecks();

  alert(
    `Cleared ${cleared} Progress record${cleared === 1 ? "" : "s"}.`
  );
}  

// =============================================================
// REVIEW POOL
// =============================================================

function getReviewRecords() {

  const records =
    getAllProgressRecords()
      .filter(
        r =>
          r.review === true ||
          r.lastResult ===
            "review"
      );

  // Hardest first.
  // Review回数 → 最近触った順
  records.sort(
    (a, b) => {

      if (
        b.reviewCount !==
        a.reviewCount
      ) {

        return (
          b.reviewCount -
          a.reviewCount
        );

      }

      return (
        b.lastSeen -
        a.lastSeen
      );

    }
  );

  return records;

}

function makeReviewDecks() {

  const reviewRecords =
    getReviewRecords();

  const decks = [];

  for (
    let i = 0;
    i < reviewRecords.length;
    i += 10
  ) {

    decks.push(
      reviewRecords.slice(
        i,
        i + 10
      )
    );

  }

  return decks;

}

// =============================================================
// STAGE 5B — LOCAL DRAFT ADDITIONS
// =============================================================

function makeLocalDraftId() {

  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `local-${crypto.randomUUID()}`;
  }

  return (
    "local-" +
    Date.now() +
    "-" +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );
}

function normalizeLocalDraft(value) {

  const draft =
    value && typeof value === "object"
      ? value
      : {};

  return {
    localId:
      String(
        draft.localId ||
        makeLocalDraftId()
      ),
    createdAt:
      String(
        draft.createdAt ||
        new Date().toISOString()
      ),
    updatedAt:
      String(
        draft.updatedAt ||
        draft.createdAt ||
        new Date().toISOString()
      ),
    Word:
      String(draft.Word || "").trim(),
    IPA:
      String(draft.IPA || "").trim(),
    "Part of Speech":
      String(
        draft["Part of Speech"] || ""
      ).trim(),
    Definition:
      String(
        draft.Definition || ""
      ).trim(),
    "Synonym(s)":
      String(
        draft["Synonym(s)"] || ""
      ).trim(),
    "Example Sentence":
      String(
        draft["Example Sentence"] || ""
      ).trim(),
    "Note(s)":
      String(
        draft["Note(s)"] || ""
      ).trim(),
    Category:
      String(
        draft.Category || ""
      ).trim(),
    Source:
      String(
        draft.Source || ""
      ).trim()
  };
}

function readLocalAdditions() {

  try {

    const raw =
      localStorage.getItem(
        LOCAL_ADDITIONS_KEY
      );

    if (!raw) {
      return [];
    }

    const parsed =
      JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeLocalDraft)
      .filter(
        draft => draft.Word
      );

  } catch (e) {

    console.warn(
      "Could not read WLP local additions:",
      e
    );

    return [];
  }
}

function writeLocalAdditions() {

  localStorage.setItem(
    LOCAL_ADDITIONS_KEY,
    JSON.stringify(
      localAdditions,
      null,
      2
    )
  );
}

function localDraftToWlpRow(draft) {

  return {
    "Batch #": "",
    "Guidance #": "",
    WordID: "",
    Word: draft.Word || "",
    IPA: draft.IPA || "",
    "Part of Speech":
      draft["Part of Speech"] || "",
    Definition:
      draft.Definition || "",
    "Synonym(s)":
      draft["Synonym(s)"] || "",
    "Example Sentence":
      draft["Example Sentence"] || "",
    "Note(s)":
      draft["Note(s)"] || "",
    Category:
      draft.Category || "",
    Source:
      draft.Source || ""
  };
}

function localDraftToPortableRow(draft) {

  return {
    ...localDraftToWlpRow(draft),
    "Local Draft ID": draft.localId || "",
    "Created At": draft.createdAt || "",
    "Updated At": draft.updatedAt || ""
  };
}

function draftContentFingerprint(value) {

  const draft = normalizeLocalDraft(value);

  return [
    draft.Word,
    draft.IPA,
    draft["Part of Speech"],
    draft.Definition,
    draft["Synonym(s)"],
    draft["Example Sentence"],
    draft["Note(s)"],
    draft.Category,
    draft.Source
  ]
    .map(item => String(item || "").trim())
    .join("\u241F");
}

function importedRowToLocalDraft(row, existingDraft = null) {

  const now = new Date().toISOString();

  return normalizeLocalDraft({
    localId:
      String(row["Local Draft ID"] || "").trim() ||
      existingDraft?.localId ||
      makeLocalDraftId(),
    createdAt:
      String(row["Created At"] || "").trim() ||
      existingDraft?.createdAt ||
      now,
    updatedAt:
      String(row["Updated At"] || "").trim() ||
      now,
    Word: row.Word,
    IPA: row.IPA,
    "Part of Speech": row["Part of Speech"],
    Definition: row.Definition,
    "Synonym(s)": row["Synonym(s)"],
    "Example Sentence": row["Example Sentence"],
    "Note(s)": row["Note(s)"],
    Category: row.Category,
    Source: row.Source
  });
}

function addLocalDraftFromForm(form) {

  const data =
    new FormData(form);

  const word =
    String(
      data.get("Word") || ""
    ).trim();

  if (!word) {
    alert(
      "Word is required before saving a draft."
    );
    return false;
  }

  const now =
    new Date().toISOString();

  const draft =
    normalizeLocalDraft({
      localId:
        makeLocalDraftId(),
      createdAt: now,
      updatedAt: now,
      Word: word,
      IPA: data.get("IPA"),
      "Part of Speech":
        data.get("Part of Speech"),
      Definition:
        data.get("Definition"),
      "Synonym(s)":
        data.get("Synonym(s)"),
      "Example Sentence":
        data.get("Example Sentence"),
      "Note(s)":
        data.get("Note(s)"),
      Category:
        data.get("Category"),
      Source:
        data.get("Source")
    });

  localAdditions.push(draft);
  writeLocalAdditions();
  form.reset();

  return true;
}

function deleteLocalDraft(localId) {

  const target =
    localAdditions.find(
      draft =>
        draft.localId === localId
    );

  if (!target) {
    return false;
  }

  const ok =
    confirm(
      `Delete local draft “${target.Word}”?\n\n` +
      "This removes only the browser-local draft. The Master TSV is not affected."
    );

  if (!ok) {
    return false;
  }

  localAdditions =
    localAdditions.filter(
      draft =>
        draft.localId !== localId
    );

  writeLocalAdditions();
  return true;
}

function formatDraftDate(value) {

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return "";
  }

  return d.toLocaleString();
}

function renderEditorDrafts(editorView) {

  if (!editorView) {
    return;
  }

  const masterCountEl =
    editorView.querySelector(
      "#editor-card-count"
    );

  if (masterCountEl) {

    const effectiveCount =
      wlpRows.length +
      localAdditions.length;

    masterCountEl.textContent =
      `${wlpRows.length} Master card${
        wlpRows.length === 1 ? "" : "s"
      } + ${localAdditions.length} local draft${
        localAdditions.length === 1 ? "" : "s"
      } = ${effectiveCount} effective card${
        effectiveCount === 1 ? "" : "s"
      } · ${countLocalOverrides()} local edit${
        countLocalOverrides() === 1 ? "" : "s"
      }.`;
  }

  const list =
    editorView.querySelector(
      "#local-draft-list"
    );

  const empty =
    editorView.querySelector(
      "#local-draft-empty"
    );

  if (!list || !empty) {
    return;
  }

  if (!localAdditions.length) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";

  list.innerHTML =
    localAdditions
      .map(draft => {

        const details = [];

        if (draft["Part of Speech"]) {
          details.push(
            draft["Part of Speech"]
          );
        }

        if (draft.Definition) {
          details.push(
            draft.Definition
          );
        }

        return `
          <div
            class="local-draft-row"
            data-local-draft-id="${escapeHtml(draft.localId)}"
          >
            <div class="local-draft-main">
              <div class="local-draft-word">
                ${escapeHtml(draft.Word)}
              </div>
              <div class="local-draft-meta">
                Draft · no official WordID
                ${
                  draft.createdAt
                    ? ` · ${escapeHtml(formatDraftDate(draft.createdAt))}`
                    : ""
                }
              </div>
              <div class="local-draft-detail">
                ${escapeHtml(details.join(" — "))}
              </div>
            </div>
            <button
              type="button"
              class="local-draft-delete"
              data-delete-local-draft="${escapeHtml(draft.localId)}"
            >
              Delete
            </button>
          </div>
        `;
      })
      .join("");
}

// =============================================================
// STAGE 5D — LOCAL MASTER-CARD OVERRIDES
// =============================================================

function readLocalOverrides() {
  try {
    const raw = localStorage.getItem(LOCAL_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (e) {
    console.warn("Could not read WLP local overrides:", e);
    return {};
  }
}

function writeLocalOverrides() {
  localStorage.setItem(
    LOCAL_OVERRIDES_KEY,
    JSON.stringify(localOverrides, null, 2)
  );
}

function applyOverrideToMasterRow(row) {
  const wid = String(row.WordID || "").trim();
  const override = wid ? localOverrides[wid] : null;
  if (!override || typeof override !== "object") return { ...row };

  const next = { ...row };
  LOCAL_OVERRIDE_FIELDS.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(override, field)) {
      next[field] = String(override[field] ?? "");
    }
  });
  return next;
}

function countLocalOverrides() {
  return Object.keys(localOverrides).filter(wid => {
    return localOverrides[wid] && typeof localOverrides[wid] === "object";
  }).length;
}

function updateEditorPendingBadge() {
  const badge = document.getElementById("editor-pending-badge");
  const editorButton = document.querySelector('[data-wlp-view="editor"]');
  if (!badge || !editorButton) return;

  const count = countLocalOverrides();
  badge.hidden = count === 0;
  badge.textContent = count ? String(count) : "";

  const pendingText = count === 1
    ? "1 local edit pending"
    : `${count} local edits pending`;

  editorButton.setAttribute(
    "aria-label",
    count ? `Editor — ${pendingText}` : "Editor"
  );
  editorButton.title = count ? pendingText : "";
}

function renderEditorOverrides(editorView) {
  if (!editorView) return;

  const list = editorView.querySelector("#local-override-list");
  const empty = editorView.querySelector("#local-override-empty");
  if (!list || !empty) return;

  const items = Object.entries(localOverrides)
    .filter(([, value]) => value && typeof value === "object")
    .map(([wid, value]) => {
      const base = wlpRowByWordId.get(String(wid));
      return { wid, value, base };
    })
    .sort((a, b) => Number(a.wid) - Number(b.wid));

  if (!items.length) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  list.innerHTML = items.map(({ wid, value, base }) => {
    const word = value.Word || base?.Word || `WID${wid}`;
    const definition = value.Definition || base?.Definition || "";
    return `
      <div class="local-draft-row">
        <div class="local-draft-main">
          <div class="local-draft-word">${escapeHtml(word)}</div>
          <div class="local-draft-meta">WID${escapeHtml(wid)} · Local Edit</div>
          <div class="local-draft-detail">${escapeHtml(definition)}</div>
        </div>
        <button
          type="button"
          class="local-draft-delete"
          data-revert-local-override="${escapeHtml(wid)}"
        >
          Revert
        </button>
      </div>
    `;
  }).join("");
}

function revertLocalOverrideFromEditor(wordId, editorView) {
  const wid = String(wordId || "").trim();
  if (!wid || !localOverrides[wid]) return false;

  if (!confirm(`Revert WID${wid} to the canonical Master version?\n\nThis removes only the browser-local edit.`)) {
    return false;
  }

  delete localOverrides[wid];
  writeLocalOverrides();
  renderEditorDrafts(editorView);
  renderEditorOverrides(editorView);
  updateEditorPendingBadge();
  return true;
}

// =============================================================
// STAGE 5A — ENTIRE / EFFECTIVE DECK EXPORT
// =============================================================

function tsvEscape(value) {

  const text =
    String(value ?? "");

  if (
    text.includes("\t") ||
    text.includes("\n") ||
    text.includes("\r") ||
    text.includes('"')
  ) {
    return (
      '"' +
      text.replaceAll('"', '""') +
      '"'
    );
  }

  return text;
}

function buildEffectiveDeckRows() {

  const masterRows =
    wlpRows.map(
      applyOverrideToMasterRow
    );

  const localRows =
    localAdditions.map(
      localDraftToWlpRow
    );

  return [
    ...masterRows,
    ...localRows
  ];
}

function buildDeckTSV(rows, columns = WLP_EXPORT_COLUMNS) {

  const header =
    columns.join("\t");

  const body =
    rows.map(
      row =>
        columns
          .map(
            column =>
              tsvEscape(
                row[column] ?? ""
              )
          )
          .join("\t")
    );

  return [header, ...body]
    .join("\n") + "\n";
}

function exportEntireDeck() {

  const rows =
    buildEffectiveDeckRows();

  if (!rows.length) {
    alert(
      "There are no WLP cards to export."
    );
    return;
  }

  const text =
    buildDeckTSV(rows);

  const blob =
    new Blob(
      ["\uFEFF", text],
      {
        type:
          "text/tab-separated-values;charset=utf-8"
      }
    );

  const now = new Date();
  const dateStamp = [
    now.getFullYear(),
    String(
      now.getMonth() + 1
    ).padStart(2, "0"),
    String(
      now.getDate()
    ).padStart(2, "0")
  ].join("-");

  const url =
    URL.createObjectURL(blob);

  const a =
    document.createElement("a");

  a.href = url;
  a.download =
    `wlp-effective-deck-${dateStamp}.tsv`;

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(
    () => URL.revokeObjectURL(url),
    0
  );
}


// =============================================================
// STAGE 5C — EXPORT NEW CARDS ONLY
// =============================================================

function exportNewCardsOnly() {

  if (!localAdditions.length) {
    alert(
      "There are no local draft cards to export."
    );
    return;
  }

  const rows =
    localAdditions.map(
      localDraftToPortableRow
    );

  const text =
    buildDeckTSV(
      rows,
      WLP_DRAFT_EXPORT_COLUMNS
    );

  const blob =
    new Blob(
      ["\uFEFF", text],
      {
        type:
          "text/tab-separated-values;charset=utf-8"
      }
    );

  const now = new Date();
  const dateStamp = [
    now.getFullYear(),
    String(
      now.getMonth() + 1
    ).padStart(2, "0"),
    String(
      now.getDate()
    ).padStart(2, "0")
  ].join("-");

  const url =
    URL.createObjectURL(blob);

  const a =
    document.createElement("a");

  a.href = url;
  a.download =
    `wlp-new-cards-${dateStamp}.tsv`;

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(
    () => URL.revokeObjectURL(url),
    0
  );
}

// =============================================================
// STAGE 5C.2 — IMPORT DRAFTS / UPDATED DRAFTS
// =============================================================

function planDraftImport(parsed) {

  const headers = parsed.headers || [];
  const rows = parsed.rows || [];

  if (!headers.includes("Word")) {
    throw new Error(
      "This TSV does not contain a Word column."
    );
  }

  const next = localAdditions.map(draft => ({ ...draft }));
  const idToIndex = new Map();
  const fingerprintToIndex = new Map();

  next.forEach((draft, index) => {
    if (draft.localId) {
      idToIndex.set(draft.localId, index);
    }
    fingerprintToIndex.set(draftContentFingerprint(draft), index);
  });

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let invalid = 0;
  let officialSkipped = 0;

  rows.forEach(row => {

    const word = String(row.Word || "").trim();
    const wordId = String(row.WordID || "").trim();

    if (!word) {
      invalid++;
      return;
    }

    // Import is intentionally Draft-only. Never pull official Master cards
    // into browser-local additions.
    if (wordId) {
      officialSkipped++;
      return;
    }

    const incomingId =
      String(row["Local Draft ID"] || "").trim();

    if (incomingId && idToIndex.has(incomingId)) {

      const index = idToIndex.get(incomingId);
      const existing = next[index];
      const incoming = importedRowToLocalDraft(row, existing);

      if (
        draftContentFingerprint(existing) ===
        draftContentFingerprint(incoming)
      ) {
        unchanged++;
        return;
      }

      // Keep the local identity and original creation time stable.
      incoming.localId = existing.localId;
      incoming.createdAt = existing.createdAt || incoming.createdAt;
      incoming.updatedAt = new Date().toISOString();
      next[index] = incoming;
      fingerprintToIndex.set(draftContentFingerprint(incoming), index);
      updated++;
      return;
    }

    const incoming = importedRowToLocalDraft(row);
    const fingerprint = draftContentFingerprint(incoming);

    // Older 12-column exports have no Local Draft ID. In that case,
    // exact duplicate content is safely skipped; changed same-word cards
    // are added rather than guessed as an update.
    if (fingerprintToIndex.has(fingerprint)) {
      unchanged++;
      return;
    }

    // Guard against a malformed file reusing a Local Draft ID that appeared
    // earlier in the same import operation.
    if (incoming.localId && idToIndex.has(incoming.localId)) {
      incoming.localId = makeLocalDraftId();
    }

    next.push(incoming);
    const newIndex = next.length - 1;
    idToIndex.set(incoming.localId, newIndex);
    fingerprintToIndex.set(fingerprint, newIndex);
    added++;
  });

  return {
    next,
    added,
    updated,
    unchanged,
    invalid,
    officialSkipped,
    sourceRows: rows.length
  };
}

function summarizeDraftImport(plan) {

  const lines = [
    `TSV rows: ${plan.sourceRows}`,
    `New drafts to add: ${plan.added}`,
    `Existing drafts to update: ${plan.updated}`,
    `Unchanged duplicates to skip: ${plan.unchanged}`
  ];

  if (plan.invalid) {
    lines.push(`Invalid rows to skip: ${plan.invalid}`);
  }

  if (plan.officialSkipped) {
    lines.push(
      `Rows with official WordID to skip: ${plan.officialSkipped}`
    );
  }

  return lines.join("\n");
}

async function importDraftTSVFile(file, editorView, draftsView) {

  if (!file) {
    return;
  }

  try {

    const text = await file.text();
    const parsed = parseTSVText(text);
    const plan = planDraftImport(parsed);

    if (!plan.sourceRows) {
      alert("This TSV contains no draft rows to import.");
      return;
    }

    const actionable = plan.added + plan.updated;

    if (!actionable) {
      alert(
        "Nothing needs to be imported.\n\n" +
        summarizeDraftImport(plan)
      );
      return;
    }

    const ok = confirm(
      "Import these Draft changes into this browser?\n\n" +
      summarizeDraftImport(plan) +
      "\n\nThe canonical Master TSV will not be changed."
    );

    if (!ok) {
      return;
    }

    localAdditions = plan.next;
    writeLocalAdditions();
    renderEditorDrafts(editorView);
    renderDraftDecks(draftsView);

    const status = editorView?.querySelector("#draft-import-status");
    if (status) {
      status.textContent =
        `Import complete: ${plan.added} added, ${plan.updated} updated, ${plan.unchanged} unchanged skipped.`;
    }

    alert(
      "Draft import complete.\n\n" +
      summarizeDraftImport(plan)
    );

  } catch (error) {
    console.error("Draft import failed:", error);
    alert(
      "Could not import this Draft TSV.\n\n" +
      (error?.message || String(error))
    );
  }
}

// =============================================================
// STAGE 5B.2 — DRAFT STUDY DECKS
// =============================================================

function renderDraftDecks(draftsView) {

  if (!draftsView) {
    return;
  }

  const summary =
    draftsView.querySelector(
      "#drafts-summary"
    );

  const list =
    draftsView.querySelector(
      "#draft-deck-list"
    );

  if (!summary || !list) {
    return;
  }

  if (!localAdditions.length) {
    summary.textContent =
      "No local drafts yet. Add one in Editor and it will appear here.";
    list.innerHTML = "";
    return;
  }

  const deckCount =
    Math.ceil(
      localAdditions.length / 10
    );

  summary.textContent =
    `${localAdditions.length} local draft${
      localAdditions.length === 1 ? "" : "s"
    } · ${deckCount} Draft Deck${
      deckCount === 1 ? "" : "s"
    } · stored only in this browser`;

  const cards = [];

  for (
    let i = 0;
    i < localAdditions.length;
    i += 10
  ) {

    const deckNo =
      Math.floor(i / 10) + 1;

    const slice =
      localAdditions.slice(
        i,
        i + 10
      );

    const words =
      slice
        .map(
          draft => draft.Word
        )
        .filter(Boolean)
        .join(" · ");

    cards.push(`
      <a
        class="draft-deck-card"
        href="flashcards/wlp/batch.html?draft=${deckNo}"
      >
        <span class="draft-deck-title">
          Draft Deck ${pad3(deckNo)}
        </span>
        <span class="draft-deck-count">
          ${slice.length} card${slice.length === 1 ? "" : "s"}
        </span>
        <span class="draft-deck-words">
          ${escapeHtml(words)}
        </span>
      </a>
    `);
  }

  list.innerHTML =
    cards.join("");
}

// =============================================================
// STYLES
// =============================================================

function installStage3Styles() {

  if (
    document.getElementById(
      "wlp-stage3-styles"
    )
  ) {
    return;
  }

  const style =
    document.createElement(
      "style"
    );

  style.id =
    "wlp-stage3-styles";

  style.textContent = `

    .wlp-subnav {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 1.8rem;
      margin: 0.2rem auto 1.8rem;
      flex-wrap: wrap;
    }

    .wlp-subnav button {
      appearance: none;
      border: 0;
      border-bottom: 1px solid transparent;
      background: transparent;

      padding: 0.25rem 0.15rem;

      color: #6d6660;

      font-family:
        'Cinzel',
        serif;

      font-size: 0.78rem;

      letter-spacing: 0.035em;

      cursor: pointer;

      opacity: 0.82;

      transition:
        color 0.2s ease,
        border-color 0.2s ease,
        opacity 0.2s ease;
    }

    .wlp-subnav button:hover {
      color: #3d5b36;
      opacity: 1;
    }

    .wlp-subnav button.active {
      color: #4c6939;
      border-bottom-color: #93a386;
      opacity: 1;
    }

    .wlp-editor-pending-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.35em;
      height: 1.35em;
      margin-left: 0.32rem;
      padding: 0 0.32em;
      border-radius: 999px;
      background: rgba(147, 163, 134, 0.18);
      color: #4c6939;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 0.72em;
      font-weight: 650;
      line-height: 1;
      letter-spacing: 0;
      vertical-align: middle;
    }

    .wlp-editor-pending-badge[hidden] {
      display: none;
    }


    .wlp-role-strip {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 0.55rem;
      margin: -0.85rem auto 1.5rem;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 0.78rem;
      color: #746e68;
    }

    .wlp-role-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.26rem 0.58rem;
      border: 1px solid rgba(109, 102, 96, 0.22);
      border-radius: 999px;
      background: rgba(255,255,255,0.42);
    }

    .wlp-role-strip button {
      border: 0;
      background: transparent;
      color: #4c6939;
      font: inherit;
      text-decoration: underline;
      text-underline-offset: 0.18em;
      cursor: pointer;
      padding: 0.12rem 0.18rem;
    }

    .wlp-access-gate {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: grid;
      place-items: center;
      padding: 1.25rem;
      background: rgba(246, 243, 235, 0.96);
      backdrop-filter: blur(8px);
    }

    .wlp-access-card {
      width: min(430px, 100%);
      box-sizing: border-box;
      padding: 1.7rem 1.5rem;
      border: 1px solid rgba(95, 104, 85, 0.25);
      border-radius: 18px;
      background: rgba(255,255,255,0.82);
      box-shadow: 0 12px 40px rgba(65, 58, 49, 0.10);
      text-align: center;
    }

    .wlp-access-card h2 {
      margin: 0 0 0.55rem;
      font-family: 'Cinzel', serif;
      font-size: 1.08rem;
      color: #4c6939;
    }

    .wlp-access-card p {
      margin: 0 0 1.15rem;
      line-height: 1.55;
      color: #6d6660;
    }

    .wlp-access-actions {
      display: flex;
      justify-content: center;
      gap: 0.7rem;
      flex-wrap: wrap;
    }

    .wlp-access-actions button {
      min-width: 128px;
      border: 1px solid rgba(76, 105, 57, 0.28);
      border-radius: 999px;
      padding: 0.62rem 1rem;
      background: rgba(255,255,255,0.9);
      color: #4c6939;
      cursor: pointer;
      font: inherit;
    }

    .wlp-access-actions button:hover {
      background: rgba(147, 163, 134, 0.12);
    }

    .wlp-admin-password-label {
      display: grid;
      gap: 0.38rem;
      margin: 0 auto 0.8rem;
      text-align: left;
      color: #615b55;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 0.86rem;
    }

    .wlp-password-wrap {
      position: relative;
      display: block;
    }

    .wlp-admin-password-label input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid rgba(95, 104, 85, 0.28);
      border-radius: 10px;
      padding: 0.68rem 2.8rem 0.68rem 0.75rem;
      background: rgba(255,255,255,0.92);
      color: #3f3a36;
      font: inherit;
    }

    .wlp-password-toggle {
      position: absolute;
      top: 50%;
      right: 0.42rem;
      transform: translateY(-50%);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: #615b55;
      cursor: pointer;
      font-size: 1rem;
      line-height: 1;
    }

    .wlp-password-toggle:hover,
    .wlp-password-toggle:focus-visible {
      background: rgba(147, 163, 134, 0.14);
      outline: none;
    }

    .wlp-remember-admin {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 0.5rem;
      margin: 0 0 1rem;
      color: #615b55;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 0.84rem;
      text-align: left;
      cursor: pointer;
    }

    .wlp-remember-admin input {
      margin: 0;
      accent-color: #617b4d;
    }

    .wlp-admin-login-error {
      margin: -0.25rem 0 0.85rem !important;
      color: #8a433f !important;
      font-size: 0.82rem;
    }

    .wlp-view {
      display: none;
    }

    .wlp-view.active {
      display: block;
    }


    /* ---------------- DRAFT DECKS ---------------- */

    .drafts-wrap {
      width: min(880px, 100%);
      margin: 0 auto;
    }

    .drafts-summary {
      text-align: center;
      color: #777067;
      margin: 0 auto 1.35rem;
      font-size: 0.92rem;
    }

    .draft-deck-grid {
      display: grid;
      grid-template-columns:
        repeat(auto-fit, minmax(210px, 270px));
      justify-content: center;
      gap: 0.9rem;
      max-width: 850px;
      margin: 0 auto;
    }

    .draft-deck-card {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      min-width: 0;
      padding: 0.9rem 1rem;
      border: 1px solid rgba(109, 102, 96, 0.24);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.30);
      text-align: left;
      text-decoration: none;
      box-sizing: border-box;
    }

    .draft-deck-card:hover {
      border-color: rgba(76, 105, 57, 0.45);
      text-decoration: none;
    }

    .draft-deck-title {
      font-family: 'Cinzel', serif;
      color: #4c6939;
      font-size: 0.88rem;
    }

    .draft-deck-count {
      color: #777067;
      font-size: 0.82rem;
    }

    .draft-deck-words {
      color: #5f5a54;
      font-family: 'EB Garamond', serif;
      font-size: 0.92rem;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    /* ---------------- REVIEW DECKS ---------------- */

    .review-decks-wrap {
      width: min(900px, 100%);
      margin: 0 auto;
    }

    .review-summary-line {
      text-align: center;
      color: #777067;
      margin-bottom: 1.5rem;
      font-size: 0.92rem;
    }

    .review-deck-grid {
      display: grid;

      grid-template-columns:
        repeat(
          auto-fit,
          minmax(190px, 270px)
        );

      justify-content: center;
      gap: 0.85rem;

      max-width: 850px;

      margin: 0 auto;
    }

    .review-deck-card {
      border:
        1px solid
        rgba(
          76,
          105,
          57,
          0.18
        );

      border-radius: 10px;

      padding:
        1rem
        0.8rem;

      background:
        rgba(
          255,
          255,
          255,
          0.18
        );

      text-align: center;
    }

    .review-deck-card a {
      display: block;

      font-family:
        'Cinzel',
        serif;

      font-size: 0.9rem;

      margin-bottom:
        0.55rem;
    }

    .review-deck-count {
      font-size: 0.8rem;
      color: #777067;
    }

    .review-deck-preview {
      margin-top: 0.55rem;

      font-size: 0.83rem;

      color: #5f5b53;

      line-height: 1.4;
    }

    .review-empty {
      text-align: center;

      padding:
        2.8rem
        1rem;

      color: #777067;
    }

    /* ---------------- PROGRESS ---------------- */

    .progress-wrap {
      width: min(960px, 100%);
      margin: 0 auto;
      text-align: left;
    }

    .progress-summary {
      display: grid;

      grid-template-columns:
        repeat(
          4,
          minmax(120px, 1fr)
        );

      gap: 0.8rem;

      margin:
        0 auto
        1.4rem;
    }

    .progress-stat {
      border:
        1px solid
        rgba(
          76,
          105,
          57,
          0.18
        );

      border-radius: 10px;

      padding:
        0.9rem
        0.75rem;

      text-align: center;

      background:
        rgba(
          255,
          255,
          255,
          0.22
        );
    }

    .progress-stat strong {
      display: block;

      font-family:
        'Cinzel',
        serif;

      font-size: 1.2rem;

      color: #3d5b36;

      margin-bottom:
        0.2rem;
    }

    .progress-stat span {
      font-size: 0.8rem;
      color: #777067;
    }

    .progress-toolbar {
      display: flex;

      justify-content:
        space-between;

      align-items: center;

      gap: 1rem;

      flex-wrap: wrap;

      margin-bottom:
        0.8rem;
    }

    .progress-toolbar select {
      font-family:
        'EB Garamond',
        serif;

      font-size: 0.9rem;

      color: #3a3a2f;

      background: #f8f3e8;

      border:
        1px solid
        rgba(
          76,
          105,
          57,
          0.28
        );

      border-radius: 7px;

      padding:
        0.35rem
        0.55rem;
    }
    
	    .progress-backup-tools {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 0.55rem;
      flex-wrap: wrap;
      margin: 0 0 1rem;
    }

    .progress-backup-tools button {
      appearance: none;

      font-family:
        'EB Garamond',
        serif;

      font-size: 0.88rem;

      color: #4c6939;

      background:
        rgba(
          255,
          255,
          255,
          0.28
        );

      border:
        1px solid
        rgba(
          76,
          105,
          57,
          0.28
        );

      border-radius: 7px;

      padding:
        0.38rem
        0.65rem;

      cursor: pointer;
    }

    .progress-backup-tools button:hover {
      background:
        rgba(
          255,
          255,
          255,
          0.48
        );
    }
	
	
    .progress-list {
      display: grid;
      gap: 0.55rem;
    }

    .progress-row {
      display: grid;

      grid-template-columns:
        minmax(180px, 2fr)
        0.8fr
        0.8fr
        1fr
        1fr;

      gap: 0.7rem;

      align-items: center;

      padding:
        0.7rem
        0.8rem;

      border-bottom:
        1px solid
        rgba(
          76,
          105,
          57,
          0.13
        );
    }

    .progress-row .word {
      font-weight: bold;
      color: #2e2a1e;
    }

    .progress-row .word a {
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  text-decoration: none;
}

.progress-row .word a:hover {
  color: #4c6939;
  text-decoration: underline;
}

.progress-jump-link {
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  text-decoration: none;
  border-bottom:
    1px dotted
    rgba(
      76,
      105,
      57,
      0.38
    );
}

.progress-jump-link:hover {
  color: #4c6939;
  border-bottom-color:
    #4c6939;
}

    .progress-row .meta,
    .progress-row .count,
    .progress-row .status {
      font-size: 0.84rem;
      color: #6d6660;
    }

    .progress-row .status.reviewing {
      color: #8a5a36;
      font-weight: bold;
    }

    .progress-row .status.studied {
      color: #4c6939;
      font-weight: bold;
    }

    .progress-attempts-clear {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
  min-width: 0;
}

.progress-clear-one,
.progress-clear-all {
  appearance: none;
  font-family: 'EB Garamond', serif;
  cursor: pointer;
  border-radius: 7px;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}

.progress-clear-one {
  flex: 0 0 auto;
  border: 0;
  border-bottom:
    1px solid transparent;
  background: transparent;
  padding: 0.12rem 0;
  font-size: 0.78rem;
  color: #8a6658;
  opacity: 0.82;
}

.progress-clear-one:hover {
  color: #6f4034;
  border-bottom-color:
    rgba(111, 64, 52, 0.42);
  opacity: 1;
}

.progress-clear-all-wrap {
  display: flex;
  justify-content: center;
  margin-top: 1.8rem;
  padding-top: 1rem;
  border-top:
    1px solid
    rgba(76, 105, 57, 0.13);
}

.progress-clear-all {
  border:
    1px solid
    rgba(125, 70, 55, 0.32);
  background:
    rgba(255, 255, 255, 0.2);
  padding:
    0.42rem 0.75rem;
  font-size: 0.86rem;
  color: #7d4637;
}

.progress-clear-all:hover {
  background:
    rgba(125, 70, 55, 0.08);
  border-color:
    rgba(125, 70, 55, 0.5);
}
	
    .progress-empty {
      text-align: center;

      padding:
        2.5rem
        1rem;

      color: #777067;

      font-size: 0.95rem;
    }


    /* ---------------- STAGE 5A / EDITOR ---------------- */

    .editor-wrap {
      width: min(760px, 100%);
      margin: 0 auto;
      text-align: center;
    }

    .editor-panel {
      border: 1px solid rgba(76, 105, 57, 0.20);
      border-radius: 12px;
      padding: 1.35rem 1rem;
      background: rgba(255, 255, 255, 0.18);
    }

    .editor-panel p {
      margin: 0 auto 1rem;
      max-width: 620px;
      color: #6d6660;
      font-size: 0.92rem;
      line-height: 1.55;
    }

    .editor-panel button {
      appearance: none;
      border: 1px solid rgba(76, 105, 57, 0.34);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.30);
      color: #3d5b36;
      padding: 0.5rem 1rem;
      font-family: 'Cinzel', serif;
      font-size: 0.78rem;
      cursor: pointer;
    }

    .editor-panel button:hover {
      border-color: rgba(76, 105, 57, 0.62);
      background: rgba(255, 255, 255, 0.48);
    }

    .editor-count {
      margin-top: 0.8rem;
      color: #777067;
      font-size: 0.82rem;
    }


    .editor-panel h3 {
      margin: 0.25rem 0 0.65rem;
      font-size: 1rem;
      color: #4c6939;
    }

    .local-draft-form {
      display: grid;
      gap: 0.75rem;
      margin-top: 1rem;
      text-align: left;
    }

    .local-draft-form label {
      display: grid;
      gap: 0.3rem;
      font-size: 0.86rem;
      color: #5e5852;
    }

    .local-draft-form input,
    .local-draft-form textarea {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid rgba(100, 92, 84, 0.28);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.5);
      color: inherit;
      font: inherit;
      padding: 0.55rem 0.65rem;
    }

    .local-draft-form textarea {
      resize: vertical;
      min-height: 3rem;
    }

    .draft-two-col {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.75rem;
    }

    .draft-form-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      justify-content: flex-start;
    }

    .editor-panel .draft-secondary {
      background: transparent;
      color: #6d6660;
    }

    .draft-required {
      color: #9a5d4e;
    }

    .editor-divider {
      height: 1px;
      background: rgba(100, 92, 84, 0.18);
      margin: 1.5rem 0;
    }

    .editor-muted {
      color: #807870;
      font-size: 0.9rem;
    }

    .local-draft-list {
      display: grid;
      gap: 0.55rem;
    }

    .local-draft-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.8rem;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow: hidden;
      padding: 0.65rem 0.75rem;
      border: 1px solid rgba(100, 92, 84, 0.18);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.34);
      text-align: left;
    }

    .local-draft-main {
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      flex: 1 1 auto;
    }

    .local-draft-word {
      font-weight: 600;
      color: #3f4f35;
    }

    .local-draft-meta {
      margin-top: 0.15rem;
      font-size: 0.75rem;
      color: #8a8178;
    }

    .local-draft-detail {
      margin-top: 0.2rem;
      font-size: 0.84rem;
      line-height: 1.4;
      color: #665f58;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .local-draft-word,
    .local-draft-meta {
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .editor-panel .local-draft-delete {
      flex: 0 0 auto;
      background: transparent;
      color: #8a5a50;
      border-color: rgba(138, 90, 80, 0.28);
      padding: 0.35rem 0.6rem;
      font-size: 0.78rem;
    }

    @media screen and (max-width: 600px) {
      .draft-two-col {
        grid-template-columns: 1fr;
      }

      .local-draft-row {
        align-items: flex-start;
      }
    }

    @media screen and (max-width: 700px) {

      .progress-summary {
        grid-template-columns:
          repeat(
            2,
            minmax(
              110px,
              1fr
            )
          );
      }

      .progress-row {
        grid-template-columns:
          minmax(
            150px,
            1.7fr
          )
          0.8fr
          0.8fr;
      }

    }

    @media screen and (max-width: 480px) {

      .wlp-subnav {
        gap: 1.05rem;
      }

      .wlp-subnav button {
        font-size: 0.68rem;
      }

      .progress-row {
        grid-template-columns:
          1fr
          0.65fr
          0.65fr;

        gap: 0.45rem;

        padding:
          0.65rem
          0.3rem;
      }

      .progress-row .meta {
        display: none;
      }

    }

  `;

  document.head.appendChild(
    style
  );

}

// =============================================================
// EXISTING DECK AREA
// =============================================================

function findDeckArea() {

  const grid =
    document.querySelector(
      "#wlp .grid-container"
    );

  const note =
    document.querySelector(
      "#wlp .note"
    );

  if (!grid) {
    return null;
  }

  const wrapper =
    document.createElement(
      "div"
    );

  wrapper.id =
    "wlp-decks-view";

  wrapper.className =
    "wlp-view active";

  grid.parentNode.insertBefore(
    wrapper,
    grid
  );

  wrapper.appendChild(
    grid
  );

  if (
    note &&
    note.parentNode
  ) {

    wrapper.appendChild(
      note
    );

  }

  return wrapper;

}

// =============================================================
// REVIEW DECK SCREEN
// =============================================================

function renderReviewDecks() {

  const container =
    document.getElementById(
      "review-decks-container"
    );

  if (!container) {
    return;
  }

  const decks =
    makeReviewDecks();

  const totalCards =
    decks.reduce(
      (sum, deck) =>
        sum + deck.length,
      0
    );

  if (!decks.length) {

    container.innerHTML = `

      <div class="review-empty">

        No cards are currently
        marked Review.

        <br><br>

        Press Review on a flashcard
        and it will appear here.

      </div>

    `;

    return;

  }

  const deckHtml =
    decks
      .map(
        (deck, index) => {

          const deckNo =
            index + 1;

          return `

            <div class="review-deck-card">

              <a
                href="flashcards/wlp/batch.html?review=${pad3(deckNo)}"
              >
                Review Deck ${pad3(deckNo)}
              </a>

              <div class="review-deck-count">
                ${deck.length}
                card${deck.length === 1 ? "" : "s"}
              </div>

            </div>

          `;

        }
      )
      .join("");

  container.innerHTML = `

    <div class="review-summary-line">

      ${totalCards}
      card${totalCards === 1 ? "" : "s"}
      currently need review

      ·

      ${decks.length}
      review deck${decks.length === 1 ? "" : "s"}

    </div>

    <div class="review-deck-grid">
      ${deckHtml}
    </div>

  `;

}

// =============================================================
// PROGRESS
// =============================================================

function progressStatus(record) {

  if (
    record.review ||
    record.lastResult ===
      "review"
  ) {
    return "Review";
  }

  if (
    record.known ||
    record.lastResult ===
      "studied"
  ) {
    return "Studied";
  }

  return "Recorded";

}

function renderProgress() {

  const summary =
    document.getElementById(
      "progress-summary"
    );

  const list =
    document.getElementById(
      "progress-list"
    );

  const filter =
    document.getElementById(
      "progress-filter"
    );

  const caption =
    document.getElementById(
      "progress-caption"
    );

  if (
    !summary ||
    !list
  ) {
    return;
  }

  const all =
    getAllProgressRecords();

  const reviewing =
    all.filter(
      r =>
        r.review ||
        r.lastResult ===
          "review"
    );

  const studied =
    all.filter(
      r =>
        !r.review &&
        (
          r.known ||
          r.lastResult ===
            "studied"
        )
    );

  const review3 =
    all.filter(
      r =>
        r.reviewCount >= 3
    );

  const totalReviews =
    all.reduce(
      (sum, r) =>
        sum +
        r.reviewCount,
      0
    );

  summary.innerHTML = `

    <div class="progress-stat">

      <strong>
        ${all.length}
      </strong>

      <span>
        Recorded Cards
      </span>

    </div>

    <div class="progress-stat">

      <strong>
        ${reviewing.length}
      </strong>

      <span>
        Review Now
      </span>

    </div>

    <div class="progress-stat">

      <strong>
        ${studied.length}
      </strong>

      <span>
        Studied Now
      </span>

    </div>

    <div class="progress-stat">

      <strong>
        ${totalReviews}
      </strong>

      <span>
        Total Review Presses
      </span>

    </div>

  `;

  let shown =
    [...all];

  const mode =
    filter
      ? filter.value
      : "all";

  if (
    mode === "review"
  ) {
    shown =
      reviewing;
  }

  if (
    mode === "studied"
  ) {
    shown =
      studied;
  }

  if (
    mode === "review3"
  ) {
    shown =
      review3;
  }

  shown.sort(
    (a, b) => {

      if (
        b.reviewCount !==
        a.reviewCount
      ) {

        return (
          b.reviewCount -
          a.reviewCount
        );

      }

      return (
        b.lastSeen -
        a.lastSeen
      );

    }
  );

  if (caption) {

    caption.textContent =
      `${shown.length} card${
        shown.length === 1
          ? ""
          : "s"
      }`;

  }

  if (!shown.length) {

    list.innerHTML = `

      <div class="progress-empty">
        No cards match this view yet.
      </div>

    `;

    return;

  }

  list.innerHTML =
    shown
      .map(record => {

        const row =
          wlpRowByWordId.get(
            record.wordId
          ) || {};

        const word =
          row["Word"] ||
          `WordID ${record.wordId}`;

        const batch =
          row["Batch #"] ||
          "—";

        const guidance =
          row["Guidance #"] ||
          "—";

        const status =
          progressStatus(record);

        const statusClass =
          status === "Review"
            ? "reviewing"
            : status === "Studied"
              ? "studied"
              : "";

        const batchDisplay =
          batch === "—"
            ? "—"
            : pad3(batch);

        return `

          <div class="progress-row">

            <div>

  <div class="word">

    ${
      batch !== "—"
        ? `
          <a
            href="flashcards/wlp/batch.html?batch=${encodeURIComponent(
              batchDisplay
            )}&wordid=${encodeURIComponent(
              record.wordId
            )}&from=progress"
            title="Open this word in its original Deck"
          >
            ${escapeHtml(word)}
          </a>
        `
        : escapeHtml(word)
    }

  </div>

  <div class="meta">

    WID

    ${
      batch !== "—"
        ? `
          <a
            class="progress-jump-link"
            href="flashcards/wlp/batch.html?batch=${encodeURIComponent(
              batchDisplay
            )}&wordid=${encodeURIComponent(
              record.wordId
            )}&solo=1&from=progress"
            title="Open only this card"
          >
            ${escapeHtml(
              record.wordId
            )}
          </a>
        `
        : escapeHtml(
            record.wordId
          )
    }

    · Deck

    ${
      batch !== "—"
        ? `
          <a
            class="progress-jump-link"
            href="flashcards/wlp/batch.html?batch=${encodeURIComponent(
              batchDisplay
            )}&from=progress"
            title="Open this Deck from its first card"
          >
            ${escapeHtml(
              batchDisplay
            )}
          </a>
        `
        : "—"
    }

    · #
    ${escapeHtml(
      guidance
    )}

  </div>

</div>

            <div class="count">

              Review ×
              ${record.reviewCount}

            </div>

            <div class="count">

              Studied ×
              ${record.studyCount}

            </div>

            <div
              class="status ${statusClass}"
            >

              ${status}

            </div>

            <div class="meta progress-attempts-clear">

  <span>
    Attempts ${record.attempts}
  </span>

  <button
    type="button"
    class="progress-clear-one"
    data-clear-progress-wordid="${escapeHtml(record.wordId)}"
  >
    Clear Progress
  </button>

</div>

          </div>

        `;

      })
      .join("");

}

// =============================================================
// GUEST / ADMIN UI MODE
// =============================================================

function applyWlpUiRole(nav, decksView, reviewView, progressView, draftsView, editorView) {
  const role = getWlpUiRole();
  const isAdmin = role === "admin";

  const draftsButton = nav.querySelector('[data-wlp-view="drafts"]');
  const editorButton = nav.querySelector('[data-wlp-view="editor"]');
  if (draftsButton) draftsButton.hidden = !isAdmin;
  if (editorButton) editorButton.hidden = !isAdmin;

  draftsView.hidden = !isAdmin;
  editorView.hidden = !isAdmin;

  if (!isAdmin && (draftsView.classList.contains("active") || editorView.classList.contains("active"))) {
    draftsView.classList.remove("active");
    editorView.classList.remove("active");
    [reviewView, progressView].forEach(v => v.classList.remove("active"));
    decksView.classList.add("active");
    nav.querySelectorAll('button[data-wlp-view]').forEach(b => b.classList.remove("active"));
    const deckButton = nav.querySelector('[data-wlp-view="decks"]');
    if (deckButton) deckButton.classList.add("active");
  }

  const roleLabel = document.getElementById("wlp-role-label");
  const roleAction = document.getElementById("wlp-role-action");
  if (roleLabel) roleLabel.textContent = isAdmin ? "Admin mode" : "Guest mode";
  if (roleAction) roleAction.textContent = isAdmin ? "Switch to Guest" : "Admin login";
}

function installRoleStrip(nav, decksView, reviewView, progressView, draftsView, editorView) {
  if (document.getElementById("wlp-role-strip")) return;
  const strip = document.createElement("div");
  strip.id = "wlp-role-strip";
  strip.className = "wlp-role-strip";
  strip.innerHTML = `
    <span class="wlp-role-pill"><span id="wlp-role-label">Guest mode</span></span>
    <button type="button" id="wlp-role-action">Admin login</button>
  `;
  nav.insertAdjacentElement("afterend", strip);

  strip.querySelector("#wlp-role-action").addEventListener("click", async () => {
    if (getWlpUiRole() === "admin") {
      clearWlpAdminAccess();
      applyWlpUiRole(nav, decksView, reviewView, progressView, draftsView, editorView);
      return;
    }
    if (await requestAdminAccess()) {
      applyWlpUiRole(nav, decksView, reviewView, progressView, draftsView, editorView);
    }
  });
}

// =============================================================
// SUBNAV
// =============================================================

function installWlpSubnav() {

  const wlp =
    document.getElementById(
      "wlp"
    );

  if (
    !wlp ||
    document.getElementById(
      "wlp-subnav"
    )
  ) {
    return;
  }

  const decksView =
    findDeckArea();

  if (!decksView) {
    return;
  }

  const heading =
    wlp.querySelector("h2");

  const nav =
    document.createElement(
      "nav"
    );

  nav.id =
    "wlp-subnav";

  nav.className =
    "wlp-subnav";

  nav.setAttribute(
    "aria-label",
    "WLP sections"
  );

  nav.innerHTML = `

    <button
      type="button"
      class="active"
      data-wlp-view="decks"
    >
      Decks
    </button>

    <button
      type="button"
      data-wlp-view="review"
    >
      Review Decks
    </button>

    <button
      type="button"
      data-wlp-view="progress"
    >
      Progress
    </button>

    <button
      type="button"
      data-wlp-view="drafts"
    >
      Drafts
    </button>

    <button
      type="button"
      data-wlp-view="editor"
    >
      Editor
      <span
        id="editor-pending-badge"
        class="wlp-editor-pending-badge"
        hidden
        aria-hidden="true"
      ></span>
    </button>

  `;

  const reviewView =
    document.createElement(
      "section"
    );

  reviewView.id =
    "wlp-review-view";

  reviewView.className =
    "wlp-view";

  reviewView.innerHTML = `

    <h2>
      — Review Decks —
    </h2>

    <div
      id="review-decks-container"
      class="review-decks-wrap"
    ></div>

  `;

  const progressView =
    document.createElement(
      "section"
    );

  progressView.id =
    "wlp-progress-view";

  progressView.className =
    "wlp-view";

  progressView.innerHTML = `

    <h2>
      — Progress —
    </h2>

    <div class="progress-wrap">

      <div
        id="progress-summary"
        class="progress-summary"
      ></div>

           <div
        class="progress-backup-tools"
      >

        <button
          type="button"
          id="progress-export"
        >
          Export Progress
        </button>

        <button
          type="button"
          id="progress-import"
        >
          Import Progress
        </button>

        <input
          type="file"
          id="progress-import-file"
          accept=".json,application/json"
          hidden
        />

      </div>


      <div
        class="progress-toolbar"
      >

        <div
          id="progress-caption"
        >
          Recorded cards
        </div>

        <select
          id="progress-filter"
          aria-label="Progress filter"
        >

          <option value="all">
            All recorded
          </option>

          <option value="review">
            Currently reviewing
          </option>

          <option value="studied">
            Currently studied
          </option>

          <option value="review3">
            Review 3+ times
          </option>

        </select>

      </div>

      <div
        id="progress-list"
        class="progress-list"
      ></div>
    <div class="progress-clear-all-wrap">

  <button
    type="button"
    id="progress-clear-all"
    class="progress-clear-all"
  >
    Clear All Progress
  </button>

</div>
	
    </div>

  `;

  const draftsView =
    document.createElement(
      "section"
    );

  draftsView.id =
    "wlp-drafts-view";

  draftsView.className =
    "wlp-view";

  draftsView.innerHTML = `

    <h2>
      — Drafts —
    </h2>

    <div class="drafts-wrap">
      <p
        id="drafts-summary"
        class="drafts-summary"
      ></p>

      <div
        id="draft-deck-list"
        class="draft-deck-grid"
      ></div>
    </div>

  `;

  const editorView =
    document.createElement(
      "section"
    );

  editorView.id =
    "wlp-editor-view";

  editorView.className =
    "wlp-view";

  editorView.innerHTML = `

    <h2>
      — WLP Editor —
    </h2>

    <div class="editor-wrap">
      <div class="editor-panel">
        <h3 id="editor-create-section">Add Card / Save Draft</h3>
        <p>
          Save a new card locally in this browser. Local drafts do not receive an official Master WordID yet and do not modify the canonical Master TSV.
        </p>

        <form id="local-draft-form" class="local-draft-form">
          <label>
            Word <span class="draft-required">*</span>
            <input name="Word" type="text" required autocomplete="off" />
          </label>
          <div class="draft-two-col">
            <label>
              IPA
              <input name="IPA" type="text" autocomplete="off" />
            </label>
            <label>
              Part of Speech
              <input name="Part of Speech" type="text" list="wlp-pos-options" autocomplete="off" placeholder="Choose or type…" />
            </label>
          </div>
          <label>
            Definition
            <textarea name="Definition" rows="3"></textarea>
          </label>
          <label>
            Synonym(s)
            <textarea name="Synonym(s)" rows="2"></textarea>
          </label>
          <label>
            Example Sentence
            <textarea name="Example Sentence" rows="3"></textarea>
          </label>
          <label>
            Note(s)
            <textarea name="Note(s)" rows="3"></textarea>
          </label>
          <div class="draft-two-col">
            <label>
              Category
              <input name="Category" type="text" autocomplete="off" />
            </label>
            <label>
              Source
              <input name="Source" type="text" autocomplete="off" />
            </label>
          </div>
          <div class="draft-form-actions">
            <button type="submit">Save Draft</button>
            <button type="reset" class="draft-secondary">Clear Form</button>
          </div>
        </form>

        <datalist id="wlp-pos-options">
          <option value="noun"></option>
          <option value="verb"></option>
          <option value="adjective"></option>
          <option value="adverb"></option>
          <option value="pronoun"></option>
          <option value="preposition"></option>
          <option value="complex preposition"></option>
          <option value="conjunction"></option>
          <option value="interjection"></option>
          <option value="determiner"></option>
          <option value="proper noun"></option>
          <option value="noun phrase"></option>
          <option value="verb phrase"></option>
          <option value="adjective phrase"></option>
          <option value="adverbial phrase"></option>
          <option value="prepositional phrase"></option>
          <option value="phrasal verb"></option>
          <option value="idiom"></option>
          <option value="phrase"></option>
          <option value="expression"></option>
          <option value="collocation"></option>
          <option value="verb construction"></option>
          <option value="verb pattern"></option>
          <option value="slang"></option>
        </datalist>

        <div class="editor-divider"></div>

        <h3 id="editor-drafts-section">Local Drafts</h3>
        <p id="local-draft-empty" class="editor-muted">
          No local drafts yet.
        </p>
        <div id="local-draft-list" class="local-draft-list"></div>

        <div class="editor-divider"></div>

        <h3 id="editor-local-edits-section">Local Edits</h3>
        <p>Changes made to existing Master cards appear here. These local edits override the canonical card only in this browser until you revert them.</p>
        <p id="local-override-empty" class="editor-muted">No local edits yet.</p>
        <div id="local-override-list" class="local-draft-list"></div>

        <div class="editor-divider"></div>

        <h3 id="editor-backup-section">Backup · Import &amp; Export</h3>
        <p>
          Export the current effective deck, export only browser-local drafts for transfer/enrichment, or import Draft TSV data from another device/browser. New Cards exports include Local Draft ID metadata so an enriched copy can update the same Draft instead of creating a duplicate. Draft import never modifies the canonical Master TSV. Progress has its own separate backup.
        </p>

        <button
          type="button"
          id="deck-export-entire"
        >
          Export Entire Deck (.tsv)
        </button>

        <button
          type="button"
          id="deck-export-new-only"
        >
          Export New Cards Only (.tsv)
        </button>

        <input
          type="file"
          id="draft-import-file"
          accept=".tsv,text/tab-separated-values,text/plain"
          hidden
        />
        <button
          type="button"
          id="draft-import-button"
        >
          Import Drafts / Updated Drafts (.tsv)
        </button>

        <div
          id="draft-import-status"
          class="editor-count"
          aria-live="polite"
        ></div>

        <div
          id="editor-card-count"
          class="editor-count"
        ></div>
      </div>
    </div>

  `;

  if (heading) {

    heading.insertAdjacentElement(
      "afterend",
      nav
    );

  } else {

    wlp.prepend(nav);

  }

  decksView.insertAdjacentElement(
    "afterend",
    reviewView
  );

  reviewView.insertAdjacentElement(
    "afterend",
    progressView
  );

  progressView.insertAdjacentElement(
    "afterend",
    draftsView
  );

  draftsView.insertAdjacentElement(
    "afterend",
    editorView
  );

  renderDraftDecks(
    draftsView
  );

  renderEditorDrafts(
    editorView
  );

  renderEditorOverrides(
    editorView
  );

  updateEditorPendingBadge();

  installRoleStrip(nav, decksView, reviewView, progressView, draftsView, editorView);
  applyWlpUiRole(nav, decksView, reviewView, progressView, draftsView, editorView);

  nav
    .querySelectorAll(
      "button[data-wlp-view]"
    )
    .forEach(btn => {

      btn.addEventListener(
        "click",
        () => {

          nav
            .querySelectorAll(
              "button"
            )
            .forEach(
              b =>
                b.classList.remove(
                  "active"
                )
            );

          btn.classList.add(
            "active"
          );

          [
            decksView,
            reviewView,
            progressView,
            draftsView,
            editorView
          ].forEach(
            v =>
              v.classList.remove(
                "active"
              )
          );

          const target =
            btn.dataset.wlpView;

          if (
            target === "review"
          ) {

            reviewView
              .classList
              .add("active");

            renderReviewDecks();

          } else if (
            target ===
              "progress"
          ) {

            progressView
              .classList
              .add("active");

            renderProgress();

          } else if (
            target ===
              "drafts"
          ) {

            draftsView
              .classList
              .add("active");

            renderDraftDecks(
              draftsView
            );

          } else if (
            target ===
              "editor"
          ) {

            editorView
              .classList
              .add("active");

            renderEditorDrafts(
              editorView
            );
            renderEditorOverrides(
              editorView
            );
            updateEditorPendingBadge();

          } else {

            decksView
              .classList
              .add("active");

          }

        }
      );

    });

  const localDraftForm =
    editorView.querySelector(
      "#local-draft-form"
    );

  if (localDraftForm) {
    localDraftForm.addEventListener(
      "submit",
      event => {
        event.preventDefault();

        if (
          addLocalDraftFromForm(
            localDraftForm
          )
        ) {
          renderEditorDrafts(
            editorView
          );
          renderDraftDecks(
            draftsView
          );
        }
      }
    );
  }

  const localDraftList =
    editorView.querySelector(
      "#local-draft-list"
    );

  if (localDraftList) {
    localDraftList.addEventListener(
      "click",
      event => {

        const button =
          event.target.closest(
            "[data-delete-local-draft]"
          );

        if (!button) {
          return;
        }

        if (
          deleteLocalDraft(
            button.dataset.deleteLocalDraft
          )
        ) {
          renderEditorDrafts(
            editorView
          );
          renderDraftDecks(
            draftsView
          );
        }
      }
    );
  }

  const localOverrideList =
    editorView.querySelector(
      "#local-override-list"
    );

  if (localOverrideList) {
    localOverrideList.addEventListener(
      "click",
      event => {
        const button = event.target.closest("[data-revert-local-override]");
        if (!button) return;
        revertLocalOverrideFromEditor(
          button.dataset.revertLocalOverride,
          editorView
        );
      }
    );
  }

  const deckExportButton =
    editorView.querySelector(
      "#deck-export-entire"
    );

  if (deckExportButton) {
    deckExportButton.addEventListener(
      "click",
      exportEntireDeck
    );
  }

  const newCardsExportButton =
    editorView.querySelector(
      "#deck-export-new-only"
    );

  if (newCardsExportButton) {
    newCardsExportButton.addEventListener(
      "click",
      exportNewCardsOnly
    );
  }

  const draftImportButton =
    editorView.querySelector(
      "#draft-import-button"
    );

  const draftImportFile =
    editorView.querySelector(
      "#draft-import-file"
    );

  if (draftImportButton && draftImportFile) {
    draftImportButton.addEventListener(
      "click",
      () => draftImportFile.click()
    );

    draftImportFile.addEventListener(
      "change",
      async () => {
        const file = draftImportFile.files?.[0];
        await importDraftTSVFile(
          file,
          editorView,
          draftsView
        );
        // Allow selecting the same filename again later.
        draftImportFile.value = "";
      }
    );
  }

  const filter =
    progressView.querySelector(
      "#progress-filter"
    );

  if (filter) {

    filter.addEventListener(
      "change",
      renderProgress
    );

  }

     const exportButton =
    progressView.querySelector(
      "#progress-export"
    );

  const importButton =
    progressView.querySelector(
      "#progress-import"
    );

  const importFile =
    progressView.querySelector(
      "#progress-import-file"
    );

  if (exportButton) {
    exportButton.addEventListener(
      "click",
      exportProgress
    );
  }

  if (
    importButton &&
    importFile
  ) {
    importButton.addEventListener(
      "click",
      () => {
        importFile.value = "";
        importFile.click();
      }
    );

    importFile.addEventListener(
      "change",
      () => {
        const file =
          importFile.files &&
          importFile.files[0];

        importProgressFile(file);
      }
    );
  }
  
    const progressList =
  progressView.querySelector(
    "#progress-list"
  );

if (progressList) {

  progressList.addEventListener(
    "click",
    event => {

      const button =
        event.target.closest(
          "[data-clear-progress-wordid]"
        );

      if (!button) {
        return;
      }

      confirmAndClearProgress(
        button.dataset.clearProgressWordid
      );

    }
  );

}

const clearAllButton =
  progressView.querySelector(
    "#progress-clear-all"
  );

if (clearAllButton) {

  clearAllButton.addEventListener(
    "click",
    confirmAndClearAllProgress
  );

}
  
 // -------------------------------------------------------------
// URL hash support
// #review で開いたときは Review Decks を自動表示
// -------------------------------------------------------------

const editorHashTargets = {
  "#editor": null,
  "#editor-create": "editor-create-section",
  "#editor-drafts": "editor-drafts-section",
  "#editor-local-edits": "editor-local-edits-section",
  "#editor-backup": "editor-backup-section"
};

if (
  Object.prototype.hasOwnProperty.call(editorHashTargets, location.hash) &&
  getWlpUiRole() === "admin"
) {

  const editorButton =
    nav.querySelector(
      '[data-wlp-view="editor"]'
    );

  if (editorButton) {
    editorButton.click();

    const sectionId = editorHashTargets[location.hash];
    if (sectionId) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const section = document.getElementById(sectionId);
          if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    }
  }

} else if (
  location.hash === "#drafts" &&
  getWlpUiRole() === "admin"
) {

  const draftsButton =
    nav.querySelector(
      '[data-wlp-view="drafts"]'
    );

  if (draftsButton) {
    draftsButton.click();
  }

} else if (
  location.hash === "#review"
) {

  const reviewButton =
    nav.querySelector(
      '[data-wlp-view="review"]'
    );

  if (reviewButton) {
    reviewButton.click();
  }

} 


  window.addEventListener("storage", event => {
    if (event.key !== LOCAL_OVERRIDES_KEY) return;
    localOverrides = readLocalOverrides();
    renderEditorDrafts(editorView);
    renderEditorOverrides(editorView);
    updateEditorPendingBadge();
  });

}// end installWlpSubnav

// =============================================================
// START
// =============================================================

(async function main() {

  try {

    installStage3Styles();

    wlpRows =
      await loadTSVRows();

    wlpRowByWordId =
      indexRowsByWordId(
        wlpRows
      );

    localAdditions =
      readLocalAdditions();

    localOverrides =
      readLocalOverrides();

    buildMissingDeckGroups(
      wlpRows
    );

    installWlpSubnav();

  } catch (e) {

    console.error(
      "WLP Stage 5D failed:",
      e
    );

  }

})();