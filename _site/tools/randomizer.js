(function () {
  "use strict";

  var LIMITS = Object.freeze({
    maxFileBytes: 2 * 1024 * 1024,
    maxExpandedBytes: 8 * 1024 * 1024,
    maxEntryBytes: 4 * 1024 * 1024,
    maxCompressionRatio: 250,
    maxZipEntries: 256,
    maxRows: 1000,
    maxColumns: 50,
    maxNames: 500,
    maxNameLength: 80
  });

  var HEADER_NAMES = new Set([
    "name", "names", "student", "students", "student name", "student names",
    "label", "labels", "player", "players", "participant", "participants"
  ]);

  var WHEEL_COLORS = [
    "#6c63d9", "#4a9bd8", "#39a891", "#e2a23a", "#dc6a54",
    "#9c6acb", "#4eafc0", "#74a84b", "#d885aa", "#7d8da8"
  ];

  var ROLE_CATALOG = Object.freeze([
    { id: "villager", en: "Villager", fa: "شهروند ساده", ru: "Мирный житель", team: "Citizen", defaultCount: 3 },
    { id: "mafia", en: "Mafia", fa: "مافیای ساده", ru: "Мафия", team: "Mafia", defaultCount: 2 },
    { id: "detective", en: "Detective", fa: "کارآگاه", ru: "Комиссар", team: "Citizen", defaultCount: 1 },
    { id: "doctor", en: "Doctor", fa: "دکتر", ru: "Доктор", team: "Citizen", defaultCount: 1 },
    { id: "godfather", en: "Godfather", fa: "پدرخوانده", ru: "Дон", team: "Mafia", defaultCount: 0 },
    { id: "bodyguard", en: "Bodyguard", fa: "محافظ", ru: "Телохранитель", team: "Citizen", defaultCount: 0 },
    { id: "sniper", en: "Sniper", fa: "تک‌تیرانداز", ru: "Снайпер", team: "Citizen", defaultCount: 0 },
    { id: "mayor", en: "Mayor", fa: "شهردار", ru: "Мэр", team: "Citizen", defaultCount: 0 },
    { id: "psychologist", en: "Psychologist", fa: "روان‌پزشک", ru: "Психолог", team: "Citizen", defaultCount: 0 },
    { id: "bulletproof", en: "Bulletproof", fa: "رویین‌تن", ru: "Бессмертный", team: "Citizen", defaultCount: 0 },
    { id: "priest", en: "Priest", fa: "کشیش", ru: "Священник", team: "Citizen", defaultCount: 0 },
    { id: "mason", en: "Mason", fa: "فراماسون", ru: "Масон", team: "Citizen", defaultCount: 0 },
    { id: "lawyer", en: "Lawyer", fa: "وکیل", ru: "Адвокат", team: "Mafia", defaultCount: 0 },
    { id: "framer", en: "Framer", fa: "پاپوش‌دوز", ru: "Подставщик", team: "Mafia", defaultCount: 0 },
    { id: "silencer", en: "Silencer", fa: "ساکت‌کننده", ru: "Молчун", team: "Mafia", defaultCount: 0 },
    { id: "serial-killer", en: "Serial Killer", fa: "قاتل زنجیره‌ای", ru: "Маньяк", team: "Independent", defaultCount: 0 },
    { id: "jester", en: "Jester", fa: "جوکر", ru: "Шут", team: "Independent", defaultCount: 0 },
    { id: "cupid", en: "Cupid", fa: "کوپیدو", ru: "Купидон", team: "Independent", defaultCount: 0 },
    { id: "hunter", en: "Hunter", fa: "شکارچی", ru: "Охотник", team: "Citizen", defaultCount: 0 }
  ]);

  function byId(id) {
    return document.getElementById(id);
  }

  var refs = {
    app: byId("rrApp"),
    menuButton: byId("rrMenuButton"),
    menu: byId("rrMenu"),
    modeButtons: Array.prototype.slice.call(document.querySelectorAll(".rr-mode")),
    rosterSummary: byId("rrRosterSummary"),
    setupButton: byId("rrSetupButton"),
    historyButton: byId("rrHistoryButton"),
    historyCount: byId("rrHistoryCount"),
    wheelHeading: byId("rrWheelHeading"),
    oddsValue: byId("rrOddsValue"),
    wheelWrap: byId("rrWheelWrap"),
    wheel: byId("rrWheel"),
    wheelCount: byId("rrWheelCount"),
    wheelCountLabel: byId("rrWheelCountLabel"),
    probabilityText: byId("rrProbabilityText"),
    resultKicker: byId("rrResultKicker"),
    roundPill: byId("rrRoundPill"),
    resultCard: document.querySelector(".rr-result-card"),
    resultDisplay: byId("rrResultDisplay"),
    resultSymbol: byId("rrResultSymbol"),
    resultTitle: byId("rrResultTitle"),
    resultMessage: byId("rrResultMessage"),
    roleReveal: byId("rrRoleReveal"),
    roleText: byId("rrRoleText"),
    rolePersian: byId("rrRolePersian"),
    roleRussian: byId("rrRoleRussian"),
    pickButton: byId("rrPickButton"),
    keyHint: byId("rrKeyHint"),
    undoButton: byId("rrUndoButton"),
    resetButton: byId("rrResetButton"),
    progressLabel: byId("rrProgressLabel"),
    progressValue: byId("rrProgressValue"),
    progressTrack: byId("rrProgressTrack"),
    progressBar: byId("rrProgressBar"),
    privacyCopy: byId("rrPrivacyCopy"),
    drawerScrim: byId("rrDrawerScrim"),
    historyDrawer: byId("rrHistoryDrawer"),
    historyClose: byId("rrHistoryClose"),
    roleHistoryToggle: byId("rrRoleHistoryToggle"),
    clearHistory: byId("rrClearHistory"),
    historyList: byId("rrHistoryList"),
    historyEmpty: byId("rrHistoryEmpty"),
    setupModal: byId("rrSetupModal"),
    setupDialog: document.querySelector(".rr-setup-dialog"),
    setupClose: byId("rrSetupClose"),
    cancelSetup: byId("rrCancelSetup"),
    rosterInput: byId("rrRosterInput"),
    exampleButton: byId("rrExampleButton"),
    dropZone: byId("rrDropZone"),
    fileInput: byId("rrFileInput"),
    browseButton: byId("rrBrowseButton"),
    detectedPanel: byId("rrDetectedPanel"),
    columnSelect: byId("rrColumnSelect"),
    detectedSummary: byId("rrDetectedSummary"),
    playerEditor: byId("rrPlayerEditor"),
    playerCount: byId("rrPlayerCount"),
    playerList: byId("rrPlayerList"),
    addPlayerButton: byId("rrAddPlayerButton"),
    roleEditor: byId("rrRoleEditor"),
    roleSummary: byId("rrRoleSummary"),
    roleCatalog: byId("rrRoleCatalog"),
    fitRolesButton: byId("rrFitRolesButton"),
    roleCount: byId("rrRoleCount"),
    formStatus: byId("rrFormStatus"),
    useRoster: byId("rrUseRoster"),
    toast: byId("rrToast")
  };

  var state = {
    mode: "class",
    roster: [],
    roles: [],
    classPool: [],
    mafiaPool: [],
    mafiaRolePool: [],
    currentClassId: null,
    currentMafia: null,
    mafiaRoleVisible: false,
    history: [],
    rounds: { class: 1, mafia: 1 },
    candidate: null,
    candidateColumn: 0,
    candidateInputText: "",
    editedLabels: [],
    spinning: false,
    rotation: 0,
    fileRequest: 0,
    inputTimer: 0,
    toastTimer: 0,
    clearTimer: 0,
    clearArmed: false,
    roleHistoryVisible: false,
    roleCatalogDirty: false,
    lastFocus: null,
    canvasReady: true
  };

  function setText(node, value) {
    node.textContent = String(value);
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    setText(refs.toast, message);
    refs.toast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(function () {
      refs.toast.classList.remove("is-visible");
    }, 2600);
  }

  function setFormStatus(message, kind) {
    setText(refs.formStatus, message);
    refs.formStatus.classList.toggle("is-error", kind === "error");
    refs.formStatus.classList.toggle("is-success", kind === "success");
  }

  function personById(id) {
    for (var i = 0; i < state.roster.length; i += 1) {
      if (state.roster[i].id === id) return state.roster[i];
    }
    return null;
  }

  function secureIndex(length) {
    if (!Number.isSafeInteger(length) || length < 1) {
      throw new Error("A positive pool size is required.");
    }
    if (!window.crypto || typeof window.crypto.getRandomValues !== "function") {
      throw new Error("Secure random picking is unavailable in this browser.");
    }
    var range = 4294967296;
    var limit = range - (range % length);
    var values = new Uint32Array(1);
    do {
      window.crypto.getRandomValues(values);
    } while (values[0] >= limit);
    return values[0] % length;
  }

  function roleById(id) {
    for (var i = 0; i < ROLE_CATALOG.length; i += 1) {
      if (ROLE_CATALOG[i].id === id) return ROLE_CATALOG[i];
    }
    return null;
  }

  function roleDisplay(role) {
    return role ? role.en + " · " + role.fa + " · " + role.ru : "Role hidden";
  }

  function recommendedRoleCounts(playerCount) {
    var counts = Object.create(null);
    if (playerCount < 1) return counts;
    var mafiaCount = Math.max(1, Math.floor(playerCount / 4));
    var detectiveCount = playerCount >= 5 ? 1 : 0;
    var doctorCount = playerCount >= 6 ? 1 : 0;
    counts.mafia = mafiaCount;
    counts.detective = detectiveCount;
    counts.doctor = doctorCount;
    counts.villager = Math.max(0, playerCount - mafiaCount - detectiveCount - doctorCount);
    return counts;
  }

  function catalogRows() {
    return Array.prototype.slice.call(refs.roleCatalog.querySelectorAll(".rr-role-row"));
  }

  function setRoleRowCount(row, count) {
    var checkbox = row.querySelector(".rr-role-enabled");
    var input = row.querySelector(".rr-role-count-input");
    var safeCount = Math.max(0, Math.min(LIMITS.maxNames, Math.floor(Number(count) || 0)));
    checkbox.checked = safeCount > 0;
    input.disabled = !checkbox.checked;
    input.value = String(safeCount);
    row.classList.toggle("is-active", checkbox.checked);
  }

  function roleDeckFromCatalog() {
    var deck = [];
    catalogRows().forEach(function (row) {
      var checkbox = row.querySelector(".rr-role-enabled");
      if (!checkbox.checked) return;
      var input = row.querySelector(".rr-role-count-input");
      var count = Number(input.value);
      if (!Number.isSafeInteger(count) || count < 1 || count > LIMITS.maxNames) {
        var invalidRole = roleById(row.dataset.roleId);
        throw new Error((invalidRole ? invalidRole.en : "Each role") + " needs a whole-number count from 1 to " + LIMITS.maxNames + ".");
      }
      var role = roleById(row.dataset.roleId);
      for (var i = 0; i < count; i += 1) deck.push(role);
      if (deck.length > LIMITS.maxNames) throw new Error("The role deck is too large.");
    });
    return deck;
  }

  function setCatalogFromCounts(counts, dirty) {
    catalogRows().forEach(function (row) {
      setRoleRowCount(row, counts[row.dataset.roleId] || 0);
    });
    state.roleCatalogDirty = Boolean(dirty);
    updateRoleCount();
  }

  function setCatalogFromDeck(deck) {
    var counts = Object.create(null);
    deck.forEach(function (role) {
      if (role && role.id) counts[role.id] = (counts[role.id] || 0) + 1;
    });
    setCatalogFromCounts(counts, true);
  }

  function fitRecommendedRoles(playerCount) {
    if (playerCount < 2) throw new Error("Add the roster before fitting role counts.");
    setCatalogFromCounts(recommendedRoleCounts(playerCount), false);
  }

  function renderRoleCatalog() {
    refs.roleCatalog.replaceChildren();
    ROLE_CATALOG.forEach(function (role, index) {
      var row = document.createElement("div");
      row.className = "rr-role-row";
      row.dataset.roleId = role.id;

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "rr-role-enabled";
      checkbox.id = "rrRole-" + role.id;
      checkbox.setAttribute("aria-label", "Use " + role.en);

      var labels = document.createElement("label");
      labels.className = "rr-role-copy";
      labels.htmlFor = checkbox.id;
      var title = document.createElement("span");
      title.className = "rr-role-name";
      title.textContent = role.en;
      var team = document.createElement("span");
      team.className = "rr-role-team rr-team-" + role.team.toLowerCase();
      team.textContent = role.team;
      title.appendChild(team);
      var translations = document.createElement("span");
      translations.className = "rr-role-translations";
      var persian = document.createElement("span");
      persian.lang = "fa";
      persian.dir = "rtl";
      persian.textContent = role.fa;
      var russian = document.createElement("span");
      russian.lang = "ru";
      russian.textContent = role.ru;
      translations.append(persian, russian);
      labels.append(title, translations);

      var count = document.createElement("input");
      count.type = "number";
      count.className = "rr-role-count-input";
      count.id = "rrRole-" + role.id + "-count";
      count.min = "0";
      count.max = String(LIMITS.maxNames);
      count.step = "1";
      count.inputMode = "numeric";
      count.setAttribute("aria-label", role.en + " count");

      checkbox.addEventListener("change", function () {
        setRoleRowCount(row, checkbox.checked ? Math.max(1, Number(count.value) || 1) : 0);
        state.roleCatalogDirty = true;
        updateRoleCount();
      });
      count.addEventListener("input", function () {
        if (count.value === "") {
          state.roleCatalogDirty = true;
          updateRoleCount();
          return;
        }
        setRoleRowCount(row, count.value);
        state.roleCatalogDirty = true;
        updateRoleCount();
      });

      row.append(checkbox, labels, count);
      refs.roleCatalog.appendChild(row);
      setRoleRowCount(row, role.defaultCount);
      if (index === 3) row.classList.add("rr-common-role-end");
    });
    updateRoleCount();
  }

  function hasLoneSurrogate(text) {
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        if (i + 1 >= text.length) return true;
        var next = text.charCodeAt(i + 1);
        if (next < 0xdc00 || next > 0xdfff) return true;
        i += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return true;
      }
    }
    return false;
  }

  function cleanSingleLine(value, maxLength, fieldName) {
    var text = value === null || value === undefined ? "" : String(value);
    if (hasLoneSurrogate(text)) {
      throw new Error(fieldName + " contains an incomplete Unicode character.");
    }
    text = text.normalize("NFC").replace(/[\t\r\n ]+/g, " ").trim();
    if (!text) return "";
    if (/[\u0000-\u001f\u007f]/.test(text)) {
      throw new Error(fieldName + " contains unsupported control characters.");
    }
    if (Array.from(text).length > maxLength) {
      throw new Error(fieldName + " must be " + maxLength + " characters or fewer.");
    }
    return text;
  }

  function stripOuterCsvQuotes(value) {
    var text = value.trim();
    if (text.length >= 2 && text.charAt(0) === '"' && text.charAt(text.length - 1) === '"') {
      return text.slice(1, -1).replace(/""/g, '"');
    }
    return text;
  }

  function countDelimiterOutsideQuotes(text, delimiter) {
    var count = 0;
    var quoted = false;
    var limit = Math.min(text.length, 12000);
    for (var i = 0; i < limit; i += 1) {
      var char = text.charAt(i);
      if (char === '"') {
        if (quoted && text.charAt(i + 1) === '"') {
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (!quoted && char === delimiter) {
        count += 1;
      }
    }
    return count;
  }

  function detectDelimiter(text) {
    var tabs = countDelimiterOutsideQuotes(text, "\t");
    if (tabs > 0) return "\t";
    var commas = countDelimiterOutsideQuotes(text, ",");
    var semicolons = countDelimiterOutsideQuotes(text, ";");
    if (commas === 0 && semicolons === 0) return null;
    return commas >= semicolons ? "," : ";";
  }

  function parseDelimited(text) {
    var normalized = text.replace(/^\ufeff/, "");
    var delimiter = detectDelimiter(normalized);
    if (!delimiter) {
      var simpleRows = normalized.split(/\r?\n/).map(function (line) {
        return [stripOuterCsvQuotes(line)];
      });
      if (simpleRows.length > LIMITS.maxRows + 1) {
        throw new Error("The table has more than " + LIMITS.maxRows + " rows.");
      }
      return simpleRows;
    }

    var rows = [];
    var row = [];
    var field = "";
    var quoted = false;
    for (var i = 0; i < normalized.length; i += 1) {
      var char = normalized.charAt(i);
      if (quoted) {
        if (char === '"' && normalized.charAt(i + 1) === '"') {
          field += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"' && field.length === 0) {
        quoted = true;
      } else if (char === delimiter) {
        row.push(field);
        field = "";
        if (row.length > LIMITS.maxColumns) {
          throw new Error("The table has more than " + LIMITS.maxColumns + " columns.");
        }
      } else if (char === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
        if (rows.length > LIMITS.maxRows + 1) {
          throw new Error("The table has more than " + LIMITS.maxRows + " rows.");
        }
      } else {
        field += char;
      }
    }
    if (quoted) throw new Error("The text table has an unfinished quoted value.");
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
    return rows;
  }

  function compactMatrix(matrix) {
    var rows = [];
    for (var r = 0; r < matrix.length && r <= LIMITS.maxRows; r += 1) {
      var sourceRow = Array.isArray(matrix[r]) ? matrix[r] : [matrix[r]];
      var nextRow = [];
      var hasValue = false;
      for (var c = 0; c < sourceRow.length && c < LIMITS.maxColumns; c += 1) {
        var value = sourceRow[c] === null || sourceRow[c] === undefined ? "" : String(sourceRow[c]);
        nextRow.push(value);
        if (value.trim()) hasValue = true;
      }
      if (hasValue) rows.push(nextRow);
    }
    if (rows.length === 1 && rows[0].length > 1) {
      return rows[0].filter(function (value) { return value.trim(); }).map(function (value) { return [value]; });
    }
    return rows;
  }

  function columnLetter(index) {
    var value = index + 1;
    var label = "";
    while (value > 0) {
      var remainder = (value - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      value = Math.floor((value - 1) / 26);
    }
    return label;
  }

  function candidateInfo(matrix) {
    var columnCount = 0;
    for (var r = 0; r < matrix.length; r += 1) {
      columnCount = Math.max(columnCount, matrix[r].length);
    }
    columnCount = Math.min(columnCount, LIMITS.maxColumns);
    var hasHeader = false;
    var headerMatch = -1;
    if (matrix.length) {
      for (var c = 0; c < columnCount; c += 1) {
        var normalized = String(matrix[0][c] || "").trim().toLowerCase();
        if (HEADER_NAMES.has(normalized)) {
          hasHeader = true;
          if (headerMatch < 0) headerMatch = c;
        }
      }
    }
    var startRow = hasHeader ? 1 : 0;
    var bestColumn = headerMatch >= 0 ? headerMatch : 0;
    var bestScore = -1;
    if (headerMatch < 0) {
      for (var column = 0; column < columnCount; column += 1) {
        var score = 0;
        for (var row = startRow; row < matrix.length; row += 1) {
          if (String(matrix[row][column] || "").trim()) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestColumn = column;
        }
      }
    }
    return {
      columnCount: columnCount,
      hasHeader: hasHeader,
      startRow: startRow,
      bestColumn: bestColumn
    };
  }

  function labelsFromSelectedColumn() {
    if (!state.candidate) return [];
    var labels = [];
    var matrix = state.candidate.matrix;
    var start = state.candidate.info.startRow;
    for (var r = start; r < matrix.length; r += 1) {
      var raw = matrix[r][state.candidateColumn];
      var label = cleanSingleLine(raw, LIMITS.maxNameLength, "A name");
      if (label) labels.push(label);
    }
    if (labels.length > LIMITS.maxNames) {
      throw new Error("Use no more than " + LIMITS.maxNames + " names.");
    }
    return labels;
  }

  function labelsFromCandidate() {
    if (!state.candidate) return [];
    if (state.editedLabels.length > LIMITS.maxNames) {
      throw new Error("Use no more than " + LIMITS.maxNames + " names.");
    }
    return state.editedLabels.map(function (raw, index) {
      var label = cleanSingleLine(raw, LIMITS.maxNameLength, "Player " + (index + 1));
      if (!label) throw new Error("Player " + (index + 1) + " needs a name or can be removed.");
      return label;
    });
  }

  function updatePlayerEditorStatus() {
    var count = state.editedLabels.length;
    setText(refs.playerCount, count + (count === 1 ? " player" : " players"));
    if (!state.candidate) return;
    try {
      var labels = labelsFromCandidate();
      setText(refs.detectedSummary, "Detected " + state.candidate.matrix.length + " rows and " + state.candidate.info.columnCount + " columns. The editable list contains " + labels.length + " names.");
      setFormStatus(labels.length >= 2 ? labels.length + " names are ready." : "Add at least two names to begin.", labels.length >= 2 ? "success" : "");
    } catch (error) {
      setText(refs.detectedSummary, "The editable player list needs attention.");
      setFormStatus(error.message, "error");
    }
    updateRoleCount();
  }

  function renderPlayerEditor() {
    refs.playerList.replaceChildren();
    refs.playerEditor.hidden = !state.candidate;
    if (!state.candidate) return;

    state.editedLabels.forEach(function (label, index) {
      var row = document.createElement("div");
      row.className = "rr-player-row";
      row.setAttribute("role", "listitem");

      var number = document.createElement("span");
      number.className = "rr-player-number";
      number.textContent = String(index + 1);

      var input = document.createElement("input");
      input.type = "text";
      input.className = "rr-player-name-input";
      input.id = "rrPlayerName-" + index;
      input.maxLength = LIMITS.maxNameLength;
      input.autocomplete = "off";
      input.spellcheck = false;
      input.value = label;
      input.setAttribute("aria-label", "Player " + (index + 1) + " name");
      input.addEventListener("input", function () {
        state.editedLabels[index] = input.value;
        updatePlayerEditorStatus();
      });

      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "rr-player-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove player " + (index + 1));
      remove.addEventListener("click", function () {
        state.editedLabels.splice(index, 1);
        renderPlayerEditor();
        updatePlayerEditorStatus();
        var nextInput = refs.playerList.querySelector(".rr-player-name-input");
        if (nextInput && state.editedLabels.length) {
          var focusIndex = Math.min(index, state.editedLabels.length - 1);
          refs.playerList.querySelectorAll(".rr-player-name-input")[focusIndex].focus();
        }
      });

      row.append(number, input, remove);
      refs.playerList.appendChild(row);
    });
    refs.addPlayerButton.disabled = state.editedLabels.length >= LIMITS.maxNames;
    setText(refs.playerCount, state.editedLabels.length + (state.editedLabels.length === 1 ? " player" : " players"));
  }

  function renderCandidatePanel() {
    refs.columnSelect.replaceChildren();
    if (!state.candidate || !state.candidate.matrix.length) {
      refs.detectedPanel.hidden = true;
      refs.playerEditor.hidden = true;
      return;
    }
    var info = state.candidate.info;
    for (var c = 0; c < info.columnCount; c += 1) {
      var option = document.createElement("option");
      option.value = String(c);
      var header = info.hasHeader ? cleanSingleLine(state.candidate.matrix[0][c] || "", LIMITS.maxNameLength, "A heading") : "";
      option.textContent = header ? header + " (column " + columnLetter(c) + ")" : "Column " + columnLetter(c);
      option.selected = c === state.candidateColumn;
      refs.columnSelect.appendChild(option);
    }
    refs.detectedPanel.hidden = info.columnCount <= 1;
    renderPlayerEditor();
    updatePlayerEditorStatus();
  }

  function setCandidate(matrix, source, inputText) {
    var compact = compactMatrix(matrix);
    if (!compact.length) throw new Error("No usable rows were found.");
    var info = candidateInfo(compact);
    if (!info.columnCount) throw new Error("No usable columns were found.");
    state.candidate = { matrix: compact, info: info, source: source };
    state.candidateColumn = info.bestColumn;
    state.candidateInputText = inputText === undefined ? refs.rosterInput.value : inputText;
    state.editedLabels = labelsFromSelectedColumn();
    renderCandidatePanel();
  }

  function analyzePastedInput() {
    var text = refs.rosterInput.value;
    if (!text.trim()) {
      state.candidate = null;
      state.candidateInputText = text;
      state.editedLabels = [];
      refs.detectedPanel.hidden = true;
      refs.playerEditor.hidden = true;
      setFormStatus("Paste at least two names to begin.", "");
      updateRoleCount();
      return;
    }
    try {
      setCandidate(parseDelimited(text), "pasted table", text);
    } catch (error) {
      state.candidate = null;
      state.candidateInputText = text;
      state.editedLabels = [];
      refs.detectedPanel.hidden = true;
      refs.playerEditor.hidden = true;
      setFormStatus(error.message, "error");
    }
  }

  function readUint16(view, offset) {
    return view.getUint16(offset, true);
  }

  function readUint32(view, offset) {
    return view.getUint32(offset, true);
  }

  function validateXlsxZip(arrayBuffer) {
    var view = new DataView(arrayBuffer);
    var bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 22 || readUint32(view, 0) !== 0x04034b50) {
      throw new Error("The Excel file does not have a valid XLSX container.");
    }

    var scanStart = Math.max(0, bytes.length - 65557);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= scanStart; i -= 1) {
      if (readUint32(view, i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("The Excel file is incomplete or malformed.");

    var diskNumber = readUint16(view, eocd + 4);
    var centralDisk = readUint16(view, eocd + 6);
    var diskEntries = readUint16(view, eocd + 8);
    var totalEntries = readUint16(view, eocd + 10);
    var centralSize = readUint32(view, eocd + 12);
    var centralOffset = readUint32(view, eocd + 16);
    var commentLength = readUint16(view, eocd + 20);

    if (eocd + 22 + commentLength !== bytes.length) {
      throw new Error("The Excel file has unsupported trailing data.");
    }
    if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
      throw new Error("Multi-part Excel files are not supported.");
    }
    if (totalEntries < 3 || totalEntries > LIMITS.maxZipEntries || totalEntries === 0xffff) {
      throw new Error("The Excel workbook has an unsupported number of internal files.");
    }
    if (centralOffset === 0xffffffff || centralSize === 0xffffffff || centralOffset + centralSize > eocd) {
      throw new Error("ZIP64 and malformed Excel containers are not supported.");
    }

    var decoder = new TextDecoder("utf-8", { fatal: true });
    var cursor = centralOffset;
    var expandedTotal = 0;
    var names = new Set();
    var hasContentTypes = false;
    var hasWorkbook = false;
    var hasWorksheet = false;

    for (var entry = 0; entry < totalEntries; entry += 1) {
      if (cursor + 46 > eocd || readUint32(view, cursor) !== 0x02014b50) {
        throw new Error("The Excel file has a malformed directory.");
      }
      var flags = readUint16(view, cursor + 8);
      var compression = readUint16(view, cursor + 10);
      var compressedSize = readUint32(view, cursor + 20);
      var expandedSize = readUint32(view, cursor + 24);
      var nameLength = readUint16(view, cursor + 28);
      var extraLength = readUint16(view, cursor + 30);
      var entryCommentLength = readUint16(view, cursor + 32);
      var entryDisk = readUint16(view, cursor + 34);
      var localOffset = readUint32(view, cursor + 42);
      var next = cursor + 46 + nameLength + extraLength + entryCommentLength;

      if ((flags & 1) !== 0) throw new Error("Encrypted Excel files are not supported.");
      if (compression !== 0 && compression !== 8) throw new Error("The Excel file uses an unsupported compression method.");
      if (entryDisk !== 0 || compressedSize === 0xffffffff || expandedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw new Error("ZIP64 and multi-part Excel files are not supported.");
      }
      if (next > eocd || localOffset + 30 > centralOffset || readUint32(view, localOffset) !== 0x04034b50) {
        throw new Error("The Excel file has an invalid internal entry.");
      }
      if (expandedSize > LIMITS.maxEntryBytes) throw new Error("An internal workbook part is too large.");
      if (expandedSize > 0 && compressedSize === 0) throw new Error("The Excel file has an invalid compression ratio.");
      if (compressedSize > 0 && expandedSize / compressedSize > LIMITS.maxCompressionRatio) {
        throw new Error("The Excel file expands too much to process safely.");
      }
      expandedTotal += expandedSize;
      if (expandedTotal > LIMITS.maxExpandedBytes) throw new Error("The expanded Excel workbook is too large.");

      var name;
      try {
        name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      } catch (error) {
        throw new Error("The Excel file has an invalid internal filename.");
      }
      if (!name || name.charAt(0) === "/" || name.indexOf("\\") >= 0 || name.split("/").indexOf("..") >= 0) {
        throw new Error("The Excel file has an unsafe internal path.");
      }
      if (names.has(name)) throw new Error("The Excel file has duplicate internal paths.");
      names.add(name);
      if (name === "[Content_Types].xml") hasContentTypes = true;
      if (name === "xl/workbook.xml") hasWorkbook = true;
      if (/^xl\/worksheets\/sheet[^/]*\.xml$/i.test(name)) hasWorksheet = true;
      cursor = next;
    }

    if (cursor !== centralOffset + centralSize) {
      throw new Error("The Excel file has an unsupported directory layout.");
    }
    if (!hasContentTypes || !hasWorkbook || !hasWorksheet) {
      throw new Error("The selected file is not a supported XLSX workbook.");
    }
  }

  function matrixFromWorkbook(arrayBuffer) {
    if (!window.XLSX || typeof window.XLSX.read !== "function") {
      throw new Error("Excel reading did not load. Use pasted cells or a CSV file instead.");
    }
    var workbook = window.XLSX.read(arrayBuffer, {
      dense: true,
      sheetRows: LIMITS.maxRows + 1,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      bookDeps: false,
      bookFiles: false,
      bookProps: false
    });
    for (var i = 0; i < workbook.SheetNames.length; i += 1) {
      var sheet = workbook.Sheets[workbook.SheetNames[i]];
      var matrix = window.XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        blankrows: false,
        raw: false,
        defval: ""
      });
      var compact = compactMatrix(matrix);
      if (compact.length) return compact;
    }
    throw new Error("No populated worksheet was found.");
  }

  function isZipSignature(bytes) {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }

  async function readRosterFile(file) {
    if (!file) return;
    if (file.size < 1) {
      setFormStatus("The selected file is empty.", "error");
      return;
    }
    if (file.size > LIMITS.maxFileBytes) {
      setFormStatus("Choose a roster file smaller than 2 MB.", "error");
      return;
    }
    var request = state.fileRequest + 1;
    state.fileRequest = request;
    refs.browseButton.disabled = true;
    refs.useRoster.disabled = true;
    setFormStatus("Reading " + file.name + " locally.", "");
    try {
      var arrayBuffer = await file.arrayBuffer();
      if (request !== state.fileRequest) return;
      var bytes = new Uint8Array(arrayBuffer);
      var matrix;
      var source;
      if (isZipSignature(bytes)) {
        validateXlsxZip(arrayBuffer);
        matrix = matrixFromWorkbook(arrayBuffer);
        source = "Excel workbook";
      } else {
        var text;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch (error) {
          throw new Error("The file is neither a valid XLSX workbook nor UTF-8 text.");
        }
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
          throw new Error("The text file contains unsupported control characters.");
        }
        matrix = parseDelimited(text);
        source = "text table";
      }
      if (request !== state.fileRequest) return;
      refs.rosterInput.value = "";
      setCandidate(matrix, source);
      var labels = labelsFromCandidate();
      setFormStatus("Loaded " + labels.length + " names from " + file.name + " as a " + source + ".", "success");
    } catch (error) {
      if (request === state.fileRequest) setFormStatus(error.message, "error");
    } finally {
      if (request === state.fileRequest) {
        refs.browseButton.disabled = false;
        refs.useRoster.disabled = false;
        refs.fileInput.value = "";
      }
    }
  }

  function updateRoleCount() {
    var nameCount = 0;
    try {
      nameCount = state.candidate ? labelsFromCandidate().length : state.roster.length;
    } catch (error) {
      nameCount = 0;
    }
    var roleCount = 0;
    var activeTypes = 0;
    try {
      roleCount = roleDeckFromCatalog().length;
      activeTypes = catalogRows().filter(function (row) {
        return row.querySelector(".rr-role-enabled").checked;
      }).length;
    } catch (error) {
      setText(refs.roleCount, error.message);
      refs.roleCount.classList.add("is-mismatch");
      return;
    }
    refs.roleCount.classList.toggle("is-mismatch", Boolean(nameCount && roleCount !== nameCount));
    setText(refs.roleSummary, activeTypes + (activeTypes === 1 ? " role type is" : " role types are") + " active. Set a count for each role.");
    if (!nameCount) {
      setText(refs.roleCount, roleCount + " roles selected. Add a roster to check the total.");
    } else if (roleCount === nameCount) {
      setText(refs.roleCount, roleCount + " roles match " + nameCount + " players.");
    } else {
      setText(refs.roleCount, roleCount + " roles for " + nameCount + " players.");
    }
  }

  function applyRoster(labels, roles) {
    state.roster = labels.map(function (label, index) {
      return { id: "person-" + (index + 1), label: label };
    });
    state.roles = roles.slice();
    state.classPool = state.roster.map(function (person) { return person.id; });
    state.mafiaPool = state.roster.map(function (person) { return person.id; });
    state.mafiaRolePool = state.roles.slice();
    state.currentClassId = null;
    state.currentMafia = null;
    state.mafiaRoleVisible = false;
    state.history = [];
    state.rounds = { class: 1, mafia: 1 };
    state.rotation = 0;
    refs.wheel.style.setProperty("--rr-wheel-rotation", "0deg");
    closeHistory();
    closeSetup();
    renderAll();
    showToast(labels.length + " names are ready.");
  }

  function currentPool() {
    return state.mode === "class" ? state.classPool : state.mafiaPool;
  }

  function currentRound() {
    return state.rounds[state.mode];
  }

  function currentUsedCount() {
    return Math.max(0, state.roster.length - currentPool().length);
  }

  function historyIndexForUndo() {
    for (var i = state.history.length - 1; i >= 0; i -= 1) {
      var item = state.history[i];
      if (item.mode === state.mode && item.round === currentRound()) return i;
    }
    return -1;
  }

  function updateProgress(remaining) {
    var total = state.roster.length;
    var used = Math.max(0, total - remaining);
    var percent = total ? (used / total) * 100 : 0;
    setText(refs.progressValue, used + " of " + total);
    refs.progressBar.style.width = percent.toFixed(2) + "%";
    refs.progressTrack.setAttribute("aria-valuemin", "0");
    refs.progressTrack.setAttribute("aria-valuemax", String(total));
    refs.progressTrack.setAttribute("aria-valuenow", String(used));
  }

  function setResult(title, message, kicker, symbol) {
    setText(refs.resultTitle, title);
    refs.resultTitle.classList.toggle("rr-long-name", Array.from(String(title)).length > 18);
    setText(refs.resultMessage, message);
    setText(refs.resultKicker, kicker);
    setText(refs.resultSymbol, symbol);
  }

  function renderClassMode(remaining) {
    refs.wheelHeading.textContent = "A fair turn for everyone";
    refs.privacyCopy.textContent = "Names are processed in your browser and are not uploaded or saved.";
    refs.roleReveal.hidden = true;
    setText(refs.progressLabel, remaining ? "Students who have had a turn" : state.roster.length ? "Round complete" : "Waiting for a roster");

    if (!state.roster.length) {
      setResult("Who is next?", "Add your class list, then every pick gets one fair turn.", "Ready", "✦");
      setText(refs.pickButton, "Add names");
      refs.pickButton.disabled = false;
    } else if (state.spinning) {
      setResult("Choosing…", "Every remaining name has the same chance.", "Spinning", "◌");
      setText(refs.pickButton, "Choosing…");
      refs.pickButton.disabled = true;
    } else if (state.currentClassId) {
      var person = personById(state.currentClassId);
      setResult(person ? person.label : "Selected", remaining ? "This name is out for the rest of this round." : "Everyone has now had one turn.", remaining ? "Selected" : "Round complete", "✓");
      setText(refs.pickButton, remaining ? "Pick another name" : "Start a new round");
      refs.pickButton.disabled = false;
    } else {
      setResult(remaining ? "Who is next?" : "Round complete", remaining ? "Press the button or Space to make a fair pick." : "Everyone had one turn. Start again with the same roster.", remaining ? "Ready" : "Complete", remaining ? "✦" : "✓");
      setText(refs.pickButton, remaining ? "Pick a name" : "Start a new round");
      refs.pickButton.disabled = false;
    }
    setText(refs.keyHint, remaining ? "Space to pick" : "Space to restart");
  }

  function renderMafiaMode(remaining) {
    refs.wheelHeading.textContent = "One player, one secret role";
    refs.privacyCopy.textContent = "Pass the device before revealing a role. Names and roles are not uploaded or saved.";
    setText(refs.progressLabel, remaining ? "Players with assigned roles" : state.roster.length ? "All roles assigned" : "Waiting for a roster");

    if (!state.roster.length) {
      refs.roleReveal.hidden = true;
      setResult("Set up the game", "Add player names. A balanced role deck can be created for you.", "Mafia mode", "◆");
      setText(refs.pickButton, "Add players");
      refs.pickButton.disabled = false;
    } else if (state.spinning) {
      refs.roleReveal.hidden = true;
      setResult("Assigning…", "A player and a private role are being paired fairly.", "Shuffling", "◌");
      setText(refs.pickButton, "Assigning…");
      refs.pickButton.disabled = true;
    } else if (state.currentMafia) {
      var currentPerson = personById(state.currentMafia.personId);
      var currentName = currentPerson ? currentPerson.label : "Player";
      if (state.mafiaRoleVisible) {
        setResult(currentName, "Remember your role, then hide it before passing the device back.", "Role revealed", "◇");
        refs.roleReveal.hidden = false;
        setText(refs.roleText, state.currentMafia.role.en);
        setText(refs.rolePersian, state.currentMafia.role.fa);
        setText(refs.roleRussian, state.currentMafia.role.ru);
        setText(refs.pickButton, "Hide role");
      } else {
        setResult(currentName, "Pass the device to this player. Reveal only when the screen is private.", "Pass the device", "◆");
        refs.roleReveal.hidden = true;
        setText(refs.pickButton, "Reveal private role");
      }
      refs.pickButton.disabled = false;
    } else if (remaining) {
      refs.roleReveal.hidden = true;
      setResult("Pass the device", "Assign the next player, then let only that player reveal the role.", "Mafia mode", "◆");
      setText(refs.pickButton, currentUsedCount() ? "Assign next player" : "Assign first player");
      refs.pickButton.disabled = false;
    } else {
      refs.roleReveal.hidden = true;
      setResult("All roles assigned", "The game is ready. History keeps every role hidden unless you choose to reveal it.", "Complete", "✓");
      setText(refs.pickButton, "Start a new role round");
      refs.pickButton.disabled = false;
    }
    setText(refs.keyHint, state.currentMafia ? (state.mafiaRoleVisible ? "Space to hide" : "Space to reveal") : remaining ? "Space to assign" : "Space to restart");
  }

  function renderMain() {
    var remaining = currentPool().length;
    var total = state.roster.length;
    refs.modeButtons.forEach(function (button) {
      var active = button.dataset.mode === state.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = state.spinning;
    });
    setText(refs.roundPill, "Round " + currentRound());
    setText(refs.rosterSummary, total ? remaining + " of " + total + " available" : "No roster yet");
    setText(refs.oddsValue, remaining ? "1 in " + remaining : "−");
    setText(refs.wheelCount, remaining);
    setText(refs.wheelCountLabel, remaining === 1 ? "left" : remaining ? "left" : total ? "done" : "ready");
    setText(refs.probabilityText, remaining ? "Each available person has a " + (100 / remaining).toFixed(remaining > 20 ? 1 : 2).replace(/\.0+$/, "") + "% chance." : total ? "No names remain in this round." : "Add a roster to begin.");
    refs.wheel.setAttribute("aria-label", remaining ? "Probability wheel with " + remaining + " equal chances" : "Empty probability wheel");
    refs.resetButton.disabled = !total || state.spinning || currentUsedCount() === 0;
    refs.undoButton.disabled = state.spinning || historyIndexForUndo() < 0;
    refs.setupButton.disabled = state.spinning;
    refs.resultDisplay.classList.toggle("is-picked", Boolean(state.currentClassId || state.currentMafia) && !state.spinning);
    refs.resultCard.classList.toggle("is-role-visible", state.mode === "mafia" && Boolean(state.currentMafia) && state.mafiaRoleVisible);
    updateProgress(remaining);
    if (state.mode === "class") renderClassMode(remaining);
    else renderMafiaMode(remaining);
    drawWheel(remaining);
  }

  function canvasColor(variable, fallback) {
    var value = window.getComputedStyle(refs.app).getPropertyValue(variable).trim();
    return value || fallback;
  }

  function drawWheel(count) {
    var context = refs.wheel.getContext("2d");
    if (!context) {
      state.canvasReady = false;
      refs.pickButton.disabled = true;
      setResult("Wheel unavailable", "This browser could not create the probability view.", "Unavailable", "!");
      return;
    }
    var size = refs.wheel.width;
    var center = size / 2;
    var radius = size * 0.47;
    context.clearRect(0, 0, size, size);
    context.save();
    context.translate(center, center);

    if (!count) {
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fillStyle = canvasColor("--site-accent-soft", "#e8e5f8");
      context.fill();
      context.setLineDash([10, 12]);
      context.lineWidth = 4;
      context.strokeStyle = canvasColor("--site-accent-muted", "#b5afd9");
      context.stroke();
      context.restore();
      return;
    }

    var segment = (Math.PI * 2) / count;
    var border = canvasColor("--bs-body-bg", "#ffffff");
    for (var i = 0; i < count; i += 1) {
      var start = -Math.PI / 2 + i * segment;
      var end = start + segment;
      context.beginPath();
      context.moveTo(0, 0);
      context.arc(0, 0, radius, start, end);
      context.closePath();
      context.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
      context.fill();
      if (count <= 120) {
        context.lineWidth = count > 48 ? 1.2 : 2.4;
        context.strokeStyle = border;
        context.stroke();
      }
    }

    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.lineWidth = 8;
    context.strokeStyle = canvasColor("--site-accent", "#22176f");
    context.stroke();
    context.restore();
  }

  function recordHistory(mode, personId, role) {
    var modeEntries = state.history.filter(function (item) {
      return item.mode === mode && item.round === state.rounds[mode];
    });
    state.history.push({
      mode: mode,
      round: state.rounds[mode],
      order: modeEntries.length + 1,
      personId: personId,
      role: role || "",
      time: Date.now()
    });
  }

  function animateSelection(index, poolSize, complete) {
    state.spinning = true;
    refs.wheelWrap.classList.add("is-spinning");
    renderMain();
    var segmentDegrees = 360 / poolSize;
    var target = (360 - ((index + 0.5) * segmentDegrees) % 360) % 360;
    var current = ((state.rotation % 360) + 360) % 360;
    var delta = (target - current + 360) % 360;
    state.rotation += 1440 + delta;
    refs.wheel.style.setProperty("--rr-wheel-rotation", state.rotation.toFixed(3) + "deg");
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(function () {
      complete();
      state.spinning = false;
      refs.wheelWrap.classList.remove("is-spinning");
      renderAll();
    }, reduced ? 30 : 1680);
  }

  function pickClassName() {
    if (!state.classPool.length || state.spinning) return;
    var index;
    try {
      index = secureIndex(state.classPool.length);
    } catch (error) {
      showToast(error.message);
      return;
    }
    var personId = state.classPool[index];
    animateSelection(index, state.classPool.length, function () {
      state.classPool.splice(index, 1);
      state.currentClassId = personId;
      recordHistory("class", personId, "");
    });
  }

  function assignMafiaRole() {
    if (!state.mafiaPool.length || !state.mafiaRolePool.length || state.spinning) return;
    var personIndex;
    var roleIndex;
    try {
      personIndex = secureIndex(state.mafiaPool.length);
      roleIndex = secureIndex(state.mafiaRolePool.length);
    } catch (error) {
      showToast(error.message);
      return;
    }
    var personId = state.mafiaPool[personIndex];
    var role = state.mafiaRolePool[roleIndex];
    animateSelection(personIndex, state.mafiaPool.length, function () {
      state.mafiaPool.splice(personIndex, 1);
      state.mafiaRolePool.splice(roleIndex, 1);
      state.currentMafia = { personId: personId, role: role };
      state.mafiaRoleVisible = false;
      recordHistory("mafia", personId, role);
    });
  }

  function resetRound(mode, announce) {
    if (!state.roster.length) return;
    state.rounds[mode] += 1;
    if (mode === "class") {
      state.classPool = state.roster.map(function (person) { return person.id; });
      state.currentClassId = null;
    } else {
      state.mafiaPool = state.roster.map(function (person) { return person.id; });
      state.mafiaRolePool = state.roles.slice();
      state.currentMafia = null;
      state.mafiaRoleVisible = false;
    }
    renderAll();
    if (announce) showToast("Round " + state.rounds[mode] + " is ready.");
  }

  function handlePrimaryAction() {
    if (state.spinning || !state.canvasReady) return;
    if (!state.roster.length) {
      openSetup();
      return;
    }
    if (state.mode === "class") {
      if (!state.classPool.length) resetRound("class", true);
      else pickClassName();
      return;
    }
    if (state.currentMafia) {
      if (!state.mafiaRoleVisible) {
        state.mafiaRoleVisible = true;
      } else {
        state.mafiaRoleVisible = false;
        state.currentMafia = null;
      }
      renderMain();
      return;
    }
    if (!state.mafiaPool.length) resetRound("mafia", true);
    else assignMafiaRole();
  }

  function undoLast() {
    var index = historyIndexForUndo();
    if (index < 0 || state.spinning) return;
    var item = state.history[index];
    state.history.splice(index, 1);
    if (item.mode === "class") {
      state.classPool.push(item.personId);
      state.currentClassId = null;
    } else {
      state.mafiaPool.push(item.personId);
      state.mafiaRolePool.push(item.role);
      state.currentMafia = null;
      state.mafiaRoleVisible = false;
    }
    renderAll();
    showToast("The last result was returned to the pool.");
  }

  function groupHistory() {
    var groups = [];
    var lookup = new Map();
    var reversed = state.history.slice().reverse();
    reversed.forEach(function (item) {
      var key = item.mode + "-" + item.round;
      if (!lookup.has(key)) {
        var group = { mode: item.mode, round: item.round, items: [] };
        lookup.set(key, group);
        groups.push(group);
      }
      lookup.get(key).items.push(item);
    });
    return groups;
  }

  function renderHistory() {
    refs.historyList.replaceChildren();
    var hasHistory = state.history.length > 0;
    refs.historyEmpty.hidden = hasHistory;
    refs.historyList.hidden = !hasHistory;
    setText(refs.historyCount, state.history.length);
    var hasMafia = state.history.some(function (item) { return item.mode === "mafia"; });
    refs.roleHistoryToggle.hidden = !hasMafia;
    refs.roleHistoryToggle.setAttribute("aria-pressed", String(state.roleHistoryVisible));
    setText(refs.roleHistoryToggle, state.roleHistoryVisible ? "Hide Mafia roles" : "Show Mafia roles");

    groupHistory().forEach(function (group) {
      var section = document.createElement("section");
      section.className = "rr-history-group";
      var heading = document.createElement("h3");
      heading.className = "rr-history-group-title";
      var headingLabel = document.createElement("span");
      headingLabel.textContent = (group.mode === "class" ? "Name picker" : "Mafia roles") + " · Round " + group.round;
      var headingCount = document.createElement("span");
      headingCount.textContent = group.items.length + (group.items.length === 1 ? " result" : " results");
      heading.append(headingLabel, headingCount);
      section.appendChild(heading);

      group.items.forEach(function (item) {
        var person = personById(item.personId);
        var row = document.createElement("div");
        row.className = "rr-history-row";
        var number = document.createElement("span");
        number.className = "rr-history-number";
        number.textContent = String(item.order);
        var name = document.createElement("span");
        name.className = "rr-history-name";
        name.textContent = person ? person.label : "Removed player";
        var meta = document.createElement("span");
        meta.className = "rr-history-meta";
        if (item.mode === "mafia") {
          var role = document.createElement("span");
          role.className = "rr-history-role";
          role.textContent = state.roleHistoryVisible ? roleDisplay(item.role) : "Role hidden";
          meta.appendChild(role);
        } else {
          meta.textContent = new Date(item.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }
        row.append(number, name, meta);
        section.appendChild(row);
      });
      refs.historyList.appendChild(section);
    });
  }

  function renderAll() {
    renderMain();
    renderHistory();
  }

  function openHistory() {
    if (!refs.setupModal.hidden) closeSetup();
    state.lastFocus = document.activeElement;
    refs.drawerScrim.hidden = false;
    refs.historyDrawer.classList.add("is-open");
    refs.historyDrawer.setAttribute("aria-hidden", "false");
    refs.historyButton.setAttribute("aria-expanded", "true");
    window.setTimeout(function () { refs.historyClose.focus(); }, 20);
  }

  function closeHistory() {
    var wasOpen = refs.historyDrawer.classList.contains("is-open");
    refs.historyDrawer.classList.remove("is-open");
    refs.historyDrawer.setAttribute("aria-hidden", "true");
    refs.historyButton.setAttribute("aria-expanded", "false");
    refs.drawerScrim.hidden = true;
    if (wasOpen && state.lastFocus && typeof state.lastFocus.focus === "function") state.lastFocus.focus();
  }

  function openSetup() {
    if (state.spinning) return;
    closeHistory();
    state.lastFocus = document.activeElement;
    state.fileRequest += 1;
    if (state.roster.length) {
      refs.rosterInput.value = state.roster.map(function (person) { return person.label; }).join("\n");
      setCatalogFromDeck(state.roles);
      analyzePastedInput();
    } else if (!refs.rosterInput.value.trim()) {
      state.candidate = null;
      state.candidateInputText = "";
      state.editedLabels = [];
      refs.detectedPanel.hidden = true;
      refs.playerEditor.hidden = true;
      setFormStatus("Paste at least two names to begin.", "");
      updateRoleCount();
    }
    refs.setupModal.hidden = false;
    document.body.classList.add("rr-modal-open");
    window.setTimeout(function () { refs.rosterInput.focus(); }, 20);
  }

  function closeSetup() {
    if (refs.setupModal.hidden) return;
    state.fileRequest += 1;
    refs.setupModal.hidden = true;
    document.body.classList.remove("rr-modal-open");
    if (state.lastFocus && typeof state.lastFocus.focus === "function") state.lastFocus.focus();
  }

  function useRosterFromDialog() {
    try {
      var typedRoster = refs.rosterInput.value;
      if (typedRoster.trim() && (!state.candidate || typedRoster !== state.candidateInputText)) {
        setCandidate(parseDelimited(typedRoster), "pasted table", typedRoster);
      }
      var labels = labelsFromCandidate();
      if (labels.length < 2) throw new Error("Add at least two names.");
      if (!state.roleCatalogDirty) fitRecommendedRoles(labels.length);
      var roles = roleDeckFromCatalog();
      if (!roles.length) throw new Error("Select at least one Mafia role.");
      if (roles.length !== labels.length) throw new Error("Set exactly " + labels.length + " roles before using this roster.");
      applyRoster(labels, roles);
    } catch (error) {
      setFormStatus(error.message, "error");
    }
  }

  function fitRecommendedRolesInDialog() {
    var count = 0;
    try {
      count = state.candidate ? labelsFromCandidate().length : state.roster.length;
    } catch (error) {
      setFormStatus(error.message, "error");
      return;
    }
    if (count < 2) {
      setFormStatus("Add the roster before building a role deck.", "error");
      return;
    }
    try {
      fitRecommendedRoles(count);
      refs.roleEditor.open = true;
      setFormStatus("Fitted the four common roles to " + count + " players.", "success");
    } catch (error) {
      setFormStatus(error.message, "error");
    }
  }

  function clearHistoryWithConfirmation() {
    if (!state.history.length) return;
    if (!state.clearArmed) {
      state.clearArmed = true;
      setText(refs.clearHistory, "Press again to clear");
      window.clearTimeout(state.clearTimer);
      state.clearTimer = window.setTimeout(function () {
        state.clearArmed = false;
        setText(refs.clearHistory, "Clear history");
      }, 3200);
      return;
    }
    window.clearTimeout(state.clearTimer);
    state.clearArmed = false;
    state.history = [];
    setText(refs.clearHistory, "Clear history");
    renderAll();
    showToast("Session history was cleared.");
  }

  function focusableElements(container) {
    return Array.prototype.slice.call(container.querySelectorAll(
      'button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled]), summary, a[href]'
    )).filter(function (element) {
      return !element.hidden && element.offsetParent !== null;
    });
  }

  function trapDialogFocus(event) {
    if (event.key !== "Tab" || refs.setupModal.hidden) return;
    var items = focusableElements(refs.setupDialog);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  refs.menuButton.addEventListener("click", function (event) {
    event.stopPropagation();
    refs.menu.hidden = !refs.menu.hidden;
    refs.menuButton.setAttribute("aria-expanded", String(!refs.menu.hidden));
  });

  document.addEventListener("click", function () {
    if (!refs.menu.hidden) {
      refs.menu.hidden = true;
      refs.menuButton.setAttribute("aria-expanded", "false");
    }
  });

  refs.modeButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      if (state.spinning) return;
      state.mode = button.dataset.mode === "mafia" ? "mafia" : "class";
      renderMain();
    });
  });

  refs.pickButton.addEventListener("click", handlePrimaryAction);
  refs.undoButton.addEventListener("click", undoLast);
  refs.resetButton.addEventListener("click", function () {
    if (!state.spinning) resetRound(state.mode, true);
  });
  refs.setupButton.addEventListener("click", openSetup);
  refs.historyButton.addEventListener("click", openHistory);
  refs.historyClose.addEventListener("click", closeHistory);
  refs.drawerScrim.addEventListener("click", closeHistory);
  refs.roleHistoryToggle.addEventListener("click", function () {
    state.roleHistoryVisible = !state.roleHistoryVisible;
    renderHistory();
  });
  refs.clearHistory.addEventListener("click", clearHistoryWithConfirmation);

  refs.setupClose.addEventListener("click", closeSetup);
  refs.cancelSetup.addEventListener("click", closeSetup);
  refs.setupModal.addEventListener("mousedown", function (event) {
    if (event.target === refs.setupModal) closeSetup();
  });
  refs.setupModal.addEventListener("keydown", trapDialogFocus);
  refs.useRoster.addEventListener("click", useRosterFromDialog);
  refs.exampleButton.addEventListener("click", function () {
    refs.rosterInput.value = "Student name\nAmina\nLucas\nMei\nNoah\nSofia\nEthan\nZara\nMateo";
    analyzePastedInput();
    fitRecommendedRoles(8);
    refs.rosterInput.focus();
  });

  refs.rosterInput.addEventListener("input", function () {
    state.fileRequest += 1;
    window.clearTimeout(state.inputTimer);
    state.inputTimer = window.setTimeout(analyzePastedInput, 120);
  });
  refs.columnSelect.addEventListener("change", function () {
    state.candidateColumn = Number(refs.columnSelect.value) || 0;
    state.editedLabels = labelsFromSelectedColumn();
    renderCandidatePanel();
  });
  refs.addPlayerButton.addEventListener("click", function () {
    if (!state.candidate || state.editedLabels.length >= LIMITS.maxNames) return;
    state.editedLabels.push("");
    renderPlayerEditor();
    updatePlayerEditorStatus();
    var inputs = refs.playerList.querySelectorAll(".rr-player-name-input");
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  refs.fitRolesButton.addEventListener("click", fitRecommendedRolesInDialog);
  refs.browseButton.addEventListener("click", function () { refs.fileInput.click(); });
  refs.fileInput.addEventListener("change", function () {
    if (refs.fileInput.files && refs.fileInput.files[0]) readRosterFile(refs.fileInput.files[0]);
  });

  ["dragenter", "dragover"].forEach(function (type) {
    refs.dropZone.addEventListener(type, function (event) {
      event.preventDefault();
      event.stopPropagation();
      refs.dropZone.classList.add("is-dragging");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
  });
  ["dragleave", "dragend"].forEach(function (type) {
    refs.dropZone.addEventListener(type, function (event) {
      event.preventDefault();
      event.stopPropagation();
      refs.dropZone.classList.remove("is-dragging");
    });
  });
  refs.dropZone.addEventListener("drop", function (event) {
    event.preventDefault();
    event.stopPropagation();
    refs.dropZone.classList.remove("is-dragging");
    var files = event.dataTransfer && event.dataTransfer.files;
    if (!files || files.length !== 1) {
      setFormStatus("Drop one roster file at a time.", "error");
      return;
    }
    readRosterFile(files[0]);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (!refs.setupModal.hidden) closeSetup();
      else if (refs.historyDrawer.classList.contains("is-open")) closeHistory();
      return;
    }
    if (event.code !== "Space" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!refs.setupModal.hidden || refs.historyDrawer.classList.contains("is-open")) return;
    var target = event.target;
    if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(target.tagName)) return;
    event.preventDefault();
    handlePrimaryAction();
  });

  window.addEventListener("resize", function () {
    drawWheel(currentPool().length);
  });

  renderRoleCatalog();
  renderAll();
  openSetup();
})();
