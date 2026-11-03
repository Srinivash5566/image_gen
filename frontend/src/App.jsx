import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_BASE_URL = "http://127.0.0.1:8000";

const examples = [
  {
    title: "Quiet morning",
    prompt:
      "A quiet Japanese garden at dawn, soft mist, pale pink blossoms, cinematic natural light",
    tone: "sage",
  },
  {
    title: "After hours",
    prompt:
      "A rain-soaked Tokyo street at midnight, glowing signs reflected in the pavement, cinematic 35mm film",
    tone: "rose",
  },
  {
    title: "New worlds",
    prompt:
      "A tiny glass observatory on a distant moon, rings of Saturn on the horizon, dreamy science fiction illustration",
    tone: "blue",
  },
];

const ratios = [
  { value: "1:1", label: "Square" },
  { value: "3:2", label: "Landscape" },
  { value: "2:3", label: "Portrait" },
  { value: "16:9", label: "Wide" },
];

const styles = [
  "None",
  "Photorealistic",
  "Cinematic",
  "Anime",
  "3D Render",
  "Digital Art",
];

const navigation = [
  { id: "generate", label: "Generate", icon: "sparkles" },
  { id: "image", label: "Image to Image", icon: "image" },
  { id: "gallery", label: "Gallery", icon: "gallery" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function Icon({ name, size = 18 }) {
  const paths = {
    sparkles: (
      <>
        <path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" />
        <path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </>
    ),
    gallery: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.8-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m0 0L7 9m5-5 5 5" />
        <path d="M4 16v4h16v-4" />
      </>
    ),
    close: (
      <>
        <path d="m18 6-12 12M6 6l12 12" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14m-6-6 6 6-6 6" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

async function getResponseError(response) {
  const body = await response.text();
  if (body) {
    try {
      const payload = JSON.parse(body);
      if (typeof payload.detail === "string") return payload.detail;
      if (Array.isArray(payload.detail)) {
        return payload.detail
          .map((item) => item.msg)
          .filter(Boolean)
          .join(" ");
      }
      return JSON.stringify(payload);
    } catch {
      return body;
    }
  }
  return `Request failed with HTTP ${response.status}.`;
}

export default function App() {
  const [page, setPage] = useState("generate");
  const [mode, setMode] = useState("text");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("1:1");
  const [style, setStyle] = useState("None");
  const [advanced, setAdvanced] = useState(false);
  const [steps, setSteps] = useState(8);
  const [seed, setSeed] = useState("");
  const [sourceFile, setSourceFile] = useState(null);
  const [sourcePreview, setSourcePreview] = useState("");
  const [generatedImages, setGeneratedImages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [backendState, setBackendState] = useState("checking");
  const generatedUrls = useRef(new Set());
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("");
  const [statusIsError, setStatusIsError] = useState(false);

  useEffect(() => {
    return () => {
      if (sourcePreview) URL.revokeObjectURL(sourcePreview);
    };
  }, [sourcePreview]);

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE_URL}/api/health`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Health check failed.");
        const health = await response.json();
        if (active)
          setBackendState(health.model_loaded ? "ready" : "unavailable");
      })
      .catch(() => {
        if (active) setBackendState("offline");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      generatedUrls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  function choosePage(destination) {
    setPage(destination === "image" ? "generate" : destination);
    if (destination === "image") setMode("image");
    if (destination === "generate") setMode("text");
    setErrors({});
    setStatus("");
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    setErrors((current) => ({ ...current, image: "" }));
    setStatus("");
    if (!file) return;

    const supportedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!supportedTypes.includes(file.type)) {
      setSourceFile(null);
      setSourcePreview("");
      setErrors((current) => ({
        ...current,
        image: "Choose a PNG, JPEG, or WebP image.",
      }));
      event.target.value = "";
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setSourceFile(null);
      setSourcePreview("");
      setErrors((current) => ({
        ...current,
        image: "That file is over the 15 MB limit.",
      }));
      event.target.value = "";
      return;
    }

    setSourcePreview(URL.createObjectURL(file));
    setSourceFile(file);
    event.target.value = "";
  }

  function handleGenerate(event) {
    event.preventDefault();
    const nextErrors = {};
    if (!prompt.trim()) nextErrors.prompt = "Add a prompt before continuing.";
    if (mode === "image" && !sourceFile)
      nextErrors.image = "Choose a source image for Image to Image.";
    setErrors(nextErrors);
    setStatus("");
    setStatusIsError(false);
    if (Object.keys(nextErrors).length > 0) return;

    const formData = new FormData();
    formData.append("prompt", prompt.trim());
    if (mode === "image") formData.append("image", sourceFile, sourceFile.name);

    setIsGenerating(true);
    fetch(
      `${API_BASE_URL}${mode === "image" ? "/api/edit" : "/api/generate"}`,
      {
        method: "POST",
        body: formData,
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(await getResponseError(response));
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().startsWith("image/")) {
          throw new Error(
            "The backend returned success without an image response. Its successful response format is not implemented yet.",
          );
        }

        const imageUrl = URL.createObjectURL(await response.blob());
        generatedUrls.current.add(imageUrl);
        setGeneratedImages((current) => [
          { url: imageUrl, prompt: prompt.trim(), mode },
          ...current,
        ]);
        setStatus("Image received from the local backend.");
      })
      .catch((error) => {
        setStatus(
          error instanceof TypeError
            ? `Could not connect to ${API_BASE_URL}. Start the FastAPI backend and try again.`
            : error.message,
        );
        setStatusIsError(true);
      })
      .finally(() => setIsGenerating(false));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#home"
          onClick={() => choosePage("generate")}
        >
          <span className="brand-icon">
            <Icon name="sparkles" size={21} />
          </span>
          <span>
            <strong>Qwen</strong>
            <small>Image Studio</small>
          </span>
        </a>

        <nav className="navigation" aria-label="Main navigation">
          {navigation.map((item) => {
            const active =
              item.id === "image"
                ? page === "generate" && mode === "image"
                : page === item.id;
            return (
              <button
                className={`nav-item${active ? " active" : ""}`}
                type="button"
                key={item.id}
                aria-current={active ? "page" : undefined}
                onClick={() => choosePage(item.id)}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" />
          <span>Private workspace</span>
        </div>
      </aside>

      {page === "generate" && (
        <>
          <main className="workspace" id="home">
            <header className="workspace-header">
              <div>
                <span className="eyebrow">THE CREATIVE WORKSPACE</span>
                <h1>
                  Make room for <em>the unexpected.</em>
                </h1>
                <p>Shape a thought into a visual direction.</p>
              </div>
              <span className="workspace-index">
                01 <i /> STUDIO
              </span>
            </header>

            <section className="examples" aria-labelledby="examples-title">
              <div className="section-kicker">
                <span id="examples-title">A starting point</span>
                <span>SELECT A PROMPT</span>
              </div>
              <div className="example-list">
                {examples.map((example, index) => (
                  <button
                    className={`example example-${example.tone}`}
                    key={example.title}
                    type="button"
                    onClick={() => {
                      setPrompt(example.prompt);
                      setErrors((current) => ({ ...current, prompt: "" }));
                      setStatus("");
                    }}
                  >
                    <span className="example-number">0{index + 1}</span>
                    <span className="example-copy">
                      <strong>{example.title}</strong>
                      <small>{example.prompt}</small>
                    </span>
                    <Icon name="arrow" size={16} />
                  </button>
                ))}
              </div>
            </section>

            <section
              className={`preview${sourcePreview && mode === "image" ? " has-image" : ""}`}
              aria-label="Image preview canvas"
            >
              {generatedImages[0]?.mode === mode ? (
                <>
                  <img
                    className="source-preview"
                    src={generatedImages[0].url}
                    alt={`Generated image for: ${generatedImages[0].prompt}`}
                  />
                  <span className="canvas-label">GENERATED IMAGE</span>
                </>
              ) : sourcePreview && mode === "image" ? (
                <>
                  <img
                    className="source-preview"
                    src={sourcePreview}
                    alt={`Selected source: ${sourceFile.name}`}
                  />
                  <span className="canvas-label">SOURCE IMAGE PREVIEW</span>
                </>
              ) : (
                <div className="empty-canvas">
                  <div className="canvas-mark">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="canvas-overline">YOUR CANVAS IS CLEAR</span>
                  <h2>An idea is a good place to begin.</h2>
                  <p>
                    {mode === "image"
                      ? "Add a source image, then describe how you want to transform it."
                      : "Write a prompt to set the direction for your next image."}
                  </p>
                  <span className="canvas-disclaimer">
                    {backendState === "unavailable"
                      ? "Backend connected · Qwen runtime unavailable"
                      : "Images are generated by your local backend"}
                  </span>
                </div>
              )}
              {isGenerating && (
                <div className="generation-overlay" role="status">
                  <span className="loading-spinner" />
                  <span>
                    {mode === "image"
                      ? "Editing image..."
                      : "Generating image..."}
                  </span>
                </div>
              )}
              <div className="canvas-meta">
                <span>CANVAS</span>
                <span>
                  {ratio}
                  <i />
                  {style}
                </span>
              </div>
            </section>
            <footer className="workspace-foot">
              <span>QWEN IMAGE STUDIO</span>
              <span>
                LOCAL WORKSPACE <i className="status-dot" />
              </span>
            </footer>
          </main>

          <aside className="controls" aria-label="Image settings">
            <div className="panel-heading">
              <div>
                <span className="panel-number">01</span>
                <h2>Compose</h2>
              </div>
              <span
                className={`local-badge api-${backendState}`}
                title={`Backend status: ${backendState}`}
              >
                <i className="status-dot" /> LOCAL
              </span>
            </div>
            <div
              className="mode-switch"
              role="group"
              aria-label="Creation mode"
            >
              <button
                type="button"
                className={mode === "text" ? "selected" : ""}
                aria-pressed={mode === "text"}
                disabled={isGenerating}
                onClick={() => {
                  setMode("text");
                  setErrors({});
                  setStatus("");
                }}
              >
                <Icon name="sparkles" size={15} /> Text to Image
              </button>
              <button
                type="button"
                className={mode === "image" ? "selected" : ""}
                aria-pressed={mode === "image"}
                disabled={isGenerating}
                onClick={() => {
                  setMode("image");
                  setErrors({});
                  setStatus("");
                }}
              >
                <Icon name="image" size={15} /> Image to Image
              </button>
            </div>

            {mode === "image" && (
              <div className="upload-section">
                <span className="field-label">SOURCE IMAGE</span>
                {sourceFile ? (
                  <div className="file-preview">
                    <img src={sourcePreview} alt="Selected source thumbnail" />
                    <span>
                      <strong>{sourceFile.name}</strong>
                      <small>
                        {(sourceFile.size / (1024 * 1024)).toFixed(1)} MB ·
                        Local preview
                      </small>
                    </span>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Remove source image"
                      onClick={() => {
                        setSourceFile(null);
                        setSourcePreview("");
                        setErrors((current) => ({ ...current, image: "" }));
                      }}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                ) : (
                  <label className="upload-box">
                    <span className="upload-icon">
                      <Icon name="upload" size={19} />
                    </span>
                    <span>
                      <strong>Choose an image</strong>
                      <small>PNG, JPEG, WebP · Up to 15 MB</small>
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleFileChange}
                      aria-label="Choose a source image"
                    />
                  </label>
                )}
                {errors.image && (
                  <p className="field-error" role="alert">
                    {errors.image}
                  </p>
                )}
              </div>
            )}

            <form onSubmit={handleGenerate} noValidate>
              <div className="field-heading">
                <label htmlFor="prompt">YOUR PROMPT</label>
                <span
                  className={
                    prompt.length > 900 ? "counter near-limit" : "counter"
                  }
                >
                  {prompt.length}
                  <i>/</i>1000
                </span>
              </div>
              <textarea
                id="prompt"
                className={`prompt-input${errors.prompt ? " invalid" : ""}`}
                maxLength={1000}
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setErrors((current) => ({ ...current, prompt: "" }));
                  setStatus("");
                }}
                placeholder="Describe the image you have in mind..."
                aria-invalid={Boolean(errors.prompt)}
                aria-describedby={
                  errors.prompt ? "prompt-error" : "prompt-hint"
                }
              />
              {errors.prompt ? (
                <p className="field-error" id="prompt-error" role="alert">
                  {errors.prompt}
                </p>
              ) : (
                <p className="field-hint" id="prompt-hint">
                  Be specific about the subject, mood, and light.
                </p>
              )}

              <section className="control-section">
                <div className="field-label">ASPECT RATIO</div>
                <div
                  className="ratio-grid"
                  role="group"
                  aria-label="Aspect ratio"
                >
                  {ratios.map((item) => (
                    <button
                      type="button"
                      key={item.value}
                      className={`ratio-card${ratio === item.value ? " selected" : ""}`}
                      aria-pressed={ratio === item.value}
                      onClick={() => setRatio(item.value)}
                    >
                      <span
                        className={`ratio-shape shape-${item.value.replace(":", "-")}`}
                      />
                      <strong>{item.value}</strong>
                    </button>
                  ))}
                </div>
              </section>

              <section className="control-section">
                <div className="field-label">VISUAL STYLE</div>
                <div
                  className="style-grid"
                  role="group"
                  aria-label="Visual style"
                >
                  {styles.map((item, index) => (
                    <button
                      type="button"
                      key={item}
                      className={`style-card${style === item ? " selected" : ""}`}
                      aria-pressed={style === item}
                      onClick={() => setStyle(item)}
                    >
                      <span className={`style-art art-${index}`}>
                        <i />
                      </span>
                      <span>{item}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="advanced">
                <button
                  type="button"
                  className="advanced-toggle"
                  onClick={() => setAdvanced(!advanced)}
                  aria-expanded={advanced}
                >
                  <span>
                    <strong>Advanced settings</strong>
                    <small>Inference steps and seed</small>
                  </span>
                  <span
                    className={`chevron${advanced ? " open" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                {advanced && (
                  <div className="advanced-content">
                    <label htmlFor="steps">
                      Inference steps <strong>{steps}</strong>
                    </label>
                    <input
                      id="steps"
                      type="range"
                      min="4"
                      max="20"
                      value={steps}
                      onChange={(event) => setSteps(Number(event.target.value))}
                    />
                    <label htmlFor="seed">
                      Seed <span>OPTIONAL</span>
                    </label>
                    <input
                      id="seed"
                      type="number"
                      min="0"
                      placeholder="Random"
                      value={seed}
                      onChange={(event) => setSeed(event.target.value)}
                    />
                    <p>Settings are for reference in this local interface.</p>
                  </div>
                )}
              </section>

              {status && (
                <p
                  className={`notice${statusIsError ? " notice-error" : ""}`}
                  role={statusIsError ? "alert" : "status"}
                >
                  {status}
                </p>
              )}
              <button
                type="submit"
                className="generate-button"
                disabled={isGenerating}
                aria-busy={isGenerating}
              >
                {isGenerating ? (
                  <span className="loading-spinner" />
                ) : (
                  <Icon name="sparkles" size={17} />
                )}
                {isGenerating
                  ? mode === "image"
                    ? "Editing image..."
                    : "Generating image..."
                  : "Generate Image"}{" "}
                <span>
                  <Icon name="arrow" size={17} />
                </span>
              </button>
              <p className="local-note">
                Prompts and source images go only to your local backend. Other
                controls are UI-only.
              </p>
            </form>
          </aside>
        </>
      )}

      {page === "gallery" && (
        <main className="content-page">
          <header className="page-title">
            <span className="eyebrow">YOUR LIBRARY</span>
            <h1>Gallery</h1>
            <p>Images created in this workspace will live here.</p>
          </header>
          {generatedImages.length === 0 ? (
            <section className="gallery-empty">
              <div className="empty-gallery-icon">
                <Icon name="gallery" size={24} />
              </div>
              <span className="canvas-overline">NOTHING HERE YET</span>
              <h2>Your gallery is waiting.</h2>
              <p>No images have been returned by the local backend yet.</p>
              <button
                className="text-button"
                type="button"
                onClick={() => choosePage("generate")}
              >
                Return to studio <Icon name="arrow" size={16} />
              </button>
            </section>
          ) : (
            <section className="gallery-grid" aria-label="Generated images">
              {generatedImages.map((image, index) => (
                <article className="gallery-item" key={image.url}>
                  <img
                    src={image.url}
                    alt={`Generated image ${index + 1}: ${image.prompt}`}
                  />
                  <div>
                    <strong>
                      {image.mode === "image"
                        ? "Image edit"
                        : "Generated image"}
                    </strong>
                    <p>{image.prompt}</p>
                  </div>
                </article>
              ))}
            </section>
          )}
        </main>
      )}

      {page === "settings" && (
        <main className="content-page settings-page">
          <header className="page-title">
            <span className="eyebrow">WORKSPACE PREFERENCES</span>
            <h1>Settings</h1>
            <p>Adjust the defaults used in your local studio session.</p>
          </header>
          <section className="settings-section">
            <div>
              <span className="canvas-overline">GENERATION DEFAULTS</span>
              <h2>Starting configuration</h2>
              <p>
                These values only update the controls in this browser session.
              </p>
            </div>
            <div className="settings-row">
              <label htmlFor="default-ratio">Default aspect ratio</label>
              <select
                id="default-ratio"
                value={ratio}
                onChange={(event) => setRatio(event.target.value)}
              >
                {ratios.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.value} · {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-row">
              <label htmlFor="default-style">Default visual style</label>
              <select
                id="default-style"
                value={style}
                onChange={(event) => setStyle(event.target.value)}
              >
                {styles.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </div>
            <div className="settings-row">
              <label htmlFor="default-steps">
                Inference steps <span>{steps}</span>
              </label>
              <input
                id="default-steps"
                type="range"
                min="4"
                max="20"
                value={steps}
                onChange={(event) => setSteps(Number(event.target.value))}
              />
            </div>
            <div className="settings-footer">
              <span>Current session only · No preferences are stored.</span>
              <button
                type="button"
                onClick={() => {
                  setRatio("1:1");
                  setStyle("None");
                  setSteps(8);
                  setSeed("");
                }}
              >
                Reset defaults
              </button>
            </div>
          </section>
          <section className="privacy-note">
            <span className="status-dot" />
            <div>
              <strong>Private by design</strong>
              <p>
                Prompts and uploaded images are sent to the local API at
                127.0.0.1:8000. No external API is configured.
              </p>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
