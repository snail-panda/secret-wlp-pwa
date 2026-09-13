// flashcards/wlp/app.js
// Stage 5E.1
// Guest-default / Admin UI mode with optional remembered admin access

const TSV_URL =
  "./wlp-flashcard-master.tsv?v=20260909";


// Stage 5E.1 — lightweight Guest / Admin UI mode.
// Guest mode hides local-edit controls; it is not a security boundary.
const WLP_UI_ROLE_KEY = "wlp:ui-role:v2";
const WLP_UI_SESSION_ADMIN_KEY = "wlp:session-admin:v1";
function isWlpAdminMode() {
  return (
    localStorage.getItem(WLP_UI_ROLE_KEY) === "admin" ||
    sessionStorage.getItem(WLP_UI_SESSION_ADMIN_KEY) === "admin"
  );
}

const PARAMS =
  new URLSearchParams(
    location.search
  );

const BATCH_PARAM =
  PARAMS.get("batch");

const REVIEW_PARAM =
  PARAMS.get("review");

const DRAFT_PARAM =
  PARAMS.get("draft");

const WORDID_PARAM =
  PARAMS.get("wordid");

const SOLO_PARAM =
  PARAMS.get("solo");

const FROM_PARAM =
  PARAMS.get("from");

const IS_FROM_PROGRESS =
  FROM_PARAM === "progress";

const IS_SOLO_MODE =
  SOLO_PARAM === "1" &&
  Boolean(WORDID_PARAM);

const IS_REVIEW_MODE =
  Boolean(REVIEW_PARAM);

const IS_DRAFT_MODE =
  Boolean(DRAFT_PARAM);

const LOCAL_ADDITIONS_KEY =
  "wlp:local-additions:v1";

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
let editingOverrideRow = null;

// -------------------------------------------------------------
// Card display mode
// -------------------------------------------------------------

const CARD_MODE_KEY =
  "fc:cardMode";

let cardMode =
  localStorage.getItem(
    CARD_MODE_KEY
  ) === "definition"
    ? "definition"
    : "word";

let renderedCards = [];

if (
  !BATCH_PARAM &&
  !REVIEW_PARAM &&
  !DRAFT_PARAM
) {

  document.getElementById(
    "cards"
  ).innerHTML =
    "<p>Batch, Review, or Draft parameter is missing.</p>";

  throw new Error(
    "missing ?batch, ?review, or ?draft"
  );

}


// ★ ここに追加
if (IS_REVIEW_MODE) {

  const reviewBackLink =
    document.getElementById(
      "review-back-link"
    );

  if (reviewBackLink) {

    reviewBackLink.style.display =
      "block";

  }

}

if (IS_DRAFT_MODE) {

  const draftsBackLink =
    document.getElementById(
      "drafts-back-link"
    );

  if (draftsBackLink) {
    draftsBackLink.style.display =
      "block";
  }

}

if (IS_FROM_PROGRESS) {

  const progressBackLink =
    document.getElementById(
      "progress-back-link"
    );

  if (progressBackLink) {

    progressBackLink.style.display =
      "block";

  }

}

// =============================================================
// TSV
// =============================================================

async function loadTSV(url) {

  try {

    const res =
      await fetch(
        url,
        {
          cache:
            "no-cache"
        }
      );

    if (!res.ok) {

      throw new Error(
        `HTTP ${res.status} for ${url}`
      );

    }

    const txt =
      await res.text();

    const table = [];

    let row = [];
    let field = "";
    let inQuotes = false;

    for (
      let i = 0;
      i < txt.length;
      i++
    ) {

      const ch =
        txt[i];

      const next =
        txt[i + 1];

      if (ch === '"') {

        if (
          inQuotes &&
          next === '"'
        ) {

          field += '"';
          i++;

        } else {

          inQuotes =
            !inQuotes;

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

      throw new Error(
        "TSV contains no rows."
      );

    }

    const header =
      table[0].map(
        value =>
          String(
            value || ""
          ).trim()
      );

    const rows =
      table
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

    return {
      header,
      rows
    };

  } catch (e) {

    const el =
      document.getElementById(
        "cards"
      );

    if (el) {

      el.innerHTML =
        `<p style="color:#b00">
          TSV load failed:
          ${escapeHtml(
            e.message
          )}
        </p>`;

    }

    throw e;

  }

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
    console.warn("Could not read local overrides:", e);
    return {};
  }
}

function saveLocalOverrides() {
  localStorage.setItem(
    LOCAL_OVERRIDES_KEY,
    JSON.stringify(localOverrides)
  );
}

function applyLocalOverrides(rows) {
  return rows.map(row => {
    const wid = String(row.WordID || "").trim();
    const override = wid ? localOverrides[wid] : null;
    if (!override || typeof override !== "object") {
      return { ...row, __hasLocalOverride: false };
    }

    const next = { ...row };
    LOCAL_OVERRIDE_FIELDS.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(override, field)) {
        next[field] = String(override[field] ?? "");
      }
    });
    next.__hasLocalOverride = true;
    return next;
  });
}

function openLocalOverrideEditor(row) {
  if (IS_DRAFT_MODE) return;

  const wid = String(row.WordID || "").trim();
  if (!wid) {
    alert("This card has no permanent WordID, so a local override cannot be saved.");
    return;
  }

  editingOverrideRow = row;
  const modal = document.getElementById("local-edit-modal");
  const form = document.getElementById("local-edit-form");
  const title = document.getElementById("local-edit-title");
  if (!modal || !form) return;

  if (title) {
    title.textContent = `Edit Local Override — WID${wid}`;
  }

  LOCAL_OVERRIDE_FIELDS.forEach(field => {
    const control = form.elements.namedItem(field);
    if (control) control.value = row[field] || "";
  });

  modal.hidden = false;
  document.body.classList.add("local-edit-open");
}

