"""Opt-in, local-only Diffusers runtime. Importing this module never loads weights."""

import gc
import logging
import os
from pathlib import Path
from threading import Lock
from model_downloads import installed_path

logger = logging.getLogger(__name__)

DIMENSIONS = {
    "1:1": (1024, 1024),
    "3:2": (1152, 768),
    "2:3": (768, 1152),
    "16:9": (1280, 720),
}


class RuntimeUnavailable(Exception):
    """An expected setup problem with a message safe to send to the client."""


class RuntimeBusy(Exception):
    pass


class QwenRuntime:
    def __init__(self):
        self.pipeline = None
        self.loaded_mode = None
        self.device = None
        self.lock = Lock()

    def _model_path(self, mode):
        variable = "QWEN_EDIT_MODEL_PATH" if mode == "image" else "QWEN_MODEL_PATH"
        value = os.getenv(variable, "").strip()
        if not value:
            managed = installed_path(mode)
            if managed is not None:
                return managed
            raise RuntimeUnavailable(
                f"Download the model in Settings, or set {variable} to a complete local Diffusers directory."
            )
        path = Path(value).expanduser().resolve()
        if not path.is_dir() or not (path / "model_index.json").is_file():
            raise RuntimeUnavailable(
                f"{variable} must contain a complete Diffusers model including model_index.json."
            )
        return path

    def health(self):
        configured = {}
        for mode, name in (("text", "generate"), ("image", "edit")):
            try:
                self._model_path(mode)
                configured[name] = True
            except RuntimeUnavailable:
                configured[name] = False
        return {
            "status": "ok",
            "model_loaded": self.pipeline is not None,
            "loaded_mode": self.loaded_mode,
            "device": self.device,
            "busy": self.lock.locked(),
            "configured": configured,
            "message": (
                "Qwen pipeline loaded."
                if self.pipeline is not None
                else "Local models load on the first request. Download models in Settings and install optional inference dependencies."
            ),
        }

    def _load(self, mode):
        if self.pipeline is not None and self.loaded_mode == mode:
            return self.pipeline
        path = self._model_path(mode)
        try:
            import torch
            from diffusers import QwenImageEditPipeline, QwenImagePipeline
        except ImportError as exc:
            raise RuntimeUnavailable(
                "Optional Qwen inference dependencies are missing. Install the approved inference requirements first."
            ) from exc

        requested = os.getenv("QWEN_DEVICE", "auto").lower()
        if requested not in {"auto", "cpu", "cuda", "mps"}:
            raise RuntimeUnavailable("QWEN_DEVICE must be auto, cpu, cuda, or mps.")
        device = requested
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else (
                "mps" if torch.backends.mps.is_available() else "cpu"
            )
        if device == "cuda" and not torch.cuda.is_available():
            raise RuntimeUnavailable("CUDA is not available in this Python environment.")
        if device == "mps" and not torch.backends.mps.is_available():
            raise RuntimeUnavailable("Metal/MPS is not available. Run this backend on the Apple Silicon Mac with an MPS-enabled PyTorch build.")

        # Never retain generation and edit weights at the same time.
        self.pipeline = None
        self.loaded_mode = None
        self.device = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()

        pipeline_class = QwenImageEditPipeline if mode == "image" else QwenImagePipeline
        dtype = torch.float32 if device == "cpu" else torch.float16
        pipeline = pipeline_class.from_pretrained(
            str(path), torch_dtype=dtype, local_files_only=True,
        )
        pipeline.enable_attention_slicing()
        pipeline.enable_vae_slicing()
        pipeline.enable_vae_tiling()
        pipeline.to(device)
        self.pipeline = pipeline
        self.loaded_mode = mode
        self.device = device
        return pipeline

    def generate(self, *, prompt, mode, ratio, style, steps, seed, image=None):
        if not self.lock.acquire(blocking=False):
            raise RuntimeBusy("Another image request is running. Please wait.")
        try:
            pipeline = self._load(mode)
            import torch

            width, height = DIMENSIONS[ratio]
            styled_prompt = prompt if style == "None" else f"{prompt}\nVisual style: {style}."
            arguments = {
                "prompt": styled_prompt,
                "negative_prompt": " ",
                "true_cfg_scale": 4.0,
                "num_inference_steps": steps,
                "width": width,
                "height": height,
            }
            if seed is not None:
                # CPU generator is supported by Diffusers on MPS as well.
                arguments["generator"] = torch.Generator(device="cpu").manual_seed(seed)
            if mode == "image":
                arguments["image"] = image
            with torch.inference_mode():
                return pipeline(**arguments).images[0]
        except (RuntimeUnavailable, RuntimeBusy):
            raise
        except Exception:
            logger.exception("Qwen inference failed")
            raise
        finally:
            self.lock.release()