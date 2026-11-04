# Qwen Image Studio

## Start the application

In one terminal, install the lightweight API dependencies and start FastAPI:

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

In a second terminal, install frontend dependencies and start Vite:

```powershell
cd frontend
npm ci
npm start -- --host 127.0.0.1
```

Open http://127.0.0.1:5173. To use a different backend origin, copy
`frontend/.env.example` to `frontend/.env.local`, set `VITE_API_BASE_URL`, and
restart Vite.

## Current inference status

The backend now includes an opt-in Hugging Face Diffusers runtime. No inference
packages or model weights were installed for this integration. Without these,
requests return HTTP 503 with actionable configuration instructions, not fake images.

Both endpoints accept multipart `prompt`, `ratio` (1:1, 3:2, 2:3, 16:9), `style`,
`steps` (4–50, default 50), and optional integer `seed` (0–4294967295). Editing
also requires `image` (PNG/JPEG/WebP, at most 15 MB). Style is appended to the
inference prompt. Results are saved as PNG files under `backend/outputs` and
returned as `image/png`. The session gallery supports preview and download;
its list is not restored after a page reload, although output files remain on disk.

## Optional real Qwen inference — setup not performed

Only proceed after approving the substantial model downloads and reviewing memory.
Use an isolated Python 3.11 or 3.12 environment for inference rather than relying
on the Windows testing interpreter (3.14). Install `backend/requirements-inference.txt`
in that environment **after approval**. This optional manifest includes PyTorch,
Diffusers, Transformers, Accelerate, Safetensors, and SentencePiece.

Obtain complete, compatible Diffusers directories for:

- Text-to-image: `Qwen/Qwen-Image`, used by `QwenImagePipeline`.
- Instruction editing: original `Qwen/Qwen-Image-Edit`, used by
	`QwenImageEditPipeline`. Edit-2509/Plus is a different pipeline and is not supported
	by this adapter.

Copy `backend/.env.example` to `backend/.env` and set `QWEN_MODEL_PATH` and/or
`QWEN_EDIT_MODEL_PATH` to those local directories. A standalone GGUF or MLX model
is not compatible with this Diffusers adapter. Use `QWEN_DEVICE=cpu` on the current
AMD Windows machine, or `QWEN_DEVICE=mps` on the M2 Mac. `auto` selects CUDA,
then MPS, then CPU. Restart FastAPI after changing configuration.

Loading is lazy on first generation/edit request and always uses
`local_files_only=True`: neither startup nor a generation request downloads models.
Explicit model downloads are available through Settings as described below.
Health reports `configured`, `model_loaded`, `loaded_mode`, `device`, and `busy`.
Configured means a local directory with model_index.json was found, **not** that
all weights, dependencies, memory, or device compatibility have been verified.
Only one request and one pipeline are retained at a time; switching modes unloads
the previous pipeline. Do not start multiple Uvicorn workers with model inference.

### Windows testing versus Mac M2

- This Windows session reports AMD integrated graphics, not a CUDA GPU. The CPU
	path is functional code but full Qwen inference may be extremely slow and needs
	substantial system RAM. API/UI contract tests run without any model.
- The [official Diffusers Qwen docs](https://huggingface.co/docs/diffusers/api/pipelines/qwenimage)
	list MPS as a device option. This adapter uses FP16 on MPS and FP32 on CPU,
	plus attention slicing and VAE slicing/tiling.
- MPS support does **not** establish that the standard model fits an M2 with
	32 GB unified memory. Qwen's 20B transformer alone needs roughly 40 GB at FP16,
	before the text encoder, VAE, activations, and OS. These optimizations do not
	quantize model weights. A 32 GB Mac likely needs a separately validated
	quantized runtime/model or remote inference. Larger-memory Macs still require
	a real hardware test; MPS inference has not been run here.
- No quantized backend, CPU offloading, Lightning LoRA, or automatic fallback is
	configured. Do not use the 8-step assumption for the standard model; the UI now
	defaults to 50 steps.

## Validation

Frontend: `npm run lint` and `npm run build` in `frontend`.
Backend: with the lightweight dependencies and `httpx` installed, run
`python -m unittest -v test_api` from `backend`.
The success-response test uses a labeled tiny-image test double only to validate
PNG HTTP serialization; it is not evidence that Qwen generated an image.

## Download models from the UI

Restart the backend after installing the updated lightweight requirements (includes
the Hugging Face Hub client). Open **Settings → Download Qwen models**, or use
**Download / manage Qwen models** below the Generate button.

1. Select the generation or editing model and click **Review download size**.
	This starts a background metadata lookup and displays **Checking model size**
	while the UI polls for completion. Slow networks may take a few minutes;
	no model files download during this step. It displays the actual
	selected-file size, available disk space and a 2 GiB safety margin.
2. Read the hardware warning and tick the approval checkbox.
3. Click **Download model** to explicitly start a backend background download.
	Progress counts completed files/bytes, not partial bytes within a weight shard.
	Keep FastAPI running. There is no cancel button; after stopping/restarting the
	backend, review and retry to reuse Hub cached downloads.

Only `Qwen/Qwen-Image` and the original `Qwen/Qwen-Image-Edit` are allowlisted.
Metadata review pins the model commit, so the confirmed files and sizes belong to
the same revision. Files go into `backend/models/text` or `backend/models/image`.
After all selected files download successfully, an atomic completion marker enables
automatic runtime discovery; no manual environment path or restart is required.
Explicit nonempty environment model paths take precedence over managed downloads.
Interrupted or failed new downloads do not receive a completion marker.

Endpoints: `GET /api/models/status`, `GET /api/models/plan?mode=text|image`,
`POST /api/models/download` with JSON `plan_id` and `confirmed: true`.
The frontend uses `POST /api/models/review?mode=text|image` followed by
`GET /api/models/review?mode=text|image` rather than holding the legacy synchronous
plan request open across a slow Hugging Face lookup.
These are intended for the local-only API. Do not expose this unauthenticated API
on a public network. Use a single Uvicorn process; job state is in-memory and
resets at restart, while completed models persist.

The generation metadata checked during development listed 57,704,572,586 bytes
(about 53.7 GiB); always use the live UI size before approving. No model weights
were downloaded during tests. Download completion does **not** install PyTorch /
Diffusers or establish that a model fits memory. Those optional inference
dependencies and hardware requirements still apply.

Download tests: `python -m unittest -v test_api test_downloads` from `backend`.
They use fake metadata and tiny local files, not real model downloads.

