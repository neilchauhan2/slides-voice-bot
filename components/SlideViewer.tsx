import type { SlideData } from "@/lib/types";

type SlideViewerProps = {
  slide: SlideData | null;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
};

export function SlideViewer({ slide, index, total, onPrev, onNext }: SlideViewerProps) {
  return (
    <section className="slide-viewer">
      <div className="slide-header">
        <button onClick={onPrev} disabled={index <= 0}>
          Prev
        </button>
        <p>
          Slide {Math.min(index + 1, total)} / {total}
        </p>
        <button onClick={onNext} disabled={index >= total - 1}>
          Next
        </button>
      </div>

      <article className="slide-paper">
        <h2>{slide?.title ?? "No slide selected"}</h2>
        <p>{slide?.textContent || "No text found for this slide."}</p>
      </article>
    </section>
  );
}
