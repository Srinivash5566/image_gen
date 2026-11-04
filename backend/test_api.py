"""API contract tests; no model downloads or heavyweight imports."""

from io import BytesIO
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

import app as api
from qwen_runtime import QwenRuntime, RuntimeBusy


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)

    def test_missing_model_has_actionable_error(self):
        with patch.dict(os.environ, {"QWEN_MODEL_PATH": "", "QWEN_EDIT_MODEL_PATH": ""}):
            with patch.object(api, "runtime", QwenRuntime()):
                self.assertFalse(self.client.get("/api/health").json()["model_loaded"])
                response = self.client.post("/api/generate", data={"prompt": "A garden"})
                self.assertEqual(response.status_code, 503)
                self.assertIn("QWEN_MODEL_PATH", response.json()["detail"])

    def test_settings_validate_before_inference(self):
        for field, value in (("ratio", "4:5"), ("steps", "100"), ("seed", "-1")):
            response = self.client.post("/api/generate", data={"prompt": "A garden", field: value})
            self.assertEqual(response.status_code, 422)

    def test_png_contract_and_settings_with_test_double(self):
        # A tiny image tests HTTP serialization only, not Qwen generation.
        with TemporaryDirectory() as directory:
            with patch.object(api, "OUTPUT_DIR", Path(directory)):
                with patch.object(api.runtime, "generate", return_value=Image.new("RGB", (2, 2))) as generate:
                    response = self.client.post("/api/generate", data={
                        "prompt": "A garden", "ratio": "3:2", "style": "Anime", "steps": "30", "seed": "12",
                    })
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["content-type"], "image/png")
                    self.assertEqual(generate.call_args.kwargs["steps"], 30)
                    self.assertEqual(generate.call_args.kwargs["seed"], 12)
                    self.assertEqual(Image.open(BytesIO(response.content)).size, (2, 2))

    def test_edit_validation_and_runtime(self):
        invalid = self.client.post("/api/edit", data={"prompt": "Edit"}, files={
            "image": ("bad.png", b"bad", "image/png"),
        })
        self.assertEqual(invalid.status_code, 400)
        source = BytesIO()
        Image.new("RGB", (2, 2)).save(source, "PNG")
        with patch.dict(os.environ, {"QWEN_EDIT_MODEL_PATH": ""}):
            response = self.client.post("/api/edit", data={"prompt": "Edit"}, files={
                "image": ("source.png", source.getvalue(), "image/png"),
            })
        self.assertEqual(response.status_code, 503)
        self.assertIn("QWEN_EDIT_MODEL_PATH", response.json()["detail"])

    def test_busy_and_error_sanitization(self):
        with patch.object(api.runtime, "generate", side_effect=RuntimeBusy("Another request is running.")):
            self.assertEqual(self.client.post("/api/generate", data={"prompt": "Test"}).status_code, 409)
        with patch.object(api.runtime, "generate", side_effect=RuntimeError("SECRET INTERNAL PATH")):
            response = self.client.post("/api/generate", data={"prompt": "Test"})
            self.assertEqual(response.status_code, 500)
            self.assertNotIn("SECRET", response.text)

    def test_cors(self):
        response = self.client.options("/api/generate", headers={
            "Origin": "http://127.0.0.1:5173", "Access-Control-Request-Method": "POST",
        })
        self.assertEqual(response.headers["access-control-allow-origin"], "http://127.0.0.1:5173")


if __name__ == "__main__":
    unittest.main()