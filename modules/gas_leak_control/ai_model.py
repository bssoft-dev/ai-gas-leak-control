from typing import Any, Dict, List

from gas_leak_data import load_json, path, save_json, utc_now


class GasLeakAIModel:
    """
    가스 누출 AI 엣지 추론 모델 (Mock/시뮬레이터)
    추후 실제 ONNX/TensorRT 기반 LSTM-Autoencoder 모델로 교체할 수 있는 구조입니다.
    """

    def __init__(self):
        self.baseline_pressure = 0.40
        self.baseline_flow = 12.0
        self._load_registry()

    def _load_registry(self) -> None:
        reg = load_json(path("ai_models.json"), {"active_version": "v1.0.0-mock", "versions": []})
        self.active_version = reg.get("active_version", "v1.0.0-mock")
        self.versions: List[Dict[str, Any]] = reg.get("versions") or []

    def register_version(self, version: str, accuracy: float = 0.0, recall: float = 0.0) -> None:
        reg = load_json(path("ai_models.json"), {"active_version": version, "versions": []})
        versions = reg.get("versions") or []
        versions.append(
            {
                "version": version,
                "accuracy": accuracy,
                "recall": recall,
                "registered_at": utc_now(),
            }
        )
        reg["versions"] = versions[-50:]
        reg["active_version"] = version
        save_json(path("ai_models.json"), reg)
        self._load_registry()

    def flow_imbalance_score(self, window: List[Dict[str, float]]) -> float:
        """유량 불균형 패턴 점수 (구간 간 유량 편차)."""
        if len(window) < 2:
            return 0.0
        flows = [w.get("flow", self.baseline_flow) for w in window]
        return abs(max(flows) - min(flows))

    def pressure_drop_correlation(self, window: List[Dict[str, float]]) -> float:
        """압력 하강·유량 상승 상관 (누출 시그니처)."""
        if len(window) < 2:
            return 0.0
        score = 0.0
        for i in range(1, len(window)):
            p0, p1 = window[i - 1].get("pressure", 0.4), window[i].get("pressure", 0.4)
            f0, f1 = window[i - 1].get("flow", 12.0), window[i].get("flow", 12.0)
            if p1 < p0 and f1 > f0:
                score += (p0 - p1) + (f1 - f0) * 0.01
        return score / (len(window) - 1)

    def predict(self, window: List[Dict[str, float]]) -> float:
        """
        시계열 윈도우 데이터를 받아 재구성 오차(Reconstruction Error, MSE)를 계산합니다.
        window: [{'pressure': 0.40, 'flow': 12.0, 'concentration': 1.0}, ...]
        반환값: 재구성 오차 (float). 임계치 초과 시 이상으로 간주합니다.
        """
        if not window:
            return 0.0
            
        error_sum = 0.0
        
        # 윈도우 내 데이터 변동성 및 기준치 이탈 계산 (임시 휴리스틱 모사 로직)
        for data in window:
            p = data.get('pressure', self.baseline_pressure)
            f = data.get('flow', self.baseline_flow)
            
            # 압력 오차 (0.40 기준 변동)
            p_error = (p - self.baseline_pressure) ** 2
            # 유량 오차 (12.0 기준 변동)
            f_error = (f - self.baseline_flow) ** 2
            
            # 압력이 0.45를 넘거나 유량이 13.5를 넘으면 오차를 크게 증폭 (이상 탐지 모사)
            if p > 0.45:
                p_error += 0.2
            if f > 13.5:
                f_error += 0.2
                
            error_sum += p_error + (f_error * 0.01) # 스케일 조정
            
        mse = error_sum / len(window)
        mse += self.flow_imbalance_score(window) * 0.02
        mse += self.pressure_drop_correlation(window) * 0.5
        return mse

    def metrics(self) -> Dict[str, Any]:
        """모델 정확도·재현율 조회 (등록 버전 기준)."""
        reg = load_json(path("ai_models.json"), {})
        active = reg.get("active_version")
        for v in reg.get("versions") or []:
            if v.get("version") == active:
                return {
                    "version": active,
                    "accuracy": v.get("accuracy", 0.92),
                    "recall": v.get("recall", 0.88),
                }
        return {"version": active or "v1.0.0-mock", "accuracy": 0.92, "recall": 0.88}
