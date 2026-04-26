/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class DefaultService {
    /**
     * Index
     * @returns string Successful Response
     * @throws ApiError
     */
    public static indexGet(): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/',
        });
    }
    /**
     * Serve Src
     * Vite/React 소스 디렉터리(/src*) 서빙. index.html이 /src/main.jsx 등을 요청할 때 사용.
     * @param path
     * @returns any Successful Response
     * @throws ApiError
     */
    public static serveSrcSrcPathGet(
        path: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/src/{path}',
            path: {
                'path': path,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Serve Assets
     * Vite 빌드 결과(/assets*) 서빙. dist/index.html이 /assets/... 를 참조할 때 사용.
     * @param path
     * @returns any Successful Response
     * @throws ApiError
     */
    public static serveAssetsAssetsPathGet(
        path: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/assets/{path}',
            path: {
                'path': path,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Service Info
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getServiceInfoApiServiceGet(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/service',
        });
    }
    /**
     * Get Interfaces
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getInterfacesApiInterfacesGet(): CancelablePromise<Array<Record<string, any>>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/interfaces',
        });
    }
    /**
     * Get Config
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getConfigApiConfigGet(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/config',
        });
    }
    /**
     * Update Config
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static updateConfigApiConfigPost(
        requestBody: Record<string, any>,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/config',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Publish Event
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static publishEventApiEventsPublishPost(
        requestBody: Record<string, any>,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/events/publish',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Models
     * LLM API /models 프록시 (모델 목록). 환경변수 LLM_API_BASE 사용.
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getModelsApiModelsGet(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/models',
        });
    }
    /**
     * List Files
     * 파일 시스템 목록 조회 API
     * @param path
     * @param pattern
     * @returns any Successful Response
     * @throws ApiError
     */
    public static listFilesApiFilesListGet(
        path: string = '.',
        pattern?: (string | null),
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/files/list',
            query: {
                'path': path,
                'pattern': pattern,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Gas Leak State
     * 구역/밸브/경광등/사이렌/MES 상태
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getGasLeakStateApiGasLeakStateGet(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/gas-leak/state',
        });
    }
    /**
     * Get Gas Leak Sensors
     * 센서 현재값 목록
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getGasLeakSensorsApiGasLeakSensorsGet(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/gas-leak/sensors',
        });
    }
    /**
     * Get Gas Leak Timeseries
     * 압력/유량/가스 농도 시계열 (실시간 차트용, 센서별 sensors 키)
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getGasLeakTimeseriesApiGasLeakTimeseriesGet(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/gas-leak/timeseries',
        });
    }
    /**
     * Get Gas Leak Drawings
     * 공장 도면 목록
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getGasLeakDrawingsApiGasLeakDrawingsGet(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/gas-leak/drawings',
        });
    }
    /**
     * Get Gas Leak Drawing
     * 도면 1건 + 센서(설치 위치) 목록
     * @param drawingId
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getGasLeakDrawingApiGasLeakDrawingsDrawingIdGet(
        drawingId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/gas-leak/drawings/{drawing_id}',
            path: {
                'drawing_id': drawingId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Gas Leak Drawing File
     * 도면 이미지 파일 스트리밍
     * @param drawingId
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getGasLeakDrawingFileApiGasLeakDrawingsDrawingIdFileGet(
        drawingId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/gas-leak/drawings/{drawing_id}/file',
            path: {
                'drawing_id': drawingId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Gas Leak Ai History
     * AI 판단 이력 목록 (최신순)
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getGasLeakAiHistoryApiGasLeakAiHistoryGet(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/gas-leak/ai-history',
        });
    }
    /**
     * Post Gas Leak Mes Status
     * MES 연동: 설비 가동 신호(Run/Stop) 및 작업 지시 수신 (오탐지 방지용)
     * @returns any Successful Response
     * @throws ApiError
     */
    public static postGasLeakMesStatusApiGasLeakMesStatusPost(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/gas-leak/mes-status',
        });
    }
    /**
     * Get Gas Leak Control History
     * 자동/수동 제어 실행 이력 (최신순)
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getGasLeakControlHistoryApiGasLeakControlHistoryGet(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/gas-leak/control-history',
        });
    }
    /**
     * Get Gas Leak Daily Usage
     * 금일 가스 사용량 추정(L) — 유량 시뮬 누적
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getGasLeakDailyUsageApiGasLeakDailyUsageGet(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/gas-leak/daily-usage',
        });
    }
    /**
     * Post Gas Leak Policy
     * 임계치·3단계·유예 시간 정책 저장
     * @returns any Successful Response
     * @throws ApiError
     */
    public static postGasLeakPolicyApiGasLeakPolicyPost(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/gas-leak/policy',
        });
    }
    /**
     * Post Gas Leak Cancel Auto Shutdown
     * 자동 차단 유예 취소
     * @returns any Successful Response
     * @throws ApiError
     */
    public static postGasLeakCancelAutoShutdownApiGasLeakCancelAutoShutdownPost(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/gas-leak/cancel-auto-shutdown',
        });
    }
    /**
     * Stream Events
     * SSE: 이벤트 버스 SSE 스트림을 프록시 (이벤트 발생 시 즉시 푸시). 쿼리(client_id, targeted_only 등) 전달.
     * @returns any Successful Response
     * @throws ApiError
     */
    public static streamEventsApiEventsStreamGet(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/events/stream',
        });
    }
}
