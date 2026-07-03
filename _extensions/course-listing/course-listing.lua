-- course-listing.lua
-- Quarto shortcode that generates a bullet list of linked pages from a subdirectory.
-- Usage: {{< course-listing linear-algebra >}}
-- It reads .qmd files in the given subdirectory (relative to the calling file),
-- extracts title and order from YAML front matter, sorts by order, and renders
-- a markdown bullet list with hyperlinks.

local function trim(s)
  return s:match("^%s*(.-)%s*$")
end

-- Parse YAML front matter from a file to extract title and order
local function parse_front_matter(filepath)
  local f = io.open(filepath, "r")
  if not f then return nil end

  local line = f:read("l")
  if not line or not line:match("^%-%-%-") then
    f:close()
    return nil
  end

  local title = nil
  local order = 9999

  for l in f:lines() do
    if l:match("^%-%-%-") then
      break
    end
    local t = l:match('^title:%s*["\'](.-)["\'%s]*$')
    if not t then
      t = l:match("^title:%s*(.+)$")
    end
    if t then
      title = trim(t)
    end
    local o = l:match("^order:%s*(%d+)")
    if o then
      order = tonumber(o)
    end
  end

  f:close()
  if title then
    return { title = title, order = order }
  end
  return nil
end

-- Get list of .qmd files in a directory (excluding index.qmd)
local function list_qmd_files(dir)
  local files = {}
  local handle = io.popen('ls "' .. dir .. '"/*.qmd 2>/dev/null')
  if handle then
    for filepath in handle:lines() do
      local basename = filepath:match("([^/]+)$")
      if basename and basename ~= "index.qmd" then
        table.insert(files, { path = filepath, basename = basename })
      end
    end
    handle:close()
  end
  return files
end

return {
  ["course-listing"] = function(args, kwargs, meta)
    -- The first argument is the subdirectory name
    local subdir = pandoc.utils.stringify(args[1])
    if not subdir or subdir == "" then
      return pandoc.Null()
    end

    -- Resolve the directory relative to the current input file
    local input_file = quarto.doc.input_file
    local input_dir = input_file:match("(.*/)")
    local target_dir = input_dir .. subdir

    -- Get all .qmd files
    local qmd_files = list_qmd_files(target_dir)

    -- Parse front matter from each file
    local pages = {}
    for _, file in ipairs(qmd_files) do
      local meta_info = parse_front_matter(file.path)
      if meta_info then
        table.insert(pages, {
          title = meta_info.title,
          order = meta_info.order,
          filename = file.basename
        })
      end
    end

    -- Sort by order field
    table.sort(pages, function(a, b)
      if a.order == b.order then
        return a.title < b.title
      end
      return a.order < b.order
    end)

    -- Build markdown bullet list
    local items = {}
    for _, page in ipairs(pages) do
      local link = subdir .. "/" .. page.filename
      table.insert(items, pandoc.Plain({
        pandoc.Link(page.title, link)
      }))
    end

    -- Return as a BulletList
    if #items > 0 then
      return pandoc.BulletList(items)
    else
      return pandoc.Null()
    end
  end
}
