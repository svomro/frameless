const body = document.querySelector("body");
const dropZone = document.querySelector(".dropzone");
const image = document.querySelector("#image");
const dropZoneSymbol = document.querySelector("#dropzone-symbol");
const dropZoneMessage = document.querySelector("#dropzone-message");
const dropZoneDetail = document.querySelector("#dropzone-detail");
const opacityControl = document.querySelector("#opacity-control");
const opacitySlider = document.querySelector("#opacity-slider");
const opacityValue = document.querySelector("#opacity-value");
let draggedPointerId;
let imageScale = 1;
let lockZoom = 1;
let viewMode;
let contentOpacity = 1;
let pendingFileName = "";

function setContentOpacity(value) {
  contentOpacity = Math.min(1, Math.max(0, value));
  image.style.opacity = contentOpacity;
  if (!dropZone.classList.contains("error")) {
    dropZone.style.opacity = contentOpacity;
  }
  const percent = Math.round(contentOpacity * 100);
  opacitySlider.value = String(percent);
  opacitySlider.style.setProperty("--opacity-percent", `${percent}%`);
  opacityValue.value = `${percent}%`;
}

function showOpacityControl() {
  opacityControl.hidden = false;
}

function hideOpacityControl() {
  opacityControl.hidden = true;
}

opacitySlider.addEventListener("input", () => {
  setContentOpacity(Number(opacitySlider.value) / 100);
});

function showInitialState() {
  dropZone.classList.remove("error");
  dropZoneSymbol.textContent = "+";
  dropZoneMessage.textContent = "Drop an image here!";
  dropZoneDetail.textContent = "";
  dropZoneDetail.hidden = true;
  dropZone.style.opacity = contentOpacity;
  dropZone.style.display = "flex";
}

function showErrorState(fileName) {
  image.style.display = "none";
  resetImageTransform();
  dropZone.classList.remove("hovered");
  dropZone.classList.add("error");
  dropZoneSymbol.textContent = "×";
  dropZoneMessage.textContent = "Can't display this image";
  dropZoneDetail.textContent = fileName || "The file could not be decoded.";
  dropZoneDetail.hidden = false;
  dropZone.style.opacity = 1;
  dropZone.style.display = "flex";
  window.windowControls.unlockAspectRatio();
  viewMode = undefined;
}

setContentOpacity(contentOpacity);

dropZone.addEventListener("dragenter", () => {
  dropZone.classList.add("hovered");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("hovered");
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
});

body.addEventListener("dragover", (event) => {
  event.preventDefault();
});

const onDrop = (event) => {
  event.stopPropagation();
  dropZone.classList.remove("hovered");

  const item = event.dataTransfer.items[0];
  if (!item || item.kind !== "file") return;

  const file = item.getAsFile();
  if (!file) return;

  pendingFileName = file.name;
  if (dropZone.classList.contains("error")) showInitialState();

  const reader = new FileReader();

  reader.addEventListener("load", () => {
    image.src = reader.result;
  });
  reader.addEventListener("error", () => {
    showErrorState(file.name);
    pendingFileName = "";
  });

  reader.readAsDataURL(file);
  event.preventDefault();
};

// "Original size" lays the image out at its own pixel size; every other mode
// lets it stretch to the window and relies on object-fit.
function setImageToNaturalSize(enabled) {
  image.style.width = enabled ? `${image.naturalWidth}px` : "";
  image.style.height = enabled ? `${image.naturalHeight}px` : "";
}

function resetImageTransform() {
  imageScale = 1;
  image.style.transformOrigin = "center";
  image.style.transform = "none";
  setImageToNaturalSize(false);
  window.windowControls.unlockAspectRatio();
  window.scrollTo(0, 0);
}

// Locked mode pins the window to the image's own shape, so dragging an edge
// scales window and image together, and the two stay the same rectangle.
//
// lockZoom is the image's size as a fraction of the window: 1 is the "exact
// fit" resting point, above it the window holds still while the image grows
// past it and scrolls.
function applyLockZoom() {
  const size = `${lockZoom * 100}%`;
  image.style.width = size;
  image.style.height = size;
}

// The largest image-shaped rectangle that fits inside the window right now.
function imageRectInWindow() {
  const scale = Math.min(
    window.innerWidth / image.naturalWidth,
    window.innerHeight / image.naturalHeight
  );
  return [image.naturalWidth * scale, image.naturalHeight * scale];
}

function lockToImage(
  width = image.naturalWidth,
  height = image.naturalHeight
) {
  if (!image.naturalWidth || !image.naturalHeight) return;

  resetImageTransform();
  viewMode = "lock";
  lockZoom = 1;
  // The window carries the image's shape, so cover crops nothing; it only keeps
  // sub-pixel rounding from showing a transparent seam.
  image.style.objectFit = "cover";
  applyLockZoom();
  window.windowControls.lockToImageSize(width, height);
}