function closeLocalOverrideEditor() {
  const modal = document.getElementById("local-edit-modal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("local-edit-open");
  editingOverrideRow = null;
}

function saveCurrentLocalOverride(form) {
  if (!editingOverrideRow) return;
  const wid = String(editingOverrideRow.WordID || "").trim();
  if (!wid) return;

  const next = {};
  LOCAL_OVERRIDE_FIELDS.forEach(field => {
    const control = form.elements.namedItem(field);
    next[field] = control ? String(control.value ?? "") : "";
  });
  next.updatedAt = new Date().toISOString();

  localOverrides[wid] = next;
  saveLocalOverrides();
  closeLocalOverrideEditor();
  location.reload();
}

function revertLocalOverride(wordId) {
  const wid = String(wordId || "").trim();
  if (!wid || !localOverrides[wid]) return;

  if (!confirm(`Revert WID${wid} to the canonical Master version?\n\nThis removes only the browser-local override.`)) {
    return;
  }

  delete localOverrides[wid];
  saveLocalOverrides();
  location.reload();
}

function installLocalOverrideEditor() {
  const modal = document.getElementById("local-edit-modal");
  const form = document.getElementById("local-edit-form");
  const cancel = document.getElementById("local-edit-cancel");
  if (!modal || !form || modal.dataset.bound === "1") return;
  modal.dataset.bound = "1";

  form.addEventListener("submit", event => {
    event.preventDefault();
    saveCurrentLocalOverride(form);
  });

  if (cancel) cancel.addEventListener("click", closeLocalOverrideEditor);

  modal.addEventListener("click", event => {
    if (event.target === modal) closeLocalOverrideEditor();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.hidden) closeLocalOverrideEditor();
  });
}

// =============================================================
// LOCAL DRAFT STUDY
// =============================================================

function readLocalDraftRows() {

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
      .filter(
        draft =>
          draft &&
          typeof draft === "object" &&
          String(
            draft.Word || ""
          ).trim()
      )
      .map(draft => ({
        "Batch #": "",
        "Guidance #": "",
        WordID: "",
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
          ).trim(),
        __localId:
          String(
            draft.localId || ""
          ).trim()
      }));

  } catch (e) {

    console.warn(
      "Could not read local draft cards:",
      e
    );

    return [];
  }
}

function pickDraftRows(
  rows,
  draftDeckStr
) {

  const deckNo =
    Math.max(
      1,
      Number(draftDeckStr) || 1
    );

  const start =
    (deckNo - 1) * 10;

  return rows.slice(
    start,
    start + 10
  );
}

function installAdjacentDraftDeckLinks(
  draftRows
) {

  if (!IS_DRAFT_MODE) {
    return;
  }

  const prev =
    document.getElementById(
      "prev-deck-link"
    );

  const next =
    document.getElementById(
      "next-deck-link"
    );

  if (!prev || !next) {
    return;
  }

  const deckNo =
    Math.max(
      1,
      Number(DRAFT_PARAM) || 1
    );

  const deckCount =
    Math.ceil(
      draftRows.length / 10
    );

  if (deckNo > 1) {
    prev.href =
      `./batch.html?draft=${deckNo - 1}`;
    prev.textContent =
      "← Previous Draft Deck";
    prev.style.display =
      "inline";
  }

  if (deckNo < deckCount) {
    next.href =
      `./batch.html?draft=${deckNo + 1}`;
    next.textContent =
      "Next Draft Deck →";
    next.style.display =
      "inline";
  }
}

// =============================================================
// NORMAL DECK
// =============================================================

function pickBatchRows(
  rows,
  batchStr
) {

  const wantNum =
    Number(batchStr);

  return rows.filter(row => {

    const value =
      row["Batch #"] ??
      row["Batch"] ??
      "";

    return (
      value === batchStr ||
      Number(value) ===
        wantNum
    );

  });

}

// =============================================================
// REVIEW DECK
// =============================================================

function readAllReviewProgress() {

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

      const currentlyReview =
        data.review === true ||
        data.lastResult ===
          "review";

      if (
        !wordId ||
        !currentlyReview
      ) {
        continue;
      }

      records.push({

        wordId,

        reviewCount:
          Number(
            data.reviewCount || 0
          ),

        lastSeen:
          Number(
            data.lastSeen || 0
          )

      });

    } catch (e) {

      console.warn(
        "Could not read review progress:",
        key,
        e
      );

    }

  }

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

function pickReviewRows(
  rows,
  reviewDeckStr
) {

  const deckNo =
    Math.max(
      1,
      Number(
        reviewDeckStr
      ) || 1
    );

  const reviewRecords =
    readAllReviewProgress();

  const start =
    (deckNo - 1) * 10;

  const selected =
    reviewRecords.slice(
      start,
      start + 10
    );

  const rowMap =
    new Map();

  rows.forEach(row => {

    const wordId =
      String(
        row["WordID"] || ""
      ).trim();

    if (wordId) {

      rowMap.set(
        wordId,
        row
      );

    }

  });

  return selected
    .map(
      record =>
        rowMap.get(
          record.wordId
        )
    )
    .filter(Boolean);

}

  function wordIdOf(row) {

  return String(
    row["WordID"] || ""
  ).trim();

}


function findWordIndex(
  rows,
  wordId
) {

  const want =
    String(
      wordId || ""
    ).trim();

  if (!want) {
    return -1;
  }

  return rows.findIndex(
    row =>
      wordIdOf(row) === want
  );

}

// =============================================================
// CARD RENDERING
// =============================================================

