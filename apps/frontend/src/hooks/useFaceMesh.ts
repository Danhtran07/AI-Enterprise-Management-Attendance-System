import { useCallback, useEffect, useRef } from "react";
import {
  DrawingUtils,
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

const FACE_LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

interface UseFaceMeshOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  meshCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  enabled?: boolean;
}

export function useFaceMesh({
  videoRef,
  meshCanvasRef,
  enabled = true,
}: UseFaceMeshOptions) {
  const landmarkerRef =
    useRef<FaceLandmarker | null>(null);

  const animationFrameRef =
    useRef<number | null>(null);

  /*
   * Every start/stop creates a new generation.
   * Async MediaPipe initialization from an older
   * generation is never allowed to attach itself.
   */
  const generationRef =
    useRef(0);

  const stopFaceMesh = useCallback(() => {
    generationRef.current += 1;

    if (
      animationFrameRef.current !== null
    ) {
      window.cancelAnimationFrame(
        animationFrameRef.current,
      );

      animationFrameRef.current = null;
    }

    const landmarker =
      landmarkerRef.current;

    landmarkerRef.current = null;

    if (landmarker) {
      try {
        landmarker.close();
      } catch {
        // Ignore cleanup errors.
      }
    }

    const canvas =
      meshCanvasRef.current;

    if (canvas) {
      const context =
        canvas.getContext("2d");

      if (context) {
        context.clearRect(
          0,
          0,
          canvas.width,
          canvas.height,
        );
      }
    }
  }, [meshCanvasRef]);

  const startFaceMesh =
    useCallback(async () => {
      const video =
        videoRef.current;

      const canvas =
        meshCanvasRef.current;

      if (!video || !canvas) {
        return;
      }

      /*
       * Invalidate the previous generation first.
       */
      const generation =
        ++generationRef.current;

      const previousLandmarker =
        landmarkerRef.current;

      landmarkerRef.current = null;

      if (previousLandmarker) {
        try {
          previousLandmarker.close();
        } catch {
          // Ignore cleanup errors.
        }
      }

      if (
        animationFrameRef.current !== null
      ) {
        window.cancelAnimationFrame(
          animationFrameRef.current,
        );

        animationFrameRef.current = null;
      }

      try {
        const vision =
          await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm",
          );

        if (
          generation !==
          generationRef.current
        ) {
          return;
        }

        const landmarker =
          await FaceLandmarker.createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath:
                  FACE_LANDMARKER_MODEL,
                delegate: "GPU",
              },
              runningMode: "VIDEO",
              numFaces: 1,
            },
          );

        if (
          generation !==
          generationRef.current
        ) {
          try {
            landmarker.close();
          } catch {
            // Ignore cleanup errors.
          }

          return;
        }

        landmarkerRef.current =
          landmarker;

        const context =
          canvas.getContext("2d");

        if (!context) {
          landmarkerRef.current =
            null;

          try {
            landmarker.close();
          } catch {
            // Ignore cleanup errors.
          }

          return;
        }

        const drawingUtils =
          new DrawingUtils(context);

        const drawMesh = () => {
          if (
            generation !==
            generationRef.current
          ) {
            return;
          }

          if (
            landmarkerRef.current !==
            landmarker
          ) {
            return;
          }

          if (
            video.videoWidth <= 0 ||
            video.videoHeight <= 0
          ) {
            animationFrameRef.current =
              window.requestAnimationFrame(
                drawMesh,
              );

            return;
          }

          canvas.width =
            video.videoWidth;

          canvas.height =
            video.videoHeight;

          context.clearRect(
            0,
            0,
            canvas.width,
            canvas.height,
          );

          let result:
            | FaceLandmarkerResult
            | null = null;

          try {
            result =
              landmarker.detectForVideo(
                video,
                performance.now(),
              );
          } catch {
            /*
             * The camera/landmarker may have been
             * closed while detection was running.
             */
            if (
              generation !==
              generationRef.current
            ) {
              return;
            }

            animationFrameRef.current =
              window.requestAnimationFrame(
                drawMesh,
              );

            return;
          }

          for (
            const landmarks of
              result.faceLandmarks
          ) {
            drawingUtils.drawConnectors(
              landmarks,
              FaceLandmarker.FACE_LANDMARKS_TESSELATION,
              {
                color:
                  "rgba(125, 211, 252, 0.72)",
                lineWidth: 1,
              },
            );

            drawingUtils.drawLandmarks(
              landmarks,
              {
                color:
                  "rgba(255, 255, 255, 0.85)",
                radius: 1,
              },
            );

            context.fillStyle =
              "#67e8f9";

            for (
              const landmark of
                landmarks
            ) {
              context.beginPath();

              context.arc(
                landmark.x *
                  canvas.width,
                landmark.y *
                  canvas.height,
                2,
                0,
                Math.PI * 2,
              );

              context.fill();
            }
          }

          if (
            generation ===
              generationRef.current &&
            landmarkerRef.current ===
              landmarker
          ) {
            animationFrameRef.current =
              window.requestAnimationFrame(
                drawMesh,
              );
          }
        };

        drawMesh();
      } catch (error) {
        if (
          generation !==
          generationRef.current
        ) {
          return;
        }

        console.error(
          "Face mesh initialization failed:",
          error,
        );
      }
    }, [videoRef, meshCanvasRef]);

  useEffect(() => {
    if (!enabled) {
      stopFaceMesh();
      return;
    }

    void startFaceMesh();

    return () => {
      stopFaceMesh();
    };
  }, [
    enabled,
    startFaceMesh,
    stopFaceMesh,
  ]);

  return {
    startFaceMesh,
    stopFaceMesh,
  };
}
