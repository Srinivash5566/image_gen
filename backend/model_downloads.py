"""Explicit, allowlisted Hugging Face downloads; never starts at API startup."""

import json
import logging
from pathlib import Path
import shutil
from threading import Lock, Thread
from uuid import uuid4

CATALOG = {"text": "Qwen/Qwen-Image", "image": "Qwen/Qwen-Image-Edit"}
MODEL_ROOT = Path(__file__).resolve().parent / "models"
logger = logging.getLogger(__name__)


def installed_path(mode):
    directory = MODEL_ROOT / mode
    marker = directory / "studio-download.json"
    try:
        record = json.loads(marker.read_text(encoding="utf-8"))
        if record["repo_id"] == CATALOG[mode] and (directory / "model_index.json").is_file():
            return directory
    except (OSError, ValueError, KeyError):
        pass
    return None


class DownloadManager:
    def __init__(self):
        self.lock = Lock()
        self.plans = {}
        self.reviews = {}
        self.job = {"state": "idle", "completed_bytes": 0, "completed_files": 0}

    def status(self):
        with self.lock:
            return {**self.job, "installed": {mode: installed_path(mode) is not None for mode in CATALOG}}

    def plan(self, mode):
        # Metadata only: no weights are downloaded by this operation.
        from huggingface_hub import HfApi

        info = HfApi().model_info(CATALOG[mode], files_metadata=True, timeout=30)
        files = [
            {"name": item.rfilename, "size": item.size}
            for item in info.siblings
            if item.rfilename.endswith((".json", ".safetensors", ".txt", ".model", ".tiktoken"))
        ]
        if not info.sha or not files or any(item["size"] is None for item in files):
            raise ValueError("The model repository did not provide a complete download size.")
        if not any(item["name"] == "model_index.json" for item in files):
            raise ValueError("The repository is not a supported Diffusers model.")
        MODEL_ROOT.mkdir(parents=True, exist_ok=True)
        total = sum(item["size"] for item in files)
        plan = {
            "plan_id": uuid4().hex, "mode": mode, "repo_id": CATALOG[mode],
            "revision": info.sha, "total_bytes": total, "total_files": len(files),
            "free_bytes": shutil.disk_usage(MODEL_ROOT).free,
            "required_bytes": total + 2 * 1024**3,
            "files": files,
        }
        with self.lock:
            # Keep metadata plans bounded; a fresh confirmation is needed if evicted.
            if len(self.plans) >= 8:
                self.plans.clear()
            self.plans[plan["plan_id"]] = plan
        return {key: value for key, value in plan.items() if key != "files"}

    def begin_review(self, mode):
        with self.lock:
            previous = self.reviews.get(mode)
            if previous and previous["state"] == "checking":
                return dict(previous)
            review = {"state": "checking", "mode": mode, "message": "Checking Hugging Face model metadata. Slow network connections may take a few minutes."}
            self.reviews[mode] = review
            Thread(target=self._review, args=(mode,), daemon=True).start()
            return dict(review)

    def review_status(self, mode):
        with self.lock:
            return dict(self.reviews.get(mode, {"state": "idle", "mode": mode}))

    def _review(self, mode):
        try:
            plan = self.plan(mode)
            result = {"state": "ready", "mode": mode, "plan": plan}
        except ImportError:
            result = {"state": "error", "mode": mode, "message": "Install the updated backend requirements in the Python environment running FastAPI."}
        except Exception:
            logger.exception("Model metadata lookup failed")
            result = {"state": "error", "mode": mode, "message": "Could not retrieve model metadata from Hugging Face. Check network access and retry."}
        with self.lock:
            self.reviews[mode] = result

    def start(self, plan_id):
        with self.lock:
            if self.job["state"] == "downloading":
                raise ValueError("A model download is already running.")
            plan = self.plans.get(plan_id)
            if plan is None:
                raise ValueError("Review the download size again before confirming.")
            if shutil.disk_usage(MODEL_ROOT).free < plan["required_bytes"]:
                raise ValueError("Not enough disk space for this model and a 2 GiB safety margin.")
            self.job = {
                "state": "downloading", "mode": plan["mode"], "repo_id": plan["repo_id"],
                "total_bytes": plan["total_bytes"], "total_files": plan["total_files"],
                "completed_bytes": 0, "completed_files": 0, "current_file": "Starting download",
                "message": "Downloading from Hugging Face. Keep the backend running.",
            }
            Thread(target=self._download, args=(plan,), daemon=True).start()
            return dict(self.job)

    def _download(self, plan):
        try:
            from huggingface_hub import hf_hub_download

            directory = MODEL_ROOT / plan["mode"]
            for item in plan["files"]:
                with self.lock:
                    self.job["current_file"] = item["name"]
                hf_hub_download(
                    repo_id=plan["repo_id"], filename=item["name"],
                    revision=plan["revision"], local_dir=directory,
                )
                with self.lock:
                    self.job["completed_bytes"] += item["size"]
                    self.job["completed_files"] += 1
            marker = directory / "studio-download.json"
            temporary = marker.with_suffix(".tmp")
            temporary.write_text(json.dumps({
                "repo_id": plan["repo_id"], "revision": plan["revision"],
            }), encoding="utf-8")
            temporary.replace(marker)
            with self.lock:
                self.job.update(state="completed", message="Model downloaded and configured. Inference dependencies and sufficient memory are still required.")
        except Exception:
            logger.exception("Model download failed")
            with self.lock:
                self.job.update(state="error", message="Download failed. Check disk space, network access and backend logs. Review the size and retry to reuse cached files.")