function renderCards(
  batchRows,
  label
) {

  const tpl =
    document.getElementById(
      "card-tpl"
    );

  const wrap =
    document.getElementById(
      "cards"
    );

  wrap.innerHTML = "";

  const cards =
  batchRows.map((row, index) => {

      const node =
        tpl.content.cloneNode(
          true
        );

      const root =
        node.querySelector(
          ".flashcard"
        );

      populateCard(
        root,
        row
      );

      const ext =
        root.querySelector(
          ".external-link"
        );

      const q =
        encodeURIComponent(
          (
            row["Word"] ||
            ""
          ).trim()
        );

      ext.href =
        `https://www.google.com/search?q=define+${q}`;

      const cardTagText =
  IS_DRAFT_MODE
    ? `#Draft${label}      ${index + 1}/${batchRows.length}`
    : IS_REVIEW_MODE
      ? `#Review${label}      ${index + 1}/${batchRows.length}`
      : `#WLP${label}      ${index + 1}/${batchRows.length}`;

root
  .querySelectorAll(
    ".card-tag"
  )
  .forEach(
    tag => {
      tag.textContent =
        cardTagText;
    }
  );

      const stateKey =
        IS_DRAFT_MODE
          ? null
          : wordIdKey(row);

      bindCardBehavior(
        root,
        stateKey,
        row
      );

      const editButton = root.querySelector(".btn-edit-local");
      const revertButton = root.querySelector(".btn-revert-local");

      if (IS_DRAFT_MODE || !isWlpAdminMode()) {
        if (editButton) editButton.hidden = true;
        if (revertButton) revertButton.hidden = true;
      } else {
        if (editButton) {
          editButton.textContent = row.__hasLocalOverride
            ? "✏️ Edit Override"
            : "✏️ Edit Card";
          editButton.addEventListener("click", () => openLocalOverrideEditor(row));
        }
        if (revertButton) {
          revertButton.hidden = !row.__hasLocalOverride;
          revertButton.addEventListener("click", () => revertLocalOverride(row.WordID));
        }
        if (row.__hasLocalOverride) {
          root.querySelectorAll(".card-tag").forEach(tag => {
            tag.textContent += " · Local edit";
          });
        }
      }

      return root;

    });

  cards.forEach(
    (el, i) => {

      if (i === 0) {

        el.classList.add(
          "active"
        );

      }

      wrap.appendChild(
        el
      );

    }
  );

  renderedCards =
    cards.map(
      (root, i) => ({
        root,
        row:
          batchRows[i]
      })
    );

  installModeControls();

  applyModeToAllCards();

  installDeckNavigation();

  updateAllVoiceButtons();
  installLocalOverrideEditor();

}

    function compactCardText(
  value
) {

  return String(
    value || ""
  )
    .replace(
      /\s*\r?\n\s*/g,
      " "
    )
    .replace(
      /[ \t]+/g,
      " "
    )
    .trim();

}

// =============================================================
// CARD CONTENT
// =============================================================

function populateCard(
  root,
  row
) {

  const def =
  compactCardText(
    row["Definition"]
  );

const ex =
  compactCardText(
    row["Example Sentence"]
  );

const syn =
  compactCardText(
    row["Synonym(s)"]
  );

const note =
  compactCardText(
    row["Note(s)"]
  );

  root
    .querySelector(
      ".back-word"
    )
    .textContent =
      row["Word"] || "";

  root
    .querySelector(
      ".back-ipa"
    )
    .textContent =
      row["IPA"] || "";

  root
    .querySelector(
      ".back-pos"
    )
    .textContent =
      row[
        "Part of Speech"
      ] || "";

  root
    .querySelector(".ex")
    .innerHTML =
      ex
        ? `<strong>Example(s):</strong> ${escapeHtml(ex)}`
        : "";

  root
    .querySelector(".syn")
    .innerHTML =
      syn
        ? `<strong>Synonyms:</strong> ${escapeHtml(syn)}`
        : "";

  root
    .querySelector(".note")
    .innerHTML =
      note
        ? `<strong>Notes:</strong> ${escapeHtml(note)}`
        : "";

  applyCardMode(
    root,
    row
  );

}

function applyCardMode(
  root,
  row
) {

  const word =
    row["Word"] || "";

  const ipa =
    row["IPA"] || "";

  const pos =
    row[
      "Part of Speech"
    ] || "";

  const def =
  compactCardText(
    row["Definition"]
  );

  const backAnswer =
    root.querySelector(
      ".back-answer"
    );

  const defEl =
    root.querySelector(
      ".def"
    );

  if (
    cardMode ===
    "definition"
  ) {

    root.classList.add(
      "definition-first"
    );

    root
      .querySelector(
        ".word"
      )
      .textContent =
        def;

    root
      .querySelector(
        ".ipa"
      )
      .textContent = "";

    root
      .querySelector(
        ".pos"
      )
      .textContent =
        pos;

    backAnswer.hidden =
      false;

    defEl.innerHTML = "";

    defEl.hidden =
      true;

  } else {

    root.classList.remove(
      "definition-first"
    );

    root
      .querySelector(
        ".word"
      )
      .textContent =
        word;

    root
      .querySelector(
        ".ipa"
      )
      .textContent =
        ipa;

    root
      .querySelector(
        ".pos"
      )
      .textContent =
        pos;

    backAnswer.hidden =
      true;

    defEl.hidden =
      false;

    defEl.innerHTML =
      `<strong>Definition:</strong> ${escapeHtml(def)}`;

  }

}

function applyModeToAllCards() {

  renderedCards.forEach(
    ({
      root,
      row
    }) =>
      applyCardMode(
        root,
        row
      )
  );

  updateModeButtons();

}

function setCardMode(mode) {

  cardMode =
    mode ===
    "definition"
      ? "definition"
      : "word";

  localStorage.setItem(
    CARD_MODE_KEY,
    cardMode
  );

  applyModeToAllCards();

  const i =
    currentIndex();

  showAt(
    i >= 0
      ? i
      : 0
  );

}

function installModeControls() {

  document
    .querySelectorAll(
      ".mode-btn"
    )
    .forEach(btn => {

      if (
        btn.dataset.modeBound ===
        "1"
      ) {
        return;
      }

      btn.dataset.modeBound =
        "1";

      btn.addEventListener(
        "click",
        () =>
          setCardMode(
            btn.dataset.mode
          )
      );

    });

  updateModeButtons();

}

