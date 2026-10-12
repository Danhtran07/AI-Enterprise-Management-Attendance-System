#!/bin/bash
set -e

echo "=== Face Biometrics API — Model Download ==="
echo ""

cd "$(dirname "$0")/backend"

# MediaPipe FaceLandmarker
if [ -f "face_landmarker.task" ]; then
    echo "✓ face_landmarker.task already exists, skipping"
else
    echo "Downloading MediaPipe FaceLandmarker (~30 MB)..."
    curl -fL --progress-bar -o face_landmarker.task \
        https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
    echo "✓ face_landmarker.task downloaded"
fi

echo ""
echo "Pre-downloading InsightFace buffalo_l (~275 MB) from GitHub Releases..."
MODEL_DIR="$HOME/.insightface/models/buffalo_l"
mkdir -p "$MODEL_DIR"
if [ -f "$MODEL_DIR/w600k_r50.onnx" ]; then
    echo "✓ buffalo_l already cached"
else
    curl -fL --progress-bar -o /tmp/buffalo_l.zip \
      https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip
    python3 -c "import zipfile; zipfile.ZipFile('/tmp/buffalo_l.zip').extractall('$MODEL_DIR')"
    rm -f /tmp/buffalo_l.zip
    echo "✓ InsightFace buffalo_l ready"
fi

echo ""
echo "All models ready. Run the API with:"
echo "  cd backend && uvicorn main:app --port 8000 --reload"
echo ""
echo "Or with Docker:"
echo "  docker compose up"
