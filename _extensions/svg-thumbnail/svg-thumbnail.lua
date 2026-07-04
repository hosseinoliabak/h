-- svg-thumbnail.lua
-- Automatically extracts the first inline SVG from a page and sets it as
-- the listing thumbnail image if no image is already defined and no
-- code-generated figures exist.

local function find_first_svg(blocks)
  for _, block in ipairs(blocks) do
    if block.t == "RawBlock" and block.format == "html" then
      local svg = block.text:match("(<svg[^>]*>.-</svg>)")
      if svg then return svg end
    elseif block.t == "Div" then
      local result = find_first_svg(block.content)
      if result then return result end
    end
  end
  return nil
end

function Pandoc(doc)
  -- Skip if image is already set in front-matter
  if doc.meta.image then return doc end

  -- Skip index pages
  local output = PANDOC_STATE and PANDOC_STATE.output_file or ""
  local basename = output:match("([^/\\]+)%.html$")
  if not basename or basename == "index" then return doc end

  -- Check if there are code cells that produce figures (matplotlib etc.)
  -- If so, Quarto will auto-generate a thumbnail — skip
  for _, block in ipairs(doc.blocks) do
    if block.t == "Div" and block.classes then
      for _, cls in ipairs(block.classes) do
        if cls == "cell-output-display" then return doc end
      end
    end
  end

  -- Find the first inline SVG
  local svg = find_first_svg(doc.blocks)
  if not svg then return doc end

  -- Write SVG to a file next to the source
  local thumb_name = basename .. "-thumb.svg"
  local f = io.open(thumb_name, "w")
  if f then
    f:write(svg)
    f:close()
    -- Set as image metadata so Quarto listing picks it up
    doc.meta.image = pandoc.MetaString(thumb_name)
  end

  return doc
end
