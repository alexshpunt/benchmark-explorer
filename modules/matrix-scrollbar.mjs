/** Install a normal matrix scroll control, pinned only while its place is below the viewport. */
export function installMatrixScrollbar(root) {
  const slot = document.createElement("div");
  slot.className = "matrix-scrollbar-slot";
  slot.hidden = true;
  root.after(slot);
  const bar = document.createElement("div");
  bar.id = "matrix-scrollbar";
  bar.className = "matrix-scrollbar";
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.step = "1";
  input.setAttribute("aria-label", "Scroll matrix horizontally");
  input.setAttribute("aria-controls", root.id);
  bar.append(input);
  slot.append(bar);

  function updateVisibility() {
    if (slot.hidden) return;
    const place = slot.getBoundingClientRect();
    if (place.top < innerHeight && place.bottom > 0) {
      if (bar.classList.contains("is-pinned")) bar.classList.remove("is-pinned");
      if (bar.hidden) bar.hidden = false;
      return;
    }
    const rect = root.getBoundingClientRect();
    const visibleHeight = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
    const pinned = place.top >= innerHeight && visibleHeight >= 32;
    if (bar.classList.contains("is-pinned") !== pinned) bar.classList.toggle("is-pinned", pinned);
    if (bar.hidden !== !pinned) bar.hidden = !pinned;
  }

  function updateLayout() {
    const maximum = Math.max(0, root.scrollWidth - root.clientWidth);
    root.classList.toggle("has-horizontal-overflow", maximum > 1);
    slot.hidden = maximum <= 1;
    input.max = String(maximum);
    input.value = String(root.scrollLeft);
    if (slot.hidden) return;
    const rect = slot.getBoundingClientRect();
    bar.style.setProperty("--scroll-left", `${rect.left}px`);
    bar.style.setProperty("--scroll-width", `${rect.width}px`);
    bar.style.setProperty("--scroll-thumb-width", `${Math.max(28, (rect.width - 18) * root.clientWidth / root.scrollWidth)}px`);
    updateVisibility();
  }

  let pending = false;
  function refresh() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; updateLayout(); });
  }
  input.addEventListener("input", () => { root.scrollLeft = Number(input.value); });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    root.scrollLeft += event.key === "ArrowRight" ? 40 : -40;
  });
  root.addEventListener("scroll", () => { input.value = String(root.scrollLeft); }, { passive: true });
  window.addEventListener("scroll", updateVisibility, { passive: true });
  window.addEventListener("resize", refresh);
  new ResizeObserver(refresh).observe(root);
  refresh();
  return refresh;
}
