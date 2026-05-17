#!/bin/bash

# Test script for running analysis across multiple coins and trade types
# Usage: ./test-multiple-scenarios.sh
# Requires: jq (brew install jq)

set -u

API_URL="${API_URL:-http://localhost:3001}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$RESULTS_DIR/multi-scenario-$TIMESTAMP"
SUMMARY_FILE="$RUN_DIR/summary.txt"
SUMMARY_JSON="$RUN_DIR/summary.json"

mkdir -p "$RUN_DIR"

# Verify jq is installed
if ! command -v jq &> /dev/null; then
  echo "ERROR: jq is required. Install with: brew install jq"
  exit 1
fi

coins=("BTC" "ETH" "SOL" "AVAX" "MATIC")
types=("swing" "day" "scalp")

echo "Testing Multiple Coins & Timeframes"
echo "===================================="
echo "API:     $API_URL"
echo "Results: $RUN_DIR"
echo ""

# Health check first
health=$(curl -s --max-time 10 "$API_URL/health")
if [ -z "$health" ]; then
  echo "ERROR: Could not reach $API_URL/health. Is the server running?"
  exit 1
fi
echo "Server health: $(echo "$health" | jq -r '.status')"
echo ""

# Initialize summary files
{
  echo "Multi-Scenario Analysis Run"
  echo "Timestamp: $TIMESTAMP"
  echo "API:       $API_URL"
  echo "===================================="
} > "$SUMMARY_FILE"

echo "[" > "$SUMMARY_JSON"
first=true

for coin in "${coins[@]}"; do
  for type in "${types[@]}"; do
    label="$coin-$type"
    echo "Testing $label..."
    raw_file="$RUN_DIR/$label.json"

    response=$(curl -s --max-time 120 -X POST "$API_URL/analysis/complete" \
      -H "Content-Type: application/json" \
      -d "{\"coin\": \"$coin\", \"tradeType\": \"$type\"}")

    if [ -z "$response" ]; then
      result="ERROR: empty response"
      echo "{\"action\":null,\"score\":null,\"error\":\"empty response\"}" > "$raw_file"
    else
      echo "$response" | jq '.' > "$raw_file" 2>/dev/null || echo "$response" > "$raw_file"

      action=$(echo "$response" | jq -r '.summary.action // .action // "N/A"')
      score=$(echo "$response" | jq -r '.checklist.totalScore // .checklistScore // "N/A"')
      confidence=$(echo "$response" | jq -r '.summary.confidence // .confidence // "N/A"')
      result="$action (score: $score/100, confidence: $confidence)"
    fi

    line="  $label: $result"
    echo "$line"
    echo "$line" >> "$SUMMARY_FILE"

    # Append JSON summary entry
    if [ "$first" = true ]; then
      first=false
    else
      echo "," >> "$SUMMARY_JSON"
    fi
    jq -n \
      --arg coin "$coin" \
      --arg type "$type" \
      --arg action "${action:-}" \
      --arg score "${score:-}" \
      --arg confidence "${confidence:-}" \
      --arg file "$label.json" \
      '{coin: $coin, tradeType: $type, action: $action, score: $score, confidence: $confidence, file: $file}' \
      >> "$SUMMARY_JSON"

    sleep 2  # Avoid rate limits
  done
done

echo "]" >> "$SUMMARY_JSON"

echo ""
echo "===================================="
echo "Done. Results saved to: $RUN_DIR"
echo "Summary (text):  $SUMMARY_FILE"
echo "Summary (JSON):  $SUMMARY_JSON"
