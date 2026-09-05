// Read alpha bounds to normalize CSS layout, without modifying source artwork.
const boundsCache = new Map();
export function bounds(image) {
  if (boundsCache.has(image.src)) return boundsCache.get(image.src);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = canvas.width,
    y0 = canvas.height,
    x1 = 0,
    y1 = 0;
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++)
      if (data[(y * canvas.width + x) * 4 + 3] > 24) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  const b = {
    x: x0,
    y: y0,
    w: Math.max(1, x1 - x0 + 1),
    h: Math.max(1, y1 - y0 + 1),
  };
  boundsCache.set(image.src, b);
  return b;
}
export function normalizeSprites(root = document) {
  root
    .querySelectorAll(".artbox img:not([data-normalized])")
    .forEach((image) => {
      image.dataset.normalized = "pending";
      const layout = () => {
        try {
          const b = bounds(image),
            host = image.parentElement;
          const max = host.closest(".miniatures")
            ? 38
            : host.closest(".editorhero")
              ? 83
              : host.closest(".entryrow")
                ? 46
                : 54;
          const scale = Math.min(max / b.w, max / b.h);
          const crop = document.createElement("span");
          crop.className = "sprite-crop";
          crop.style.width = `${b.w * scale}px`;
          crop.style.height = `${b.h * scale}px`;
          image.style.cssText = `position:absolute;max-width:none;max-height:none;width:${image.naturalWidth * scale}px;height:${image.naturalHeight * scale}px;left:${-b.x * scale}px;top:${-b.y * scale}px`;
          image.replaceWith(crop);
          crop.append(image);
          image.dataset.normalized = "done";
        } catch {
          image.dataset.normalized = "fallback";
        }
      };
      if (image.complete && image.naturalWidth) layout();
      else image.addEventListener("load", layout, { once: true });
      image.addEventListener(
        "error",
        () => {
          const text = document.createElement("span");
          text.className = "noart";
          text.textContent = image.alt;
          image.replaceWith(text);
        },
        { once: true },
      );
    });
}
