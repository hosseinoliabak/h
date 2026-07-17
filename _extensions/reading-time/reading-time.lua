-- reading-time.lua
-- Single source of truth for reading times.
-- Computes reading time per page using the Pandoc AST, saves to a shared JSON,
-- and uses that JSON for progress bars and section totals.
-- Supports a 'difficulty' front-matter field (1-5) that scales reading time
-- and displays a difficulty indicator.

local WPM = 150
local MAX_MINUTES = 180  -- cap: no single page is billed above 3 hours

-- Group an integer with thousands separators: 5300 -> "5,300"
local function commafy(n)
  local s = tostring(n)
  local out = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
  return (out:gsub("^,", ""))
end

-- JS that stamps the weekday onto the Published date and, when an order is
-- given, sets the Published cell's grid order. Shared by index and content pages.
local function published_js(order)
  local order_line = order and ('if (pw) pw.style.order = "' .. order .. '";') or ""
  return [[
    var dateEl = meta.querySelector(".date");
    if (dateEl) {
      var pw = dateEl.parentNode && dateEl.parentNode.parentNode;
      ]] .. order_line .. [[
      if (!dateEl.dataset.weekdayified) {
        var d = new Date(dateEl.textContent.trim());
        if (!isNaN(d.getTime())) {
          var days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
          dateEl.textContent = days[d.getDay()] + ", " + dateEl.textContent.trim();
        }
        dateEl.dataset.weekdayified = "1";
      }
    }
]]
end

-- Difficulty multipliers: how much longer dense content takes to absorb
local DIFFICULTY_MULTIPLIERS = {
  [1] = 0.85,
  [2] = 1.0,
  [3] = 1.2,
  [4] = 1.5,
  [5] = 2.0,
}

-- Use an absolute path derived from the project root for the shared JSON.
-- Quarto sets the working directory to the source file's directory,
-- but we need a project-wide file. We detect the project root by looking
-- for _quarto.yml going up from CWD.
local function find_project_root()
  local path = io.popen("pwd"):read("*l") or "."
  for i = 1, 10 do
    local f = io.open(path .. "/_quarto.yml", "r")
    if f then f:close(); return path end
    path = path .. "/.."
  end
  return "."
end

local PROJECT_ROOT = find_project_root()
local READING_TIMES_FILE = PROJECT_ROOT .. "/.quarto/_reading-times.json"

-- ============ Helpers for computing reading time from Pandoc AST ============

