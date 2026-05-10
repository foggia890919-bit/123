"""전처리 중간 결과물을 단계별로 저장하는 디버그 도우미."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


class DebugRecorder:
    def __init__(self, out_dir: Path | str | None) -> None:
        self.out_dir = Path(out_dir) if out_dir else None
        self._step = 0
        if self.out_dir:
            self.out_dir.mkdir(parents=True, exist_ok=True)

    def save(self, name: str, image: np.ndarray) -> None:
        if self.out_dir is None:
            return
        self._step += 1
        path = self.out_dir / f"{self._step:02d}_{name}.png"
        cv2.imwrite(str(path), image)

    def enabled(self) -> bool:
        return self.out_dir is not None
