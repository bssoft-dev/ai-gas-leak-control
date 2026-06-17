#!/usr/bin/env python3
"""
Docker 빌드용: service.yaml 파이프라인 broadcast 의 module 항목만 보고
modules/ 아래 필요한 하위 디렉터리만 /out/modules 로 복사한다.

가상 모듈 ID 매핑은 src/SagoHub/runner/service_runner.py 의 VIRTUAL_MODULE_MAP 과
반드시 동기화할 것.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import yaml

# service_runner.service_runner.main() 내부 VIRTUAL_MODULE_MAP 과 동일하게 유지
VIRTUAL_MODULE_MAP: dict[str, str | None] = {
    "fs.read": None,
    "ai.llm.draft_email": "llm_drafter.LLMDrafterModule",
    "nudge.create_draft": "nudge_ui.NudgeUIModule",
    "nudge.check_approval": "nudge_ui.NudgeUIModule",
    "mail.send": "mailer.MailerModule",
    "monitor.log_change": "monitor.MonitorLogModule",
    "monitor.console_output": "monitor.MonitorConsoleModule",
}


def _module_id_to_package(module_id: str) -> str:
    """file_watcher.FileWatcherModule -> file_watcher"""
    if "." not in module_id:
        return module_id
    return module_id.rsplit(".", 1)[0]


def collect_required_packages(service_yaml_path: Path) -> set[str]:
    data = yaml.safe_load(service_yaml_path.read_text(encoding="utf-8"))
    packages: set[str] = set()
    for pl in data.get("pipelines") or []:
        for bc in pl.get("broadcast") or []:
            if not isinstance(bc, dict):
                continue
            name = bc.get("module")
            if not name or not isinstance(name, str):
                continue
            mapped = VIRTUAL_MODULE_MAP.get(name)
            if mapped is None and name in VIRTUAL_MODULE_MAP:
                continue
            resolved = mapped if mapped is not None else name
            packages.add(_module_id_to_package(resolved))
    return packages


def main() -> None:
    if len(sys.argv) != 4:
        print(
            "Usage: docker-select-modules.py <service.yaml> <modules-src-dir> <out-dir>",
            file=sys.stderr,
        )
        sys.exit(2)
    service_yaml = Path(sys.argv[1])
    src_root = Path(sys.argv[2])
    out_root = Path(sys.argv[3])

    packages = collect_required_packages(service_yaml)
    if out_root.exists():
        shutil.rmtree(out_root)
    out_root.mkdir(parents=True)

    for name in sorted(packages):
        src = src_root / name
        if not src.is_dir():
            print(f"ERROR: modules/{name} 가 없습니다 (service.yaml 참조와 불일치)", file=sys.stderr)
            sys.exit(1)
        shutil.copytree(src, out_root / name, symlinks=False)

    print(f"docker-select-modules: {len(packages)} 패키지 복사 → {out_root}")
    if packages:
        print("  " + ", ".join(sorted(packages)))


if __name__ == "__main__":
    main()
