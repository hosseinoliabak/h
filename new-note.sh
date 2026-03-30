#!/bin/bash
# Usage: ./new-note.sh template-name section/filename

TEMPLATE=$1
FILEPATH=$2

if [ -z "$TEMPLATE" ] || [ -z "$FILEPATH" ]; then
    echo "Usage: ./new-note.sh [math|network|research] section/filename"
    echo "Example: ./new-note.sh math math/calculus/derivatives"
    exit 1
fi

TEMPLATE_FILE="_templates/${TEMPLATE}-note.qmd"
OUTPUT_FILE="${FILEPATH}.qmd"

if [ ! -f "$TEMPLATE_FILE" ]; then
    echo "Template $TEMPLATE_FILE not found!"
    exit 1
fi

# Create directory if it doesn't exist
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Copy template
cp "$TEMPLATE_FILE" "$OUTPUT_FILE"

echo "Created $OUTPUT_FILE from $TEMPLATE template"
echo "Edit the file to customize title, categories, and content"