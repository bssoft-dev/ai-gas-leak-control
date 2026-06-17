#!/bin/bash
# User Interest 모듈 실행 스크립트 (founds 이벤트 기반 사용자 관심사 추론)

cd "$(dirname "$0")"
python3 -m SagoHub.runner.module_runner user_interest.UserInterestModule
