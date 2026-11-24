// Smooth scrolling for the storefront landing page (Lenis is served from /assets/vendor/lenis).
// Lenis keeps the native scroll position, so the navbar reveal in forms.js keeps working.
if (window.Lenis) {
  const lenis = new Lenis({
    autoRaf: true,
    anchors: { offset: -88 } // clears the pinned navbar when jumping to #services or #cara-kerja
  });
  window.lenis = lenis;
}
