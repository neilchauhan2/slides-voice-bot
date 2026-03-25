import type { SlideData } from "@/lib/types";

type SlideStripProps = {
  slides: SlideData[];
  currentIndex: number;
  onSelect: (index: number) => void;
};

export function SlideStrip({ slides, currentIndex, onSelect }: SlideStripProps) {
  return (
    <div className="slide-strip">
      {slides.map((slide) => (
        <button
          key={slide.index}
          className={slide.index === currentIndex ? "is-active" : ""}
          onClick={() => onSelect(slide.index)}
        >
          <strong>{slide.index + 1}</strong>
          <span>{slide.title}</span>
        </button>
      ))}
    </div>
  );
}
