#!/bin/bash

# Script to download B1 rarity icons from solforgefusion.com
# Format: https://solforgefusion.com/images/cards/rarity/b1_{rarity}.png
# Save as: B1_{rarity}.png (uppercase B)

BASE_URL="https://solforgefusion.com/images/cards/rarity"
OUTPUT_DIR="/opt/sff_cursor/public/images/icons/rarity"

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# List of rarities (same as other sets)
RARITIES=("Common" "Rare" "CommonRare" "RareCommon" "CommonCommon" "RareRare" "Darkforge" "LS" "Solbind")

echo "Downloading B1 rarity icons from $BASE_URL..."
echo ""

for rarity in "${RARITIES[@]}"; do
    url="${BASE_URL}/b1_${rarity}.png"
    output_file="${OUTPUT_DIR}/B1_${rarity}.png"
    
    echo "Downloading: $url"
    if curl -f -s -o "$output_file" "$url"; then
        file_size=$(stat -f%z "$output_file" 2>/dev/null || stat -c%s "$output_file" 2>/dev/null || echo "unknown")
        echo "  ✓ Saved to: $output_file (size: $file_size bytes)"
    else
        echo "  ✗ Failed to download b1_${rarity}.png"
    fi
    echo ""
done

echo "Download complete. Checking files..."
ls -lh "${OUTPUT_DIR}/B1_"*.png 2>/dev/null | wc -l | xargs echo "Total B1 icons downloaded:"
