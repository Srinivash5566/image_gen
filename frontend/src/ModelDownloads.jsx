import { useEffect, useState } from "react";
import { beginModelReview, getModelReview, getModelStatus, startModelDownload } from "./services/imageApi";

const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

export default function ModelDownloads() {
  const [mode, setMode] = useState("text");
  const [plan, setPlan] = useState(null);
  const [job, setJob] = useState(null);
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let active = true;
    let timer;
    async function refreshReview() {
      try {
        const review = await getModelReview(mode);
        if (!active) return;
        if (review.state === "ready") {
          setPlan(review.plan);
          setChecking(false);
        } else if (review.state === "error") {
          setError(review.message);
          setChecking(false);
        } else if (review.state === "idle") {
          setError("The backend restarted during the size check. Please review again.");
          setChecking(false);
        } else {
          timer = setTimeout(refreshReview, 2000);
        }
      } catch (failure) {
        if (active) { setError(failure.message); setChecking(false); }
      }
    }
    if (checking) refreshReview();
    return () => { active = false; clearTimeout(timer); };
  }, [checking, mode]);

  useEffect(() => {
    let active = true;
    let timer;
    async function refresh() {
      try {
        const status = await getModelStatus();
        if (active) setJob(status);
      } catch (failure) {
        if (active) setError(failure.message);
      } finally {
        if (active) timer = setTimeout(refresh, 2000);
      }
    }
    refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [retry]);

  async function review() {
    setPending(true);
    setError("");
    setPlan(null);
    setConfirmed(false);
    try { await beginModelReview(mode); setChecking(true); }
    catch (failure) { setError(failure.message); }
    finally { setPending(false); }
  }

  async function download() {
    if (!plan || !confirmed || pending) return;
    setPending(true);
    setError("");
    try {
      setJob(await startModelDownload(plan.plan_id));
      setPlan(null);
      setConfirmed(false);
      setRetry((value) => value + 1);
    } catch (failure) { setError(failure.message); }
    finally { setPending(false); }
  }

  const busy = job?.state === "downloading";
  const percent = job?.total_bytes ? Math.floor(job.completed_bytes / job.total_bytes * 100) : 0;

  return (
    <section className="settings-section model-downloads" aria-labelledby="model-download-title">
      <div>
        <span className="canvas-overline">LOCAL MODEL SETUP</span>
        <h2 id="model-download-title">Download Qwen models</h2>
        <p>Downloads are saved on the backend computer, not in this browser. Model files are large; downloading does not install the inference runtime.</p>
      </div>
      <p className="notice">Standard Qwen models may not fit a 32 GB M2 Mac. The 20B transformer alone is about 40 GB at FP16, before other components. Windows CPU inference can be extremely slow. These are not quantized models.</p>
      <div className="settings-row">
        <label htmlFor="download-model">Model</label>
        <select id="download-model" value={mode} disabled={pending || busy || checking} onChange={(event) => {
          setMode(event.target.value); setPlan(null); setConfirmed(false);
        }}>
          <option value="text">Qwen Image · Text to Image</option>
          <option value="image">Qwen Image Edit · Image to Image</option>
        </select>
      </div>
      <p className="model-description">
        Generation: {job?.installed?.text ? "Downloaded" : "Not downloaded"} · Editing: {job?.installed?.image ? "Downloaded" : "Not downloaded"}
      </p>
      <button className="text-button" type="button" disabled={pending || busy || checking} onClick={review}>
        {checking ? "Checking model size…" : pending ? "Please wait…" : "Review download size"}
      </button>
      {checking && <p className="notice" role="status">Checking Hugging Face metadata in the background. This may take a few minutes on a slow connection; no model weights are downloading yet.</p>}
      {plan && (
        <div className="download-confirmation">
          <p>{plan.repo_id} · {gib(plan.total_bytes)} · {plan.total_files} files</p>
          <p>Free disk space: {gib(plan.free_bytes)}. Required with safety margin: {gib(plan.required_bytes)}.</p>
          <label className="download-consent">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            I approve this large download from Hugging Face and understand the memory requirements. Inference packages must be installed separately.
          </label>
          <button className="generate-button" type="button" disabled={!confirmed || pending || busy || plan.free_bytes < plan.required_bytes} onClick={download}>
            Download model ({gib(plan.total_bytes)})
          </button>
          {plan.free_bytes < plan.required_bytes && <p role="alert">Not enough free disk space. Free space and review again.</p>}
        </div>
      )}
      {job && job.state !== "idle" && (
        <div className="download-status" role="status" aria-live="polite">
          <strong>{job.state === "downloading" ? "Downloading model" : job.state === "completed" ? "Model downloaded" : "Download failed"}</strong>
          <p>{job.message}</p>
          {busy && <>
            <progress value={job.completed_bytes} max={job.total_bytes || 1} aria-label="Model download progress" />
            <p>{percent}% · {gib(job.completed_bytes)} / {gib(job.total_bytes)} · {job.completed_files}/{job.total_files} files</p>
            <p>Current file: {job.current_file}</p>
            <small>Progress updates after each completed file; large weight shards may take a while. Keep the backend running. Retry after an interruption to reuse cached files.</small>
          </>}
        </div>
      )}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
    </section>
  );
}