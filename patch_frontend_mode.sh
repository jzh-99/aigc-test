#!/bin/bash
set -e

FILE="apps/web/src/components/generation/generation-panel.tsx"

# Update buttons
sed -i '/<button/!b;:a;N;/首尾帧/!ba;s/<button/&/' "$FILE"

# Make "multimodal" the default option for videoModel state
sed -i 's/const \[videoModel, setVideoModel\] = useState('\''veo3.1-fast'\'')/const [videoModel, setVideoModel] = useState('\''seedance-2.0'\'')/g' "$FILE"

