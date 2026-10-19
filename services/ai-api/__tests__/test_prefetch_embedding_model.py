import importlib.util
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "prefetch_embedding_model.py"


def load_script():
    spec = importlib.util.spec_from_file_location("prefetch_embedding_model", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_only_model_weights_and_tokenizer_files_are_requested(tmp_path):
    module = load_script()
    target = tmp_path / "bge-m3"

    with patch.object(module, "snapshot_download", return_value=str(target)) as download:
        assert module.main(["BAAI/bge-m3", str(target)]) == 0

    kwargs = download.call_args.kwargs
    assert kwargs["repo_id"] == "BAAI/bge-m3"
    assert kwargs["local_dir"] == str(target)
    assert "pytorch_model.bin" in kwargs["allow_patterns"]
    assert not any("onnx" in pattern for pattern in kwargs["allow_patterns"])
    assert kwargs["max_workers"] == module.DOWNLOAD_WORKERS
    assert target.is_dir()
