// Shrink a photo in the browser before upload: phone photos are 3-12 MB, the model needs ~1600 px.
export function loadAndResize(file, maxSide = 1600) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL("image/jpeg", 0.9);
      c.toBlob((b) => res({ dataUrl, blob: b, width: c.width, height: c.height,
        file: new File([b], (file.name || "photo").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) }),
      "image/jpeg", 0.9);
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
