
from pathlib import Path
from io import BytesIO
from uuid import uuid4
from typing import Annotated, Literal
import logging

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.concurrency import run_in_threadpool
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel
from model_downloads import DownloadManager
from qwen_runtime import QwenRuntime, RuntimeBusy, RuntimeUnavailable

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
runtime = QwenRuntime()
downloads = DownloadManager()
OUTPUT_DIR = BASE_DIR / "outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}

app = FastAPI(
    title="Qwen Image Studio API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

app.mount(
    "/outputs",
    StaticFiles(directory=str(OUTPUT_DIR)),
    name="outputs",
)


@app.get("/api/health")
def health():
    return runtime.health()


class DownloadRequest(BaseModel):
    plan_id: str
    confirmed: Literal[True]


@app.get("/api/models/status")
def model_status():
    return downloads.status()


@app.get("/api/models/plan")
def model_plan(mode: Literal["text", "image"] = "text"):
    try:
        return downloads.plan(mode)
    except ImportError as exc:
        raise HTTPException(503, "Install the updated backend requirements to enable model downloads.") from exc
    except Exception as exc:
        logging.getLogger(__name__).exception("Could not inspect model download")
        raise HTTPException(502, "Could not retrieve model size from Hugging Face. Check network access and retry.") from exc


@app.post("/api/models/download", status_code=202)
def download_model(request: DownloadRequest):
    try:
        return downloads.start(request.plan_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post("/api/models/review", status_code=202)
def begin_model_review(mode: Literal["text", "image"] = "text"):
    return downloads.begin_review(mode)


@app.get("/api/models/review")
def model_review_status(mode: Literal["text", "image"] = "text"):
    return downloads.review_status(mode)


def generation_settings(
    ratio: Annotated[Literal["1:1", "3:2", "2:3", "16:9"], Form()] = "1:1",
    style: Annotated[Literal["None", "Photorealistic", "Cinematic", "Anime", "3D Render", "Digital Art"], Form()] = "None",
    steps: Annotated[int, Form(ge=4, le=50)] = 50,
    seed: Annotated[int | None, Form(ge=0, le=4294967295)] = None,
):
    return {"ratio": ratio, "style": style, "steps": steps, "seed": seed}


def infer(prompt, mode, settings, image=None):
    try:
        result = runtime.generate(prompt=prompt, mode=mode, image=image, **settings)
    except RuntimeUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Qwen inference failed. Check the backend logs and available memory.",
        ) from exc
    path = OUTPUT_DIR / f"{uuid4().hex}.png"
    result.save(path, format="PNG")
    return FileResponse(path, media_type="image/png", filename=path.name)


@app.post("/api/generate")
def generate(prompt: str = Form(...), settings: dict = Depends(generation_settings)):
    prompt = prompt.strip()

    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required.")

    return infer(prompt, "text", settings)


@app.post("/api/edit")
async def edit(
    prompt: str = Form(...),
    image: UploadFile = File(...),
    settings: dict = Depends(generation_settings),
):
    prompt = prompt.strip()

    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required.")

    if image.content_type not in {
        "image/png",
        "image/jpeg",
        "image/webp",
    }:
        raise HTTPException(
            status_code=400,
            detail="Upload a PNG, JPEG, or WebP image.",
        )

    data = await image.read(MAX_UPLOAD_BYTES + 1)

    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Image size must not exceed 15 MB.",
        )

    try:
        with Image.open(BytesIO(data)) as uploaded:
            if uploaded.format not in ALLOWED_FORMATS:
                raise HTTPException(
                    status_code=400,
                    detail="Unsupported image format.",
                )

            uploaded.verify()

    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is not a valid supported image.",
        )

    with Image.open(BytesIO(data)) as uploaded:
        source = uploaded.convert("RGB")
    return await run_in_threadpool(infer, prompt, "image", settings, source)
