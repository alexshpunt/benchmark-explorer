/** Install one visible horizontal scroll control that follows the matrix through the viewport. */
export function installMatrixScrollbar(root) {
  const bar = document.createElement("div");
  bar.id = "matrix-scrollbar";
  bar.className = "matrix-scrollbar";
  bar.hidden = true;
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.step = "1";
  input.setAttribute("aria-label", "Scroll matrix horizontally");
  input.setAttribute("aria-controls", root.id);
  bar.append(input);
  document.body.append(bar);

  function update() {
    const rect = root.getBoundingClientRect();
    const maximum = Math.max(0, root.scrollWidth - root.clientWidth);
    const visibleHeight = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
    root.classList.toggle("has-horizontal-overflow", maximum > 1);
    bar.hidden = maximum <= 1 || visibleHeight < 32;
    input.max = String(maximum);
    input.value = String(root.scrollLeft);
    if (bar.hidden) return;
    bar.style.left = `${rect.left + root.clientLeft}px`;
    bar.style.width = `${root.clientWidth}px`;
    bar.style.bottom = `${Math.max(8, innerHeight - rect.bottom + 1)}px`;
    bar.style.setProperty("--scroll-thumb-width", `${Math.max(28, (root.clientWidth - 18) * root.clientWidth / root.scrollWidth)}px`);
  }

  let pending = false;
  function refresh() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; update(); });
  }
  input.addEventListener("input", () => { root.scrollLeft = Number(input.value); });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    root.scrollLeft += event.key === "ArrowRight" ? 40 : -40;
  });
  root.addEventListener("scroll", refresh, { passive: true });
  window.addEventListener("scroll", refresh, { passive: true });
  window.addEventListener("resize", refresh);
  new ResizeObserver(refresh).observe(root);
  refresh();
  return refresh;
}
