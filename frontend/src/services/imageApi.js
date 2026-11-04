const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

async function readError(response) {
  if (response.status >= 500 && response.status !== 503) {
    return "The image service encountered an error. Check the backend logs for details.";
  }

  const text = await response.text();
  if (!text) return `Request failed with HTTP ${response.status}.`;

  try {
    const payload = JSON.parse(text);
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
      return payload.detail
        .map((item) => item.msg)
        .filter(Boolean)
        .join(" ");
    }
  } catch {
    // Use a safe generic message rather than echoing arbitrary backend output.
  }
  return `Request failed with HTTP ${response.status}.`;
}

async function parseImageResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().startsWith("image/")) {
    return URL.createObjectURL(await response.blob());
  }

  if (contentType.toLowerCase().includes("application/json")) {
    const payload = await response.json();
    const url = payload.image_url || payload.url;
    if (typeof url === "string" && url.trim()) {
      return new URL(url, `${API_BASE_URL}/`).toString();
    }

    const encoded = payload.image_base64 || payload.base64;
    if (typeof encoded === "string" && encoded.trim()) {
      if (encoded.startsWith("data:image/")) return encoded;
      const mimeType = payload.mime_type || "image/png";
      return `data:${mimeType};base64,${encoded}`;
    }
  }

  throw new Error("The backend returned success without a supported image response.");
}

export async function checkApiHealth() {
  const response = await fetch(`${API_BASE_URL}/api/health`);
  if (!response.ok) throw new Error("Health check failed.");
  return response.json();
}

export async function generateImage({ prompt, mode, image, ratio, style, steps, seed }) {
  const formData = new FormData();
  formData.append("prompt", prompt);
  formData.append("ratio", ratio);
  formData.append("style", style);
  formData.append("steps", String(steps));
  if (seed !== "") formData.append("seed", seed);
  if (mode === "image") formData.append("image", image, image.name);

  const response = await fetch(
    `${API_BASE_URL}${mode === "image" ? "/api/edit" : "/api/generate"}`,
    { method: "POST", body: formData },
  );
  if (!response.ok) throw new Error(await readError(response));
  return parseImageResponse(response);
}

export async function downloadImage(url, filename) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not download this image.");
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

export { API_BASE_URL };

async function modelRequest(path, options) {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(await readError(response));
    return await response.json();
  } catch (error) {
    if (error.name === "TimeoutError") throw new Error("The model service timed out. Check the backend connection and retry.");
    if (error instanceof TypeError) throw new Error("Could not connect to the backend. Start or restart FastAPI and retry.");
    throw error;
  }
}

export const getModelStatus = () => modelRequest("/api/models/status");
export const getModelPlan = (mode) => modelRequest(`/api/models/plan?mode=${encodeURIComponent(mode)}`);
export const beginModelReview = (mode) => modelRequest(`/api/models/review?mode=${encodeURIComponent(mode)}`, { method: "POST" });
export const getModelReview = (mode) => modelRequest(`/api/models/review?mode=${encodeURIComponent(mode)}`);
export const startModelDownload = (planId) => modelRequest("/api/models/download", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ plan_id: planId, confirmed: true }),
});