function updateModeButtons() {

  document
    .querySelectorAll(
      ".mode-btn"
    )
    .forEach(btn => {

      const active =
        btn.dataset.mode ===
        cardMode;

      btn.classList.toggle(
        "active",
        active
      );

      btn.setAttribute(
        "aria-pressed",
        active
          ? "true"
          : "false"
      );

    });

}

// =============================================================
// TTS
// =============================================================

const TTS_DEFAULTS = {

  lang:
    "en-US",

  rate:
    1.0,

  pitch:
    1.0,

  gapMs:
    500,

  readSynonymsTopN:
    0

};

function ttsPrefs() {

  try {

    return {

      ...TTS_DEFAULTS,

      ...JSON.parse(
        localStorage.getItem(
          "fc:tts"
        ) || "{}"
      )

    };

  } catch {

    return TTS_DEFAULTS;

  }

}

let voices = [];

function loadVoices() {

  voices =
    speechSynthesis.getVoices();

  if (voices.length) {

    updateAllVoiceButtons();

    return;

  }

  speechSynthesis.onvoiceschanged =
    () => {

      voices =
        speechSynthesis.getVoices();

      updateAllVoiceButtons();

    };

}

function ensureVoicesLoaded(cb) {

  if (voices.length) {

    cb && cb();

    return;

  }

  let tries = 0;

  (function poll() {

    voices =
      speechSynthesis.getVoices();

    if (
      voices.length ||
      tries++ >= 10
    ) {

      updateAllVoiceButtons();

      cb && cb();

      return;

    }

    setTimeout(
      poll,
      200
    );

  })();

}

loadVoices();

const PREFERRED_VOICE_CYCLE = [

  "Samantha",
  "Karen",
  "Victoria",
  "Daniel",
  "Alex",
  "Oliver",
  "Microsoft Zira Desktop",
  "Microsoft Aria",
  "Microsoft David Desktop",
  "Microsoft Guy"

];

const VOICE_STORE_KEY =
  "fc:voiceName";

function getCurrentVoiceName() {

  return (
    localStorage.getItem(
      VOICE_STORE_KEY
    ) || ""
  );

}

function setCurrentVoiceName(
  name
) {

  localStorage.setItem(
    VOICE_STORE_KEY,
    name || ""
  );

  updateAllVoiceButtons();

}

function findVoiceByName(
  name
) {

  if (!name) {
    return null;
  }

  return (
    voices.find(
      v =>
        v &&
        v.name === name
    ) ||
    null
  );

}

function availablePreferredVoices() {

  const names =
    new Set(
      voices.map(
        v => v.name
      )
    );

  return PREFERRED_VOICE_CYCLE
    .filter(
      n =>
        names.has(n)
    );

}

function availableEnglishVoices() {

  return voices
    .filter(
      v =>
        /^en($|[-_])/i.test(
          v.lang
        )
    )
    .map(
      v => v.name
    );

}

function cycleVoice() {

  let avail =
    availablePreferredVoices();

  if (!avail.length) {

    avail =
      availableEnglishVoices();

  }

  if (!avail.length) {

    setCurrentVoiceName("");

    return;

  }

  const cur =
    getCurrentVoiceName();

  const idx =
    Math.max(
      0,
      avail.indexOf(cur)
    );

  const next =
    avail[
      (idx + 1) %
      avail.length
    ];

  setCurrentVoiceName(
    next
  );

}

function voiceDisplayInfo(name) {
  const v = findVoiceByName(name);
  if (!v) return name ? name : "Default voice";
  const locale = String(v.lang || "").replace("_", "-");
  return locale ? `${v.name} · ${locale}` : v.name;
}

function updateVoiceButton(btn) {
  const cur = getCurrentVoiceName();
  btn.textContent = "‹ Voice ›";
  btn.title = cur
    ? `Voice: ${voiceDisplayInfo(cur)} (click to switch)`
    : "Default voice (click to switch)";

  const detail = btn.closest(".voice-control")?.querySelector(".voice-detail");
  if (detail) detail.textContent = voiceDisplayInfo(cur);
}

function updateAllVoiceButtons() {

  document
    .querySelectorAll(
      ".btn-voice"
    )
    .forEach(
      updateVoiceButton
    );

}

