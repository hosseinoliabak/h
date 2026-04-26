-- reading-time.lua
-- Counts words in the document and inserts estimated reading time.
-- WPM is set to 150 for technical/non-native readers.

local WPM = 150

local function count_words_in_blocks(blocks)
  local count = 0
  local function walk(el)
    if el.t == "Str" then
      count = count + 1
    end
  end
  for _, block in ipairs(blocks) do
    pandoc.walk_block(block, { Str = walk })
  end
  return count
end

function Pandoc(doc)
  local total_words = count_words_in_blocks(doc.blocks)
  local minutes = math.ceil(total_words / WPM)
  local label

  if minutes < 2 then
    label = "~1 min read"
  else
    label = "~" .. minutes .. " min read"
  end

  local rt_inlines = {
    pandoc.RawInline("html",
      '<span style="font-size:0.85em; color:#888; font-style:italic;">&#128337; ' .. label .. '</span>'
    )
  }

  local rt_para = pandoc.Para(rt_inlines)

  -- Insert after the first Para block in the document
  local inserted = false
  local new_blocks = {}
  for _, block in ipairs(doc.blocks) do
    table.insert(new_blocks, block)
    if not inserted and block.t == "Para" then
      table.insert(new_blocks, rt_para)
      inserted = true
    end
  end

  doc.blocks = new_blocks
  return doc
end
