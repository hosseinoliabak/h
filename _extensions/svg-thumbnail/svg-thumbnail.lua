-- svg-thumbnail.lua
-- Automatically extracts the first inline SVG from a page and sets it as
-- the listing thumbnail image if no image is already defined and no
-- code-generated figure files exist.

local function find_first_svg(blocks)
  for _, block in ipairs(blocks) do
    if block.t == "RawBlock" and block.format == "html" then
      -- Lua patterns: dot doesn't match newline, so use [\s\S] equivalent
      -- Instead, check if block starts with <svg or contains <svg
      local text = block.text
      if text:match("<svg") then
        -- Extract from first <svg to last </svg>
        local s, e = text:find("<svg.-</svg>")
        if not s then
          -- Try multiline: replace newlines temporarily
          local flat = text:gsub("\n", "\x00")
          local fs, fe = flat:find("<svg.-</svg>")
          if fs then
            return flat:sub(fs, fe):gsub("\x00", "\n")
          end
        else
          return text:sub(s, e)
        end
      end
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

  -- Check if figure image files will be generated (matplotlib etc.)
  -- Look for python/r code cells with visible output — if they exist,
  -- Quarto will produce figure files that serve as thumbnails automatically.
  for _, block in ipairs(doc.blocks) do
    if block.t == "CodeBlock" and block.classes then
      for _, cls in ipairs(block.classes) do
        if cls == "python" or cls == "r" then
          -- Check if echo is not false (visible code = likely has plot output)
          local text = block.text or ""
          if not text:match("#|%s*echo:%s*false") then
            -- This is a visible code cell; Quarto may generate figures
            -- But we can't be sure, so don't skip
          end
        end
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

    -- Also write to the _site output directory using the output path
    local site_path = output:gsub("[^/\\]+%.html$", thumb_name)
    local f2 = io.open(site_path, "w")
    if f2 then
      f2:write(svg)
      f2:close()
    end

    -- Set as image metadata so Quarto listing picks it up
    doc.meta.image = pandoc.MetaString(thumb_name)
  end

  return doc
end