function splitSentences(text) {

  const flat =
    String(text)
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (!flat) {
    return [];
  }

  const parts =
    flat.split(
      /([.?!])\s+(?=[A-Z"“])/
    );

  const out = [];

  for (
    let i = 0;
    i < parts.length;
    i++
  ) {

    const cur =
      parts[i];

    if (!cur) {
      continue;
    }

    if (
      i > 0 &&
      /[.?!]/.test(
        parts[i - 1]
      )
    ) {

      out[
        out.length - 1
      ] =
        out[
          out.length - 1
        ] + cur;

    } else if (
      /[.?!]/.test(cur) &&
      out.length
    ) {

      out[
        out.length - 1
      ] =
        out[
          out.length - 1
        ] + cur;

    } else {

      out.push(cur);

    }

  }

  return out.filter(
    Boolean
  );

}

let activeTtsButton = null;
let ttsRunToken = 0;
let ttsGapTimer = null;

function resetTtsButton() {
  if (activeTtsButton) {
    activeTtsButton.innerHTML = activeTtsButton.dataset.idleHtml || activeTtsButton.innerHTML;
    activeTtsButton = null;
  }
}

function stopTtsPlayback() {
  ttsRunToken += 1;
  if (ttsGapTimer) {
    clearTimeout(ttsGapTimer);
    ttsGapTimer = null;
  }
  speechSynthesis.cancel();
  resetTtsButton();
}

function speakSequence(
  chunks,
  opts = {}
) {
  const cleanChunks = chunks.map(x => String(x || "").trim()).filter(Boolean);
  if (!cleanChunks.length) {
    if (opts.onDone) opts.onDone();
    return;
  }

  const pref = ttsPrefs();
  const gap = opts.gapMs ?? pref.gapMs;
  const voiceName = opts.voiceName || getCurrentVoiceName();
  const token = ++ttsRunToken;

  function finish() {
    if (token !== ttsRunToken) return;
    ttsGapTimer = null;
    if (opts.onDone) opts.onDone();
  }

  function speakOne(i) {
    if (token !== ttsRunToken) return;
    if (i >= cleanChunks.length) {
      finish();
      return;
    }

    const u = new SpeechSynthesisUtterance(cleanChunks[i]);
    u.lang = pref.lang;
    u.rate = pref.rate;
    u.pitch = pref.pitch;
    const v = findVoiceByName(voiceName);
    if (v) u.voice = v;

    u.onend = () => {
      if (token !== ttsRunToken) return;
      ttsGapTimer = setTimeout(() => speakOne(i + 1), gap);
    };
    u.onerror = finish;
    speechSynthesis.speak(u);
  }

  speakOne(0);
}

function toggleTtsButton(button, chunks, opts = {}) {
  if (!button) return;

  if (activeTtsButton === button) {
    stopTtsPlayback();
    return;
  }

  stopTtsPlayback();
  button.dataset.idleHtml = button.innerHTML;
  activeTtsButton = button;
  button.textContent = "■ Stop";

  speakSequence(chunks, {
    ...opts,
    onDone: () => {
      if (activeTtsButton === button) resetTtsButton();
      if (opts.onDone) opts.onDone();
    }
  });
}

function speakExamples(row) {

  speakSequence(
    splitSentences(
      row[
        "Example Sentence"
      ] || ""
    ),
    {
      voiceName:
        getCurrentVoiceName()
    }
  );

}

function speakDefinition(row) {

  const def =
    (
      row["Definition"] ||
      ""
    )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (!def) {
    return;
  }

  speakSequence(
    [def],
    {
      voiceName:
        getCurrentVoiceName()
    }
  );

}

function pickSynonyms(row) {

  const pref =
    ttsPrefs();

  let list =
    (
      row["Synonym(s)"] ||
      ""
    )
      .split(
        /[,;|]/
      )
      .map(
        s => s.trim()
      )
      .filter(Boolean);

  if (
    pref.readSynonymsTopN >
    0
  ) {

    list =
      list.slice(
        0,
        pref.readSynonymsTopN
      );

  }

  return list;

}

function speakBackAll(row) {

  const chunks = [];

  const def =
    (
      row["Definition"] ||
      ""
    ).trim();

  if (def) {
    chunks.push(def);
  }

  chunks.push(
    ...splitSentences(
      row[
        "Example Sentence"
      ] || ""
    )
  );

  const list =
    pickSynonyms(row);

  if (list.length) {

    const last =
      list.pop();

    const spoken =
      list.length
        ? `${list.join(", ")}, and ${last}`
        : last;

    chunks.push(
      `Synonyms: ${spoken}.`
    );

  }

  speakSequence(
    chunks,
    {
      voiceName:
        getCurrentVoiceName()
    }
  );

}


// =============================================================
// RECORDING PRACTICE — local saved takes (IndexedDB)
// =============================================================
const WLP_RECORDING_DB = "wlp-recordings-v1";
const WLP_RECORDING_STORE = "takes";
let activeRecorder = null;

function openRecordingDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(WLP_RECORDING_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(WLP_RECORDING_STORE)) {
        db.createObjectStore(WLP_RECORDING_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function recordingDbGet(key) {
  const db = await openRecordingDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WLP_RECORDING_STORE, "readonly");
    const req = tx.objectStore(WLP_RECORDING_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function recordingDbPut(record) {
  const db = await openRecordingDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WLP_RECORDING_STORE, "readwrite");
    tx.objectStore(WLP_RECORDING_STORE).put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function recordingDbDelete(key) {
  const db = await openRecordingDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WLP_RECORDING_STORE, "readwrite");
    tx.objectStore(WLP_RECORDING_STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

function recordingCardId(row) {
  const wid = String(row.WordID || "").trim();
  if (wid) return `wid:${wid}`;
  const localId = String(row.__localId || "").trim();
  return localId ? `draft:${localId}` : "";
}

function stopRecordingPlayback(panel) {
  const audio = panel.__wlpRecordingAudio;
  const button = panel.__wlpRecordingPlayButton;
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
  if (panel.__wlpRecordingAudioUrl) {
    URL.revokeObjectURL(panel.__wlpRecordingAudioUrl);
  }
  if (button && button.dataset.idleLabel) {
    button.textContent = button.dataset.idleLabel;
  }
  panel.__wlpRecordingAudio = null;
  panel.__wlpRecordingAudioUrl = null;
  panel.__wlpRecordingPlayButton = null;
}

function toggleRecordingPlayback(panel, button, blob) {
  if (!blob) return;

  if (panel.__wlpRecordingAudio) {
    const sameButton = panel.__wlpRecordingPlayButton === button;
    stopRecordingPlayback(panel);
    if (sameButton) return;
  }

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  panel.__wlpRecordingAudio = audio;
  panel.__wlpRecordingAudioUrl = url;
  panel.__wlpRecordingPlayButton = button;
  button.dataset.idleLabel = button.dataset.idleLabel || button.textContent;
  button.textContent = "■ Stop";

  const finish = () => stopRecordingPlayback(panel);
  audio.addEventListener("ended", finish, { once: true });
  audio.addEventListener("error", finish, { once: true });
  audio.play().catch(err => {
    finish();
    console.warn("Recording playback failed:", err);
  });
}

function bindRecordingPractice(root, row) {
  if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia || !("indexedDB" in window)) {
    root.querySelectorAll(".record-practice").forEach(el => {
      el.innerHTML = '<span class="record-status">Recording is not supported in this browser.</span>';
    });
    return;
  }

  const cardId = recordingCardId(row);
  if (!cardId) return;

  root.querySelectorAll(".record-practice").forEach(panel => {
    const kind = panel.dataset.recordKind;
    const key = `${cardId}:${kind}`;
    const recordBtn = panel.querySelector(".btn-record");
    const stopBtn = panel.querySelector(".btn-record-stop");
    const mineBtn = panel.querySelector(".btn-record-mine");
    const saveBtn = panel.querySelector(".btn-record-save");
    const savedBtn = panel.querySelector(".btn-record-saved");
    const deleteBtn = panel.querySelector(".btn-record-delete");
    const status = panel.querySelector(".record-status");
    let currentBlob = null;
    let savedRecord = null;

    const refreshSaved = async () => {
      try {
        savedRecord = await recordingDbGet(key);
        savedBtn.hidden = !savedRecord?.blob;
        deleteBtn.hidden = !savedRecord?.blob;
      } catch (e) {
        console.warn("Could not read saved take:", e);
      }
    };
    refreshSaved();

    recordBtn.addEventListener("click", async () => {
      if (activeRecorder) {
        status.textContent = "Finish the current recording first.";
        return;
      }
      stopRecordingPlayback(panel);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const chunks = [];
        activeRecorder = recorder;
        recorder.addEventListener("dataavailable", e => { if (e.data.size) chunks.push(e.data); });
        recorder.addEventListener("stop", () => {
          currentBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          stream.getTracks().forEach(track => track.stop());
          activeRecorder = null;
          recordBtn.hidden = false;
          stopBtn.hidden = true;
          mineBtn.hidden = false;
          saveBtn.hidden = false;
          status.textContent = "Take ready.";
        }, { once: true });
        recorder.start();
        recordBtn.hidden = true;
        stopBtn.hidden = false;
        mineBtn.hidden = true;
        saveBtn.hidden = true;
        status.textContent = "Recording…";
      } catch (e) {
        activeRecorder = null;
        status.textContent = "Microphone access was not available.";
        console.warn("Recording failed:", e);
      }
    });

    stopBtn.addEventListener("click", () => {
      if (activeRecorder?.state === "recording") activeRecorder.stop();
    });
    mineBtn.addEventListener("click", () => toggleRecordingPlayback(panel, mineBtn, currentBlob));
    savedBtn.addEventListener("click", () => toggleRecordingPlayback(panel, savedBtn, savedRecord?.blob));

    saveBtn.addEventListener("click", async () => {
      if (!currentBlob) return;
      if (savedRecord?.blob && !confirm("Replace the saved take for this item?")) return;
      try {
        const record = { key, cardId, kind, blob: currentBlob, savedAt: new Date().toISOString() };
        await recordingDbPut(record);
        savedRecord = record;
        savedBtn.hidden = false;
        deleteBtn.hidden = false;
        status.textContent = "Saved on this device.";
      } catch (e) {
        status.textContent = "Could not save this take.";
        console.error("Saving take failed:", e);
      }
    });

    deleteBtn.addEventListener("click", async () => {
      if (!savedRecord?.blob || !confirm("Delete the saved take for this item?")) return;
      stopRecordingPlayback(panel);
      try {
        await recordingDbDelete(key);
        savedRecord = null;
        savedBtn.hidden = true;
        deleteBtn.hidden = true;
        status.textContent = "Saved take deleted.";
      } catch (e) {
        status.textContent = "Could not delete the saved take.";
      }
    });
  });
}

// =============================================================
// CARD EVENTS
// =============================================================

function bindCardBehavior(
  root,
  stateKey,
  row
) {

  bindRecordingPractice(root, row);

  root
    .querySelectorAll(
      ".btn-flip, .btn-flip-back"
    )
    .forEach(
      btn => {

        btn.addEventListener(
          "click",
          () =>
            flip(root)
        );

      }
    );

  root
    .querySelectorAll(
      ".btn-prev"
    )
    .forEach(
      btn => {

        btn.addEventListener(
          "click",
          () =>
            go(-1)
        );

      }
    );

  root
    .querySelectorAll(
      ".btn-next"
    )
    .forEach(
      btn => {

        btn.addEventListener(
          "click",
          () =>
            go(1)
        );

      }
    );

  root
    .querySelector(
      ".btn-shuffle"
    )
    .addEventListener(
      "click",
      shuffle
    );

  const speakBtn = root.querySelector(".btn-speak");
  const exBtn = root.querySelector(".btn-tts-ex");
  const defBtn = root.querySelector(".btn-tts-def");
  const allBtn = root.querySelector(".btn-tts-all");

  if (speakBtn) {
    speakBtn.addEventListener("click", () => {
      const text = cardMode === "definition"
        ? (row["Definition"] || "").trim()
        : (row["Word"] || "").trim();
      if (text) {
        toggleTtsButton(speakBtn, [text], { voiceName: getCurrentVoiceName() });
      }
    });
  }

  if (exBtn) {
    exBtn.addEventListener("click", () => {
      const chunks = splitSentences(row["Example Sentence"] || "");
      if (chunks.length) toggleTtsButton(exBtn, chunks, { voiceName: getCurrentVoiceName() });
    });
  }

  if (defBtn) {
    defBtn.addEventListener("click", () => {
      const def = (row["Definition"] || "").replace(/\s+/g, " ").trim();
      if (def) toggleTtsButton(defBtn, [def], { voiceName: getCurrentVoiceName() });
    });
  }

  if (allBtn) {
    allBtn.addEventListener("click", () => {
      const chunks = [];
      const def = (row["Definition"] || "").trim();
      if (def) chunks.push(def);
      chunks.push(...splitSentences(row["Example Sentence"] || ""));
      const list = pickSynonyms(row);
      if (list.length) {
        const copy = [...list];
        const last = copy.pop();
        const spoken = copy.length ? `${copy.join(", ")}, and ${last}` : last;
        chunks.push(`Synonyms: ${spoken}.`);
      }
      if (chunks.length) toggleTtsButton(allBtn, chunks, { voiceName: getCurrentVoiceName() });
    });
  }

  const voiceBtn =
    root.querySelector(
      ".btn-voice"
    );

  if (voiceBtn) {

    updateVoiceButton(
      voiceBtn
    );

    voiceBtn.addEventListener(
      "click",
      () => {

        ensureVoicesLoaded(
          () => {

            cycleVoice();

            updateVoiceButton(
              voiceBtn
            );

          }
        );

      }
    );

  }


  if (IS_DRAFT_MODE) {

    const studiedButton =
      root.querySelector(
        ".btn-studied"
      );

    const reviewButton =
      root.querySelector(
        ".btn-review"
      );

    if (studiedButton) {
      studiedButton.disabled = true;
      studiedButton.title =
        "Draft cards do not receive permanent study progress until Master integration.";
      studiedButton.style.opacity =
        "0.45";
    }

    if (reviewButton) {
      reviewButton.disabled = true;
      reviewButton.title =
        "Draft cards do not enter the Review pool until Master integration.";
      reviewButton.style.opacity =
        "0.45";
    }

    return;
  }

  // -----------------------------------------------------------
  // STUDIED
  // -----------------------------------------------------------

  root
    .querySelector(
      ".btn-studied"
    )
    .addEventListener(
      "click",
      () => {

        updateProgress(
          stateKey,
          row,
          "studied"
        );

        if (
          IS_REVIEW_MODE
        ) {

          removeFromCurrentReviewDeck(
            root
          );

        } else {

          alert(
            "✅ Marked as Studied."
          );

        }

      }
    );

  // -----------------------------------------------------------
  // REVIEW
  // -----------------------------------------------------------

  root
    .querySelector(
      ".btn-review"
    )
    .addEventListener(
      "click",
      () => {

        updateProgress(
          stateKey,
          row,
          "review"
        );

        alert(
          "🔁 Added to Review List."
        );

      }
    );

}

// =============================================================
// PROGRESS STORAGE
// =============================================================

function wordIdKey(row) {

  const wordId =
    (
      row["WordID"] ||
      ""
    )
      .toString()
      .trim();

  if (!wordId) {

    console.warn(
      "Progress was not saved because WordID is missing.",
      row
    );

    return null;

  }

  return (
    `fc:wordid:${wordId}`
  );

}

function readProgress(key) {

  if (!key) {
    return {};
  }

  try {

    return JSON.parse(
      localStorage.getItem(
        key
      ) || "{}"
    );

  } catch (e) {

    console.warn(
      "Could not read progress data:",
      key,
      e
    );

    return {};

  }

}

function saveProgress(
  key,
  data
) {

  if (!key) {
    return;
  }

  try {

    localStorage.setItem(
      key,
      JSON.stringify(
        data
      )
    );

  } catch (e) {

    console.warn(
      "Could not save progress data:",
      key,
      e
    );

  }

}

function updateProgress(
  key,
  row,
  result
) {

  if (!key) {
    return;
  }

  const cur =
    readProgress(
      key
    );

  const now =
    Date.now();

  const studyCount =
    Number(
      cur.studyCount || 0
    );

  const reviewCount =
    Number(
      cur.reviewCount || 0
    );

  const attempts =
    Number(
      cur.attempts || 0
    );

  const next = {

    ...cur,

    wordId:
      (
        row["WordID"] ||
        ""
      )
        .toString()
        .trim(),

    studyCount:
      result ===
      "studied"
        ? studyCount + 1
        : studyCount,

    reviewCount:
      result ===
      "review"
        ? reviewCount + 1
        : reviewCount,

    attempts:
      attempts + 1,

    known:
      result ===
      "studied",

    review:
      result ===
      "review",

    lastResult:
      result,

    firstSeen:
      cur.firstSeen ||
      now,

    lastSeen:
      now

  };

  saveProgress(
    key,
    next
  );

}

// =============================================================
// REVIEW DECK: REMOVE STUDIED CARD IMMEDIATELY
// =============================================================

function removeFromCurrentReviewDeck(
  root
) {

  const cards =
    cardsNodeList();

  const oldIndex =
    cards.indexOf(
      root
    );

  root.remove();

  renderedCards =
    renderedCards.filter(
      item =>
        item.root !== root
    );

  const remaining =
    cardsNodeList();

  if (
    remaining.length === 0
  ) {

    document
      .getElementById(
        "cards"
      )
      .innerHTML = `

        <div
          style="
            text-align:center;
            padding:3em 1em;
            font-family:serif;
          "
        >

          ✅ Review Deck cleared.

          <br><br>

          This card is now
          Studied and has been
          removed from the
          Review pool.

        </div>

      `;

    return;

  }

  const nextIndex =
    Math.min(
      oldIndex,
      remaining.length - 1
    );

  showAt(
    nextIndex
  );

}

// =============================================================
// NAVIGATION
// =============================================================

function cardsNodeList() {

  return Array.from(
    document.querySelectorAll(
      ".flashcard"
    )
  );

}

function currentIndex() {

  return cardsNodeList()
    .findIndex(
      n =>
        n.classList.contains(
          "active"
        )
    );

}

function showAt(idx) {

  const cards =
    cardsNodeList();

  cards.forEach(
    n =>
      n.classList.remove(
        "active"
      )
  );

  if (cards[idx]) {

    cards[idx]
      .classList
      .add(
        "active"
      );

    const front =
      cards[idx]
        .querySelector(
          ".front"
        );

    const back =
      cards[idx]
        .querySelector(
          ".back"
        );

    front.style.display =
      "block";

    back.style.display =
      "none";

  }

}

function go(delta) {

  const cards =
    cardsNodeList();

  if (!cards.length) {
    return;
  }

  let i =
    currentIndex();

  if (i < 0) {
    i = 0;
  }

  i =
    (
      i +
      delta +
      cards.length
    ) %
    cards.length;

  showAt(i);

}

function shuffle() {

  const cards =
    cardsNodeList();

  if (!cards.length) {
    return;
  }

  const i =
    Math.floor(
      Math.random() *
      cards.length
    );

  showAt(i);

}

function flip(root) {

  const front =
    root.querySelector(
      ".front"
    );

  const back =
    root.querySelector(
      ".back"
    );

  const flipped =
    back.style.display ===
    "block";

  front.style.display =
    flipped
      ? "block"
      : "none";

  back.style.display =
    flipped
      ? "none"
      : "block";

}

function installDeckNavigation() {

  showAt(0);

}

// =============================================================
// HTML ESCAPE
// =============================================================

function escapeHtml(s) {

  return String(s)
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    );

}

    function installAdjacentDeckLinks(
  rows
) {

  if (
    IS_REVIEW_MODE ||
    IS_DRAFT_MODE ||
    !BATCH_PARAM
  ) {
    return;
  }

  const deckNumbers =
    [
      ...new Set(
        rows
          .map(
            row =>
              Number(
                row["Batch #"] ??
                row["Batch"] ??
                ""
              )
          )
          .filter(
            n =>
              Number.isFinite(n)
          )
      )
    ].sort(
      (a, b) =>
        a - b
    );

  const currentDeck =
    Number(BATCH_PARAM);

  const currentPos =
    deckNumbers.indexOf(
      currentDeck
    );

  if (currentPos < 0) {
    return;
  }

  const wrap =
    document.getElementById(
      "deck-nav-links"
    );

  const prev =
    document.getElementById(
      "prev-deck-link"
    );

  const next =
    document.getElementById(
      "next-deck-link"
    );

  if (
  !wrap ||
  !prev ||
  !next
) {
  return;
}

  const fromProgress =
    IS_FROM_PROGRESS
      ? "&from=progress"
      : "";

  const previousDeck =
    deckNumbers[
      currentPos - 1
    ];

  const nextDeck =
    deckNumbers[
      currentPos + 1
    ];

  if (
    previousDeck !== undefined
  ) {

    prev.href =
      `./batch.html?batch=${String(
        previousDeck
      ).padStart(
        3,
        "0"
      )}${fromProgress}`;

    prev.style.display =
      "inline";

  }

  if (
    nextDeck !== undefined
  ) {

    next.href =
      `./batch.html?batch=${String(
        nextDeck
      ).padStart(
        3,
        "0"
      )}${fromProgress}`;

    next.style.display =
      "inline";

  }


}

// =============================================================
// START
// =============================================================

(async function main() {

  const { rows } =
  await loadTSV(
    TSV_URL
  );

  localOverrides = readLocalOverrides();
  const effectiveRows = applyLocalOverrides(rows);

installAdjacentDeckLinks(
  effectiveRows
);

  const draftRows =
    readLocalDraftRows();

  installAdjacentDraftDeckLinks(
    draftRows
  );

  let selectedRows;
  let label;

  if (
    IS_DRAFT_MODE
  ) {

    selectedRows =
      pickDraftRows(
        draftRows,
        DRAFT_PARAM
      );

    label =
      String(
        DRAFT_PARAM
      ).padStart(
        3,
        "0"
      );

  } else if (
    IS_REVIEW_MODE
  ) {

    selectedRows =
      pickReviewRows(
        effectiveRows,
        REVIEW_PARAM
      );

    label =
      String(
        REVIEW_PARAM
      ).padStart(
        3,
        "0"
      );

  } else {

    selectedRows =
      pickBatchRows(
        effectiveRows,
        BATCH_PARAM
      ).slice(
        0,
        10
      );

    label =
      BATCH_PARAM;

  }

  if (
    selectedRows.length ===
    0
  ) {

    document
      .getElementById(
        "cards"
      )
      .innerHTML = `

        <div
          style="
            text-align:center;
            padding:3em 1em;
          "
        >

          ${
            IS_DRAFT_MODE
              ? "This Draft Deck is empty."
              : IS_REVIEW_MODE
                ? "This Review Deck is empty."
                : `No rows for batch ${BATCH_PARAM}.`
          }

          <br><br>

          ${
            IS_DRAFT_MODE
              ? "Add cards in Editor and they will appear in Drafts."
              : IS_REVIEW_MODE
                ? "The Review pool may have changed since this deck was created."
                : ""
          }

        </div>

      `;

    return;

  }

  if (
  !IS_REVIEW_MODE &&
  !IS_DRAFT_MODE &&
  WORDID_PARAM
) {

  const wordIndex =
    findWordIndex(
      selectedRows,
      WORDID_PARAM
    );

  if (
    IS_SOLO_MODE
  ) {

    if (
      wordIndex >= 0
    ) {

      selectedRows = [
        selectedRows[
          wordIndex
        ]
      ];

    } else {

      document
        .getElementById(
          "cards"
        )
        .innerHTML = `

          <div
            style="
              text-align:center;
              padding:3em 1em;
            "
          >
            WordID
            ${escapeHtml(
              WORDID_PARAM
            )}
            was not found in
            Deck
            ${escapeHtml(
              BATCH_PARAM
            )}.
          </div>

        `;

      return;

    }

  }

}

renderCards(
  selectedRows,
  label
);

if (
  !IS_REVIEW_MODE &&
  !IS_DRAFT_MODE &&
  WORDID_PARAM &&
  !IS_SOLO_MODE
) {

  const wordIndex =
    findWordIndex(
      selectedRows,
      WORDID_PARAM
    );

  if (
    wordIndex >= 0
  ) {

    showAt(
      wordIndex
    );

  }

}

})();