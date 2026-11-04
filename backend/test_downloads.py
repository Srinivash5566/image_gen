"""Download workflow tests use fake metadata/files; never download real weights."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import app as api
from model_downloads import DownloadManager, installed_path
from qwen_runtime import QwenRuntime


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        patcher = patch("model_downloads.MODEL_ROOT", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.manager = DownloadManager()

    def plan(self):
        metadata = SimpleNamespace(sha="pinned-revision", siblings=[
            SimpleNamespace(rfilename="model_index.json", size=30),
            SimpleNamespace(rfilename="transformer/model.safetensors", size=100),
        ])
        with patch("huggingface_hub.HfApi") as hub:
            hub.return_value.model_info.return_value = metadata
            return self.manager.plan("text")

    def test_metadata_only_and_explicit_confirmation(self):
        with patch.object(api, "downloads", self.manager):
            client = TestClient(api.app)
            self.assertEqual(client.get("/api/models/status").json()["state"], "idle")
            self.assertEqual(client.get("/api/models/plan?mode=arbitrary").status_code, 422)
            self.assertEqual(client.post("/api/models/download", json={"plan_id": "x", "confirmed": False}).status_code, 422)
            self.assertEqual(client.post("/api/models/download", json={"plan_id": "x", "confirmed": True}).status_code, 409)
        plan = self.plan()
        self.assertEqual(plan["total_bytes"], 130)
        self.assertFalse((self.root / "text").exists())

    def test_background_review_returns_without_waiting(self):
        with patch.object(api, "downloads", self.manager), patch("model_downloads.Thread") as worker:
            client = TestClient(api.app)
            response = client.post("/api/models/review?mode=text")
            self.assertEqual(response.status_code, 202)
            self.assertEqual(response.json()["state"], "checking")
            client.post("/api/models/review?mode=text")
            self.assertEqual(worker.call_count, 1)
            self.assertEqual(client.get("/api/models/review?mode=text").json()["state"], "checking")
        with patch.object(self.manager, "plan", return_value={"plan_id": "test"}):
            self.manager._review("text")
        self.assertEqual(self.manager.review_status("text")["state"], "ready")
        self.assertEqual(self.manager.review_status("text")["plan"]["plan_id"], "test")
        with patch.object(self.manager, "plan", side_effect=ImportError):
            self.manager._review("image")
        self.assertEqual(self.manager.review_status("image")["state"], "error")

    def test_completion_configures_persistent_local_model(self):
        plan = self.plan()
        def fake_download(**kwargs):
            target = kwargs["local_dir"] / kwargs["filename"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("{}", encoding="utf-8")
            self.assertEqual(kwargs["revision"], "pinned-revision")
        with patch("model_downloads.Thread"):
            self.manager.start(plan["plan_id"])
        self.assertEqual(self.manager.status()["state"], "downloading")
        with self.assertRaises(ValueError):
            self.manager.start(plan["plan_id"])
        with patch("huggingface_hub.hf_hub_download", side_effect=fake_download):
            self.manager._download(self.manager.plans[plan["plan_id"]])
        self.assertEqual(self.manager.status()["state"], "completed")
        self.assertEqual(self.manager.status()["completed_bytes"], 130)
        self.assertEqual(installed_path("text"), self.root / "text")
        with patch.dict("os.environ", {"QWEN_MODEL_PATH": ""}):
            self.assertEqual(QwenRuntime()._model_path("text"), self.root / "text")
        self.assertTrue(DownloadManager().status()["installed"]["text"])

    def test_disk_guard_and_sanitized_failure(self):
        plan = self.plan()
        with patch("model_downloads.shutil.disk_usage", return_value=SimpleNamespace(free=0)):
            with self.assertRaises(ValueError):
                self.manager.start(plan["plan_id"])
        with patch("model_downloads.Thread"):
            self.manager.start(plan["plan_id"])
        with patch("huggingface_hub.hf_hub_download", side_effect=RuntimeError("SECRET")):
            with self.assertLogs("model_downloads", level="ERROR"):
                self.manager._download(self.manager.plans[plan["plan_id"]])
        self.assertEqual(self.manager.status()["state"], "error")
        self.assertNotIn("SECRET", json.dumps(self.manager.status()))
        self.assertIsNone(installed_path("text"))


if __name__ == "__main__":
    unittest.main()