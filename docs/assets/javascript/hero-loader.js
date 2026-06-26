// Homepage hero loader.
//
// Loaded site-wide as a small module, but the heavy WebGL bundle (three.js +
// hero.js) is only fetched when the page actually contains `#attractor` (the
// homepage). We hook Material's `document$` observable so the hero is built on
// entering the homepage and torn down on leaving — this keeps it working under
// instant navigation (navigation.instant) instead of only on a full reload.

let teardown = null;

function measureHeader() {
  const header = document.querySelector(".md-header");
  if (header) {
    document.documentElement.style.setProperty(
      "--wsio-header-h",
      header.offsetHeight + "px",
    );
  }
}

function onPage() {
  const root = document.getElementById("attractor");
  document.body.classList.toggle("wsio-home", !!root);

  if (root) {
    measureHeader();
    if (!root.dataset.heroReady) {
      root.dataset.heroReady = "1";
      import(new URL("./hero.js", import.meta.url))
        .then((mod) => {
          // Guard against a fast navigate-away while three.js was loading.
          if (document.body.contains(root)) {
            teardown = mod.buildHero(root);
          }
        })
        .catch((err) => console.error("[wsio hero] failed to load", err));
    }
  } else if (teardown) {
    teardown();
    teardown = null;
  }
}

if (window.document$ && typeof window.document$.subscribe === "function") {
  window.document$.subscribe(onPage);
} else {
  document.addEventListener("DOMContentLoaded", onPage);
}

window.addEventListener("resize", measureHeader);
