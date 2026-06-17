import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from pydantic import BaseModel, Field


class UIServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8080
    external_port: Optional[int] = None
    event_bus_url: Optional[str] = None
    mode: Optional[str] = "publish"


class ServiceMetadata(BaseModel):
    id: str
    version: str
    name: str
    description: Optional[str] = None
    author: Optional[str] = None
    icon: Optional[str] = None
    category: Optional[str] = None
    domain: Optional[str] = None
    ui_server: Optional[UIServerConfig] = None


class ConfigField(BaseModel):
    type: str = "string"
    label: Optional[str] = None
    default: Any = None
    required: bool = False
    description: Optional[str] = None
    options: Optional[Any] = None


class ServiceConfig(BaseModel):
    values: Dict[str, Any] = Field(default_factory=dict)
    definitions: Dict[str, ConfigField] = Field(default_factory=dict)

    def get(self, key: str, default: Any = None) -> Any:
        """하위 호환: ui_server 등에서 dict처럼 config.get(...) 사용."""
        return self.values.get(key, default)

    @property
    def schema(self) -> Dict[str, ConfigField]:
        # 하위 호환: 기존 코드에서 config.schema 접근 허용
        return self.definitions

    @classmethod
    def from_schema(cls, raw: Optional[Dict[str, Any]]) -> "ServiceConfig":
        raw = raw or {}
        definitions: Dict[str, ConfigField] = {}
        values: Dict[str, Any] = {}
        for key, item in raw.items():
            if isinstance(item, dict):
                field = ConfigField(**item)
                definitions[key] = field
                if "default" in item:
                    values[key] = item.get("default")
            else:
                # 값만 직접 적힌 경우에도 호환되도록 처리
                definitions[key] = ConfigField(type="any", default=item)
                values[key] = item
        return cls(values=values, definitions=definitions)


class AggregationDef(BaseModel):
    strategy: str = "INDEPENDENT"
    target: Optional[str] = None
    options: Optional[Dict[str, Any]] = None


class TriggerDef(BaseModel):
    event: str
    filter: Optional[str] = None
    debounce: int = 0
    aggregation: Optional[AggregationDef] = None


class BroadcastCall(BaseModel):
    module: str
    id: Optional[str] = None
    args: Dict[str, Any] = Field(default_factory=dict)
    condition: Optional[str] = None
    priority: Optional[int] = None


class PipelineDef(BaseModel):
    id: Optional[str] = None
    name: str
    trigger: Optional[TriggerDef] = None
    broadcast: List[BroadcastCall] = Field(default_factory=list)

    @classmethod
    def from_raw(cls, data: Dict[str, Any]) -> "PipelineDef":
        # 하위 호환: 구버전 service.yaml(on/steps)도 지원
        trigger_data = data.get("trigger") or data.get("on")
        broadcast_data = data.get("broadcast")
        if broadcast_data is None:
            broadcast_data = data.get("steps") or []
        return cls(
            id=data.get("id"),
            name=data.get("name") or data.get("id") or "unnamed",
            trigger=TriggerDef(**trigger_data) if isinstance(trigger_data, dict) else None,
            broadcast=[BroadcastCall(**item) for item in (broadcast_data or []) if isinstance(item, dict)],
        )


class InterfaceDef(BaseModel):
    type: str = "react-ui"
    id: str = ""
    label: str = ""
    description: Optional[str] = None
    binding: Optional[str] = None
    props: Dict[str, Any] = Field(default_factory=dict)
    events: Dict[str, Any] = Field(default_factory=dict)


_CONFIG_PLACEHOLDER_RE = re.compile(r"\$\{config\.([^}]+)\}")


class ServiceDef(BaseModel):
    metadata: ServiceMetadata
    config: ServiceConfig = Field(default_factory=ServiceConfig)
    pipelines: List[PipelineDef] = Field(default_factory=list)
    interfaces: List[InterfaceDef] = Field(default_factory=list)
    service_dir: Optional[Path] = None
    pipeline_dir: Optional[Path] = None

    @property
    def config_schema(self) -> Dict[str, ConfigField]:
        """하위 호환: ui_server 등에서 config_schema 로 스키마 조회."""
        return self.config.definitions

    def _resolve_config_placeholders(self, s: str) -> str:
        def repl(m: re.Match[str]) -> str:
            key = m.group(1).strip()
            val = self.config.values.get(key)
            if val is None:
                field = self.config.definitions.get(key)
                if field is not None and field.default is not None:
                    val = field.default
            if val is None:
                return m.group(0)
            return str(val)

        return _CONFIG_PLACEHOLDER_RE.sub(repl, s)

    def resolve_interface_props(self, iface: InterfaceDef) -> Dict[str, Any]:
        """interface.props 의 ${config.*} 를 현재 config 값으로 치환."""
        out: Dict[str, Any] = {}
        for k, v in (iface.props or {}).items():
            if isinstance(v, str):
                out[k] = self._resolve_config_placeholders(v)
            else:
                out[k] = v
        return out

    @classmethod
    def from_dict(cls, data: Dict[str, Any], *, service_dir: Optional[Path] = None) -> "ServiceDef":
        metadata = ServiceMetadata(**(data.get("service") or {}))
        pipelines = [PipelineDef.from_raw(p) for p in (data.get("pipelines") or []) if isinstance(p, dict)]
        # 스키마 키가 interface(단수)로 정의되어 있으므로 우선 단수를 사용
        interfaces_raw = data.get("interface")
        if interfaces_raw is None:
            interfaces_raw = data.get("interfaces") or []
        interfaces = [InterfaceDef(**item) for item in interfaces_raw if isinstance(item, dict)]
        return cls(
            metadata=metadata,
            config=ServiceConfig.from_schema(data.get("config")),
            pipelines=pipelines,
            interfaces=interfaces,
            service_dir=service_dir,
            pipeline_dir=service_dir,
        )

    @classmethod
    def from_yaml(cls, yaml_path: Path) -> "ServiceDef":
        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return cls.from_dict(data, service_dir=Path(yaml_path).parent)