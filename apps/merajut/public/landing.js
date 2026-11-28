// Smooth scrolling for the storefront landing page (Lenis is served from /assets/vendor/lenis).
// Lenis keeps the native scroll position, so the navbar reveal in forms.js keeps working.
if (window.Lenis) {
  const lenis = new Lenis({
    autoRaf: true,
    anchors: { offset: -88 } // clears the pinned navbar when jumping to #services or #cara-kerja
  });
  window.lenis = lenis;
}

// Parallax for the background threads: each strand lags the scroll by its own amount, so fainter (farther) strands drift more.
// A strand rests at its drawn position when it reaches mid-screen (strands near the top rest at scroll 0, keeping the top thread under the navbar).
const threads = document.querySelector('.thread-layer');
if (threads && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const paths = [...threads.querySelectorAll('path')];
  let strands = [];
  const measure = () => {
    const scale = threads.getBoundingClientRect().height / threads.viewBox.baseVal.height; // px per SVG unit, vertically
    strands = paths.map(path => {
      const box = path.getBBox();
      const centre = (box.y + box.height / 2) * scale;
      return { path, scale, speed: Number(path.dataset.depth ?? 0.15), rest: Math.max(0, centre - innerHeight / 2) };
    });
    update();
  };
  const update = () => {
    for (const s of strands) s.path.style.transform = `translate(0, ${((scrollY - s.rest) * s.speed / s.scale).toFixed(2)}px)`;
  };
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', measure);
  addEventListener('load', measure);
  measure();
}
