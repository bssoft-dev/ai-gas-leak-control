"""
모듈 동적 로더: 프로젝트 modules/ 폴더를 스캔해 Module 서브클래스를 수집
SagoHub.modules 패키지 없이 사용합니다.
"""
import importlib.util
from pathlib import Path
from typing import Dict, Type

from .module import Module


def get_module_map(project_root: Path) -> Dict[str, Type[Module]]:
    """
    project_root/modules/ 아래 각 하위 디렉터리의 *.py에서
    Module 서브클래스를 찾아 {클래스이름: 클래스} 로 반환합니다.
    """
    result: Dict[str, Type[Module]] = {}
    modules_dir = Path(project_root) / "modules"
    if not modules_dir.is_dir():
        return result
    for subdir in sorted(modules_dir.iterdir()):
        if not subdir.is_dir():
            continue
        for py_file in subdir.glob("*.py"):
            if py_file.name.startswith("_"):
                continue
            spec = importlib.util.spec_from_file_location(
                f"modules.{subdir.name}.{py_file.stem}",
                py_file,
                submodule_search_locations=[str(subdir)],
            )
            if spec is None or spec.loader is None:
                continue
            try:
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
            except Exception:
                continue
            for attr_name in dir(mod):
                cls = getattr(mod, attr_name, None)
                if (
                    cls is not None
                    and isinstance(cls, type)
                    and issubclass(cls, Module)
                    and cls is not Module
                ):
                    result[f"{py_file.stem}.{cls.__name__}"] = cls
    return result