local function collect_text(blocks)
  local parts = {}
  for _, block in ipairs(blocks) do
    if block.t == "Para" or block.t == "Plain" or
       block.t == "Header" or block.t == "BlockQuote" then
      parts[#parts + 1] = pandoc.utils.stringify(block)
    elseif block.t == "BulletList" or block.t == "OrderedList" then
      for _, item in ipairs(block.content) do
        parts[#parts + 1] = pandoc.utils.stringify(pandoc.Div(item))
      end
    elseif block.t == "Table" then
      parts[#parts + 1] = pandoc.utils.stringify(block)
    elseif block.t == "Div" then
      parts[#parts + 1] = collect_text(block.content)
    end
  end
  return table.concat(parts, " ")
end

local function count_words(blocks)
  local text = collect_text(blocks)
  local n = 0
  for _ in text:gmatch("%S+") do n = n + 1 end
  return n
end

local function find_source_file(basename)
  local search_paths = {
    "math/calculus/" .. basename .. ".qmd",
    "math/linear-algebra/" .. basename .. ".qmd",
    "math/probability-statistics/" .. basename .. ".qmd",
    "networking/ccde-written/" .. basename .. ".qmd",
    "ai/agentic/" .. basename .. ".qmd",
    "ai/deep-learning/" .. basename .. ".qmd",
    "ai/machine-learning/" .. basename .. ".qmd",
    basename .. ".qmd",
  }
  for _, path in ipairs(search_paths) do
    local f = io.open(path, "r")
    if f then
      local content = f:read("*all")
      f:close()
      return content
    end
  end
  return nil
end

local function count_extras_from_source(basename)
  local content = find_source_file(basename)
  if not content then return 0, 0, 0, 0 end

  local questions = 0
  for _ in content:gmatch("{%.callout%-tip") do questions = questions + 1 end

  local figures = 0
  for _ in content:gmatch("<svg") do figures = figures + 1 end

  local code_lines = 0
  local in_code = false
  local is_hidden = false
  local in_collapsed = false  -- code inside collapse="true" callouts is opt-in; do not bill it
  for line in content:gmatch("[^\n]+") do
    if not in_code and line:match('^:::.*collapse="true"') then
      in_collapsed = true
    elseif not in_code and in_collapsed and line:match("^:::%s*$") then
      in_collapsed = false
    end
    if line:match("^```{python}") or line:match("^```{r}") then
      in_code = true; is_hidden = false
    elseif line:match("^```") and in_code then
      in_code = false; is_hidden = false
    elseif in_code then
      if line:match("#|%s*echo:%s*false") then is_hidden = true
      elseif not is_hidden and not in_collapsed then code_lines = code_lines + 1 end
    end
  end
  local code_minutes = math.ceil(code_lines / 4) * 2

  local math_blocks = 0
  for _ in content:gmatch("%$%$[^$]+%$%$") do math_blocks = math_blocks + 1 end
  local worked_examples = 0
  for _ in content:gmatch("%*%*Step %d") do worked_examples = worked_examples + 1 end
  for _ in content:gmatch("%*%*For %$") do worked_examples = worked_examples + 1 end
  for _ in content:gmatch("%*%*Example") do worked_examples = worked_examples + 1 end
  local math_minutes = math_blocks + (worked_examples * 2)

  local interactive = 0
  -- Count interactive tools by looking for the marker comment
  for _ in content:gmatch("<!%-%- interactive%-tool %-%->") do interactive = interactive + 1 end
  local interactive_minutes = interactive * 10

  return questions, figures, code_minutes, math_minutes + interactive_minutes
end

-- ============ JSON read/write for shared reading times ============

local function read_json()
  local f = io.open(READING_TIMES_FILE, "r")
  if not f then return {} end
  local raw = f:read("*all")
  f:close()
  -- Simple JSON parser for flat {key: number} objects
  local data = {}
  for key, val in raw:gmatch('"([^"]+)"%s*:%s*(%d+)') do
    data[key] = tonumber(val)
  end
  return data
end

local function write_json(data)
  local parts = {}
  for k, v in pairs(data) do
    parts[#parts + 1] = string.format('  "%s": %d', k, v)
  end
  table.sort(parts)
  local json = "{\n" .. table.concat(parts, ",\n") .. "\n}\n"
  local f = io.open(READING_TIMES_FILE, "w")
  if f then
    f:write(json)
    f:close()
  end
end

local function save_reading_time(basename, minutes)
  local data = read_json()
  data[basename] = minutes
  write_json(data)
end

-- ============ Progress bar (reads from JSON) ============

local function get_order_from_file(filepath)
  local f = io.open(filepath, "r")
  if not f then return 9999 end
  local content = f:read("*all")
  f:close()
  local order = content:match("order:%s*(%d+)")
  return tonumber(order) or 9999
end

local function compute_progress_bar(current_basename)
  if not current_basename or current_basename == "index" then return nil end

  local data = read_json()
  if not data[current_basename] then return nil end

  -- Scan sibling .qmd files for order info
  local handle = io.popen('find . -maxdepth 1 -name "*.qmd" -not -name "index.qmd" 2>/dev/null')
  if not handle then return nil end
  local result = handle:read("*all")
  handle:close()
  if not result or result == "" then return nil end

  local pages = {}
  for filepath in result:gmatch("[^\n]+") do
    local fname = filepath:match("([^/]+)%.qmd$")
    if fname and data[fname] then
      local order = get_order_from_file(filepath)
      pages[#pages + 1] = { name = fname, order = order, minutes = data[fname] }
    end
  end

  table.sort(pages, function(a, b) return a.order < b.order end)

  local total_minutes = 0
  local cumulative_minutes = 0
  local found = false
  for _, page in ipairs(pages) do
    total_minutes = total_minutes + page.minutes
    if not found then
      cumulative_minutes = cumulative_minutes + page.minutes
      if page.name == current_basename then found = true end
    end
  end

  if not found or total_minutes == 0 then return nil end

  local percentage = math.floor((cumulative_minutes / total_minutes) * 100)

  local html = string.format([[
<div id="section-progress-widget" style="display:none; padding: 0.8em 1em; background: inherit; border-top: 1px solid var(--bs-border-color, #dee2e6); position: sticky; bottom: 0; z-index: 10;">
  <p style="font-size: 0.8em; color: var(--bs-secondary-color, #6c757d); margin: 0 0 0.4em 0; font-weight: 600;">Progress</p>
  <div style="background: var(--bs-secondary-bg, #e9ecef); border-radius: 6px; height: 8px; width: 100%%; overflow: hidden;">
    <div style="background: var(--bs-primary, #2c3e50); height: 100%%; width: %d%%; border-radius: 6px;"></div>
  </div>
  <p style="font-size: 0.75em; color: var(--bs-tertiary-color, #adb5bd); margin: 0.3em 0 0 0;">%d%% completed (%d of %d min)</p>
</div>
<script>
document.addEventListener("DOMContentLoaded", function() {
  var w = document.getElementById("section-progress-widget");
  var sb = document.getElementById("quarto-sidebar");
  if (w && sb) { w.style.display = "block"; sb.appendChild(w); }
});
</script>
]], percentage, percentage, cumulative_minutes, total_minutes)

  return pandoc.RawBlock("html", html)
end

-- ============ Section total for index pages (reads from JSON) ============

local function compute_section_total()
  local handle = io.popen('find . -maxdepth 1 -name "*.qmd" -not -name "index.qmd" 2>/dev/null')
  if not handle then return 0 end
  local result = handle:read("*all")
  handle:close()
  if not result or result == "" then return 0 end

  local data = read_json()
  local total = 0
  for filepath in result:gmatch("[^\n]+") do
    local fname = filepath:match("([^/]+)%.qmd$")
    if fname and data[fname] then
      total = total + data[fname]
    end
  end
  return total
end

-- ============ Main filter ============

function Pandoc(doc)
  local output = PANDOC_STATE and PANDOC_STATE.output_file or ""
  local basename = output:match("([^/\\]+)%.html$")
  local is_index = (basename == "index")

  -- Allow pages to opt out of reading time via front-matter: show-reading-time: false
  if doc.meta["show-reading-time"] ~= nil then
    local rt_meta = doc.meta["show-reading-time"]
    -- Handle both boolean (MetaBool) and string values
    if rt_meta == false then
      return doc
    end
    if type(rt_meta) == "table" or type(rt_meta) == "userdata" then
      local rt_val = pandoc.utils.stringify(rt_meta)
      if rt_val == "false" or rt_val == "False" or rt_val == "no" then
        return doc
      end
    end
  end

  if is_index then
    local total_minutes = compute_section_total()
    if total_minutes > 0 then
      local hours = math.floor(total_minutes / 60)
      local mins = total_minutes % 60
      local time_label
      if hours > 0 and mins > 0 then
        time_label = string.format("~%dh %dmin total", hours, mins)
      elseif hours > 0 then
        time_label = string.format("~%dh total", hours)
      else
        time_label = string.format("~%dmin total", mins)
      end
      local script = pandoc.RawBlock("html", [[
<script>
document.addEventListener("DOMContentLoaded", function () {
  var meta = document.querySelector(".quarto-title-meta");
  if (!meta) {
    var title = document.querySelector("h1.title, .quarto-title > h1");
    if (title) {
      meta = document.createElement("div");
      meta.className = "quarto-title-meta";
      title.parentNode.insertBefore(meta, title.nextSibling);
    }
  }
  if (meta) {
    var div = document.createElement("div");
    div.innerHTML = '<div class="quarto-title-meta-heading">Total Reading Time</div><div class="quarto-title-meta-contents"><p>]] .. time_label .. [[</p></div>';
    meta.appendChild(div);
]] .. published_js(nil) .. [[
  }
});
</script>
]])
      table.insert(doc.blocks, 1, script)
    end
    return doc
  end

  -- Non-index pages: compute reading time from Pandoc AST
  local words = count_words(doc.blocks)
  local word_minutes = math.ceil(words / WPM)
  local questions, figures, code_minutes, other_minutes = count_extras_from_source(basename)

  local extra = 0
  if doc.meta["extra-reading-time"] then
    extra = tonumber(pandoc.utils.stringify(doc.meta["extra-reading-time"])) or 0
  end

  local raw_minutes = word_minutes + questions + figures + code_minutes + other_minutes + extra

  -- Apply difficulty multiplier
  local difficulty = 3 -- default
  if doc.meta["difficulty"] then
    difficulty = tonumber(pandoc.utils.stringify(doc.meta["difficulty"])) or 3
  end
  if difficulty < 1 then difficulty = 1 end
  if difficulty > 5 then difficulty = 5 end

  local multiplier = DIFFICULTY_MULTIPLIERS[difficulty] or 1.0
  local minutes = math.ceil(raw_minutes * multiplier)
  if minutes > MAX_MINUTES then minutes = MAX_MINUTES end

  -- Save to shared JSON (single source of truth)
  -- Only save if we are in a subdirectory (not at project root)
  local cwd = io.popen("pwd"):read("*l") or ""
  if cwd ~= PROJECT_ROOT then
    save_reading_time(basename, minutes)
  end

  -- Build difficulty indicator: filled circles ● and empty circles ○
  local difficulty_html = ""
  if doc.meta["difficulty"] then
    local dots = ""
    for i = 1, 5 do
      if i <= difficulty then
        dots = dots .. '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#333;margin-right:3px;vertical-align:middle;"></span>'
      else
        dots = dots .. '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid #333;margin-right:3px;vertical-align:middle;"></span>'
      end
    end
    difficulty_html = [[
    var diffDiv = document.createElement("div");
    diffDiv.style.order = "4";
    diffDiv.innerHTML = '<div class="quarto-title-meta-heading">Difficulty</div><div class="quarto-title-meta-contents"><p>]] .. dots .. [[</p></div>';
    meta.appendChild(diffDiv);
]]
  end

  -- Word-count label for the Length cell (rounded to the nearest 100 once past 1k)
  local display_words = words
  if words >= 1000 then display_words = math.floor((words + 50) / 100) * 100 end
  local words_label = "~" .. commafy(display_words) .. " words"
  local length_html = [[
    var lenDiv = document.createElement("div");
    lenDiv.style.order = "1";
    lenDiv.innerHTML = '<div class="quarto-title-meta-heading">Length</div><div class="quarto-title-meta-contents"><p>]] .. words_label .. [[</p></div>';
    meta.appendChild(lenDiv);
]]

  -- Inject reading time, length, difficulty and the weekday-stamped date.
  -- Grid order: Length (1) · Published (2) · Reading Time (3) · Difficulty (4).
  local label = "~" .. minutes .. " min read"
  local tooltip = "Estimated based on " .. WPM .. " words/min reading speed, code complexity, math blocks, and interactive tools. Adjusted by difficulty level and capped at 3 hours."
  local script = pandoc.RawBlock("html", [[
<script>
document.addEventListener("DOMContentLoaded", function () {
  var meta = document.querySelector(".quarto-title-meta");
  if (meta) {
    var div = document.createElement("div");
    div.style.order = "3";
    div.innerHTML = '<div class="quarto-title-meta-heading">Reading Time</div><div class="quarto-title-meta-contents"><p>]] .. label .. [[ <span class="rt-info" style="cursor:help;opacity:0.6;font-size:0.85em;position:relative;">ⓘ<span class="rt-tooltip">]] .. tooltip .. [[</span></span></p></div>';
    meta.appendChild(div);
]] .. length_html .. difficulty_html .. published_js("2") .. [[
  }
});
</script>
]])
  table.insert(doc.blocks, 1, script)

  -- Inject progress bar (reads from JSON)
  local progress_bar = compute_progress_bar(basename)
  if progress_bar then
    doc.blocks[#doc.blocks + 1] = progress_bar
  end

  return doc
end
