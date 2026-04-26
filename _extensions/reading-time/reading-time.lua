-- reading-time.lua
-- Counts words and injects reading time into the title block metadata area.
-- WPM = 150 for technical/non-native readers.

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

function Pandoc(doc)
  local total = count_words(doc.blocks)
  local minutes = math.ceil(total / WPM)
  local label = "~" .. minutes .. " min read"

  -- Inject into the title block via a script that runs after DOM is ready
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
