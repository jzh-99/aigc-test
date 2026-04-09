#!/bin/bash
set -e

# File to patch
FILE="apps/web/src/components/generation/generation-panel.tsx"

# 1. Update VIDEO_MODEL_OPTIONS
sed -i 's/const VIDEO_MODEL_OPTIONS = {/const VIDEO_MODEL_OPTIONS = {\n  multimodal: [\n    { value: '\''seedance-2.0'\'', label: '\''Seedance 2.0'\'', desc: '\''高级有声视频生成，支持多模态'\'', credits: 5, isSeedance: true },\n    { value: '\''seedance-2.0-fast'\'', label: '\''Seedance 2.0 Fast'\'', desc: '\''快速有声视频生成，支持多模态'\'', credits: 5, isSeedance: true },\n  ],/' "$FILE"

sed -i 's/{ value: '\''seedance-1.5-pro'\'', label: '\''Seedance 1.5 Pro'\'', desc: '\''有声视频生成，支持首尾帧'\'', credits: 100, isSeedance: true }/{ value: '\''seedance-1.5-pro'\'', label: '\''Seedance 1.5 Pro'\'', desc: '\''有声视频生成，支持首尾帧'\'', credits: 5, isSeedance: true }/g' "$FILE"

# 2. Update SEEDANCE_DURATION_OPTIONS
sed -i 's/const SEEDANCE_DURATION_OPTIONS = \[/const SEEDANCE_DURATION_OPTIONS = [\n  { value: 4, label: '\''4s'\'' },\n  { value: 5, label: '\''5s'\'' },\n  { value: 6, label: '\''6s'\'' },\n  { value: 7, label: '\''7s'\'' },\n  { value: 8, label: '\''8s'\'' },\n  { value: 9, label: '\''9s'\'' },\n  { value: 10, label: '\''10s'\'' },\n  { value: 11, label: '\''11s'\'' },\n  { value: 12, label: '\''12s'\'' },\n  { value: 13, label: '\''13s'\'' },\n  { value: 14, label: '\''14s'\'' },\n  { value: 15, label: '\''15s'\'' },/' "$FILE"

# Remove the old options up to { value: -1
sed -i '/{ value: 4, label: .4s. }/{:a;N;/.*{ value: -1/!ba;s/.*{ value: -1/  { value: -1/}' "$FILE"

# 3. Update isSeedance checks
sed -i 's/const isSeedanceVideo = videoModel === '\''seedance-1.5-pro'\''/const isSeedanceVideo = videoModel.startsWith('\''seedance-'\'')/g' "$FILE"
sed -i 's/const isSeedance = videoModel === '\''seedance-1.5-pro'\''/const isSeedance = videoModel.startsWith('\''seedance-'\'')/g' "$FILE"

# 4. Update credits calculation
sed -i 's/(videoDuration === -1 ? 12 : videoDuration) \* 100/(videoDuration === -1 ? 15 : videoDuration) * (VIDEO_MODEL_OPTIONS[videoMode as keyof typeof VIDEO_MODEL_OPTIONS]?.find((m: any) => m.value === videoModel)?.credits ?? 5)/g' "$FILE"

echo "Patch applied successfully!"
