#!/bin/bash
# OutputReportBuilder 모듈 실행 스크립트

cd "$(dirname "$0")"
python3 -m SagoHub.runner.module_runner output_report_builder.OutputReportBuilderModule
