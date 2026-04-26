-- reading-time.lua
-- Counts words and questions, injects reading time into the title block.
-- WPM = 150 for technical/non-native readers.
-- Each review question (callout-tip block in source) adds 1 minute.

local WPM = 150

local function count_words(blocks)
  local text = ""
  for _, block in ipairs(blocks) do
    if block.t == "Para" or block.t == "Plain" or
       block.t == "Header" or block.t == "BlockQuote" then
      text = text .. " " .. pandoc.utils.stringify(block)
    elseif block.t == "BulletList" or block.t == "OrderedList" then
      for _, item in ipairs(block.content) do
        text = text .. " " .. pandoc.utils.stringify(pandoc.Div(item))
      end
    elseif block.t == "Table" then
      text = text .. " " .. pandoc.utils.stringify(block)
    elseif block.t == "Div" then
      text = text .. " " .. count_words(block.content)
    end
  end
  local n = 0
  for _ in text:gmatch("%S+") do n = n + 1 end
  return n
end

local function count_questions_from_source()
  -- Derive source .qmd path from output filename
  local output = PANDOC_STATE and PANDOC_STATE.output_file or ""
  -- output is like "layer-3-technologies.html", source is in networking/ccde-written/
  local basename = output:match("([^/\\]+)%.html$")
  if not basename then return 0 end

  -- Try to find the source file relative to common paths
  local candidates = {
    "networking/ccde-written/" .. basename .. ".qmd",
    basename .. ".qmd",
  }

  for _, path in ipairs(candidates) do
    local f = io.open(path, "r")
    if f then
      local content = f:read("*all")
      f:close()
      local n = 0
      for _ in content:gmatch("{%.callout%-tip") do
        n = n + 1
      end
      return n
    end
  end
  return 0
end

function Pandoc(doc)
  local total = count_words(doc.blocks)
  local questions = count_questions_from_source()
  local minutes = math.ceil(total / WPM) + questions
  local label = "~" .. minutes .. " min read"

  local script = pandoc.RawBlock("html", [[
<script>
document.addEventListener("DOMContentLoaded", function () {
  var meta = document.querySelector(".quarto-title-meta");
  if (meta) {
    var div = document.createElement("div");
    div.innerHTML = '<div class="quarto-title-meta-heading">Reading Time</div><div class="quarto-title-meta-contents"><p>]] .. label .. [[</p></div>';
    meta.appendChild(div);
  }
});
</script>
]])

  table.insert(doc.blocks, 1, script)
  return doc
end
