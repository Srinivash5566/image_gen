
from pathlib import Path
from io import BytesIO
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

BASE_DIR = Path(__file__).resolve().parent
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
    return {
        "status": "ok",
        "model_loaded": False,
        "message": "API is running; Qwen runtime is not connected yet.",
    }


@app.post("/api/generate")
def generate(prompt: str = Form(...)):
    prompt = prompt.strip()

    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required.")

    # We will connect the Qwen text-to-image pipeline here.
    raise HTTPException(
        status_code=503,
        detail="Image generation is not available until the Qwen runtime is configured.",
    )


@app.post("/api/edit")
async def edit(
    prompt: str = Form(...),
    image: UploadFile = File(...),
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

    except (UnidentifiedImageError, OSError):
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is not a valid supported image.",
        )

    # We will pass the validated image and prompt to Qwen here.
    raise HTTPException(
        status_code=503,
        detail="Image editing is not available until the Qwen runtime is configured.",
    )