// One key back to "image = window": drop any zoom and shrink the window onto
// the image without disturbing the size the window already has.
function exactFit() {
  if (!image.naturalWidth || !image.naturalHeight) return;

  lockToImage(...imageRectInWindow());
}

function zoomLocked(factor) {
  const target = Math.min(10, lockZoom * factor);

  if (target >= 1) {
    // Above the resting point the window holds still and the image grows,
    // staying anchored on whatever the middle of the window is showing.
    const centerX =
      (window.scrollX + window.innerWidth / 2) / image.offsetWidth;
    const centerY =
      (window.scrollY + window.innerHeight / 2) / image.offsetHeight;

    lockZoom = target;
    applyLockZoom();

    window.scrollTo(
      centerX * image.offsetWidth - window.innerWidth / 2,
      centerY * image.offsetHeight - window.innerHeight / 2
    );
    return;
  }

  // Past the resting point there is nothing left to shrink inside the window,
  // so window and image shrink together and stay locked to each other.
  lockZoom = 1;
  applyLockZoom();
  window.windowControls.setContentSize(
    window.innerWidth * target,
    window.innerHeight * target
  );
}

function originalSize() {
  if (!image.naturalWidth || !image.naturalHeight) return;

  resetImageTransform();
  viewMode = "original";
  image.style.objectFit = "contain";
  // The window is capped to the screen, so an image larger than the display
  // stays at 1:1 and scrolls instead of being silently shrunk to fit.
  setImageToNaturalSize(true);
  window.windowControls.setContentSize(image.naturalWidth, image.naturalHeight);
}

function getViewState() {
  return {
    hasImage: image.style.display !== "none" && image.naturalWidth > 0,
    viewMode,
  };
}

// Opening from Finder gives us a filesystem path rather than the File object a
// drop produces. Encoding each path segment keeps spaces, "#" and "?" in a
// filename from truncating the URL. Everything after this is shared with the
// drop path: the load and error listeners below do the rest.
window.imageFiles?.onOpen((filePath) => {
  if (!filePath) return;

  pendingFileName = filePath.split("/").pop();
  if (dropZone.classList.contains("error")) showInitialState();

  image.src = `file://${filePath.split("/").map(encodeURIComponent).join("/")}`;
});

dropZone.addEventListener("drop", onDrop);
body.addEventListener("drop", onDrop);
image.addEventListener("load", () => {
  image.style.display = "block";
  dropZone.style.display = "none";
  pendingFileName = "";

  if (viewMode === "original") originalSize();
  else if (viewMode === "lock") exactFit();
  else lockToImage();
});

image.addEventListener("error", () => {
  showErrorState(pendingFileName);
  pendingFileName = "";
});

body.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey || !image.src) return;

    event.preventDefault();

    if (viewMode === "lock") {
      zoomLocked(Math.exp(-event.deltaY * 0.002));
      return;
    }

    viewMode = undefined;
    imageScale = Math.min(
      10,
      Math.max(0.1, imageScale * Math.exp(-event.deltaY * 0.002))
    );
    image.style.transformOrigin = imageScale > 1 ? "0 0" : "center";
    if (imageScale <= 1) window.scrollTo(0, 0);
    image.style.transform = `scale(${imageScale})`;
  },
  { passive: false }
);

const stopWindowDrag = (event) => {
  if (event.pointerId !== draggedPointerId) return;

  draggedPointerId = undefined;
};

image.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;

  event.preventDefault();
  image.setPointerCapture(event.pointerId);
  draggedPointerId = event.pointerId;
  // Where inside the window the drag started; the main process keeps that spot
  // under the cursor for the rest of the drag, across displays included.
  window.windowControls.startDrag(event.clientX, event.clientY);
});

image.addEventListener("dragstart", (event) => event.preventDefault());

image.addEventListener("pointermove", (event) => {
  if (event.pointerId !== draggedPointerId) return;

  window.windowControls.dragToCursor();
});

image.addEventListener("pointerup", stopWindowDrag);
image.addEventListener("pointercancel", stopWindowDrag);
image.addEventListener("lostpointercapture", stopWindowDrag);

body.addEventListener("pointerdown", (event) => {
  if (!opacityControl.hidden && !opacityControl.contains(event.target)) {
    hideOpacityControl();
  }
});

body.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  if (!opacityControl.hidden) {
    hideOpacityControl();
    return;
  }

  image.style.display = "none";
  image.removeAttribute("src");
  showInitialState();
  window.windowControls.unlockAspectRatio();
  viewMode = undefined;
});
