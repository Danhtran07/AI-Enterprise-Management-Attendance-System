import type { RefObject } from "react";

interface CameraPreviewProps {
  videoRef: RefObject<HTMLVideoElement>;
  meshCanvasRef: RefObject<HTMLCanvasElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
}

export default function CameraPreview({
  videoRef,
  meshCanvasRef,
  canvasRef,
}: CameraPreviewProps) {
  return (
    <>
      <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-950">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="relative z-0 h-full w-full scale-x-[-1] object-cover"
        />

        <canvas
          ref={meshCanvasRef}
          className="pointer-events-none absolute inset-0 z-10 h-full w-full scale-x-[-1]"
        />

        <div className="pointer-events-none absolute inset-[12%_35%] rounded-[50%] border-2 border-blue-300 shadow-[0_0_0_999px_rgba(15,23,42,0.3)]" />

        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-md bg-slate-950/75 px-4 py-2 text-center text-xs font-medium text-white">
          Đưa khuôn mặt vào giữa khung
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </>
  );
}