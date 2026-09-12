import asyncio
import os
import json
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

load_dotenv()

app = FastAPI()

# 프론트엔드 주소를 허용합니다. 배포 시 .env의 CORS_ORIGINS에 실제 주소를 넣으세요.
# 여러 주소는 쉼표로 구분합니다. 주소 끝에 /를 붙이지 않습니다.
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# 초기 계산 가정값
MINIMUM_WAGE = 10320
COMMUTE_DAYS_PER_MONTH = 20

AVERAGE_FUEL_EFFICIENCY = 10.0  # km/L
FUEL_PRICE = 1800  # 원/L


class CommuteRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    home_address: str = Field(min_length=1, max_length=300)
    destination_address: str = Field(min_length=1, max_length=300)
    transport_mode: Literal["public", "car"]


async def kakao_get(client, url, params):
    try:
        response = await client.get(url, params=params)
        response.raise_for_status()
        return response.json()

    except httpx.TimeoutException:
        raise HTTPException(
            504, "카카오 API 응답 시간이 초과되었습니다."
        )

    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code

        # 개발 중 오류 확인용
        error_text = exc.response.text
        api_key = os.getenv("KAKAO_REST_API_KEY")

        if api_key:
            error_text = error_text.replace(api_key, "[REDACTED]")

        print("카카오 요청 경로:", exc.request.url.path)
        print("카카오 응답 상태:", status)
        print("카카오 오류 내용:", error_text)

        if status == 429:
            raise HTTPException(
                503, "경로 조회 한도를 초과했습니다."
            )

        if status in (401, 403):
            raise HTTPException(
                502,
                "서버의 카카오 API 키 또는 사용 설정을 확인해주세요."
            )

        raise HTTPException(
            502, "카카오 API 요청에 실패했습니다."
        )

    except (httpx.RequestError, ValueError):
        raise HTTPException(
            502, "카카오 API 응답을 처리하지 못했습니다."
        )


async def address_to_coordinates(client, address):
    data = await kakao_get(
        client,
        "https://dapi.kakao.com/v2/local/search/address.json",
        {"query": address},
    )

    documents = data.get("documents", [])

    if not documents:
        raise HTTPException(422, "주소를 찾을 수 없습니다. 정확한 주소를 입력해주세요.")

    if len(documents) != 1:
        raise HTTPException(422, "검색 결과가 여러 개입니다. 주소를 더 구체적으로 입력해주세요.")

    document = documents[0]

    if document.get("address_type") not in ("REGION_ADDR", "ROAD_ADDR"):
        raise HTTPException(422, "건물 번호까지 포함한 주소를 입력해주세요.")

    return {
        "x": document["x"],  # 경도
        "y": document["y"],  # 위도
    }


async def get_one_way_route(client, origin, destination, mode):
    if mode == "public":
        data = await kakao_get(
            client,
            "https://dapi.kakao.com/v2/routing/publictraffic",
            {
                "start_x": origin["x"],
                "start_y": origin["y"],
                "end_x": destination["x"],
                "end_y": destination["y"],
            },
        )

        routes = data.get("routes", [])

        if data.get("status") != "OK" or not routes:
            raise HTTPException(422, "이 구간의 대중교통 경로를 찾을 수 없습니다.")

        route = min(
            routes,
            key=lambda item: item["properties"]["totalTime"],
        )
        properties = route["properties"]
        # fare 자체가 null인 응답도 처리합니다. 0원은 정상 요금입니다.
        fare = (properties.get("fare") or {}).get("value")

        if fare is None:
            # 기존 정책 유지: 요금이 없으면 별도 도보 경로를 조회합니다.
            return await get_walking_route(client, origin, destination)

        # 대중교통 결과를 반환하여 자동차 계산으로 넘어가지 않게 합니다.
        return {
            "duration_seconds": properties["totalTime"],
            "distance_meters": properties["totalDistance"],
            "transport_cost": fare,
            "route_type": "public",
        }

    data = await kakao_get(
        client,
        "https://apis-navi.kakaomobility.com/v1/directions",
        {
            "origin": f'{origin["x"]},{origin["y"]}',
            "destination": f'{destination["x"]},{destination["y"]}',
            "priority": "RECOMMEND",
            "summary": "true",
        },
    )

    routes = data.get("routes", [])

    if not routes or routes[0].get("result_code") != 0:
        raise HTTPException(422, "이 구간의 자동차 경로를 찾을 수 없습니다.")

    summary = routes[0]["summary"]
    distance_km = summary["distance"] / 1000

    fuel_cost = (
        distance_km
        / AVERAGE_FUEL_EFFICIENCY
        * FUEL_PRICE
    )

    return {
        "duration_seconds": summary["duration"],
        "distance_meters": summary["distance"],
        "transport_cost": fuel_cost,
        "route_type": "car",
    }

async def get_walking_route(client, origin, destination):
    data = await kakao_get(
        client,
        "https://dapi.kakao.com/v2/routing/walk",
        {
            "start_x": origin["x"],
            "start_y": origin["y"],
            "end_x": destination["x"],
            "end_y": destination["y"],
            "route_mode": "SHORTEST",
        },
    )

    if data.get("status") != "OK" or "route" not in data:
        raise HTTPException(
            422,
            "도보 경로를 찾을 수 없습니다."
        )

    properties = data["route"]["properties"]

    return {
        "duration_seconds": properties["totalTime"],
        "distance_meters": properties["totalDistance"],
        "transport_cost": 0,
        "route_type": "walk"
    }

# 개발용 금리 가정입니다. 현재 실제 기준금리를 의미하지 않습니다.
ANNUAL_BASE_RATE = 0.025
BASE_DIR = Path(__file__).resolve().parent


class PropertyData(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    id: int = Field(gt=0)
    name: str = Field(min_length=1)
    address: str = Field(min_length=1, max_length=300)
    deposit: int = Field(ge=0)
    monthlyRent: int = Field(ge=0)
    maintenanceFee: int = Field(ge=0)


class PropertyEvaluateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    destination_address: str = Field(min_length=1, max_length=300)
    transport_mode: Literal["public", "car"]


with (BASE_DIR / "data" / "mock_properties.json").open(encoding="utf-8") as file:
    MOCK_PROPERTIES = [PropertyData.model_validate(item) for item in json.load(file)]

if len({item.id for item in MOCK_PROPERTIES}) != len(MOCK_PROPERTIES):
    raise ValueError("매물 ID는 중복될 수 없습니다.")


def won(value):
    """원 단위 사사오입. 표시 항목을 합산해 영수증 합계를 맞춥니다."""
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def get_api_key():
    api_key = os.getenv("KAKAO_REST_API_KEY")
    if not api_key:
        raise HTTPException(500, "KAKAO_REST_API_KEY가 설정되지 않았습니다.")
    return api_key


def calculation_assumptions(mode):
    return {
        "minimum_wage": MINIMUM_WAGE,
        "commute_days_per_month": COMMUTE_DAYS_PER_MONTH,
        "fuel_efficiency_km_per_liter": AVERAGE_FUEL_EFFICIENCY if mode == "car" else None,
        "fuel_price_per_liter": FUEL_PRICE if mode == "car" else None,
        "fuel_price_source": "fixed_assumption" if mode == "car" else None,
    }


async def calculate_round_trip_cost(client, origin, destination, mode):
    outbound, inbound = await asyncio.gather(
        get_one_way_route(client, origin, destination, mode),
        get_one_way_route(client, destination, origin, mode),
    )
    seconds = outbound["duration_seconds"] + inbound["duration_seconds"]
    transport = outbound["transport_cost"] + inbound["transport_cost"]
    opportunity = seconds / 3600 * MINIMUM_WAGE
    daily_transport = won(transport)
    daily_opportunity = won(opportunity)
    # 월 비용은 반올림 전의 하루 비용을 기준으로 계산합니다.
    monthly_transport = won(transport * COMMUTE_DAYS_PER_MONTH)
    monthly_opportunity = won(opportunity * COMMUTE_DAYS_PER_MONTH)
    return {
        # public 요청이어도 도보로 대체된 구간을 화면에서 구별할 수 있습니다.
        "outbound_route_type": outbound["route_type"],
        "inbound_route_type": inbound["route_type"],
        "one_way_time_minutes": round(outbound["duration_seconds"] / 60, 1),
        "return_time_minutes": round(inbound["duration_seconds"] / 60, 1),
        "round_trip_time_minutes": round(seconds / 60, 1),
        "round_trip_distance_km": round(
            (outbound["distance_meters"] + inbound["distance_meters"]) / 1000, 2
        ),
        "daily_transport_cost": daily_transport,
        "daily_opportunity_cost": daily_opportunity,
        "daily_total_cost": daily_transport + daily_opportunity,
        "monthly_transport_cost": monthly_transport,
        "monthly_opportunity_cost": monthly_opportunity,
        "monthly_total_cost": monthly_transport + monthly_opportunity,
    }


def calculate_housing_cost(property_data):
    deposit_cost = won(
        Decimal(property_data.deposit) * Decimal(str(ANNUAL_BASE_RATE)) / 12
    )
    return {
        "monthly_rent": property_data.monthlyRent,
        "monthly_maintenance_fee": property_data.maintenanceFee,
        "monthly_deposit_opportunity_cost": deposit_cost,
        "monthly_housing_cost": (
            property_data.monthlyRent + property_data.maintenanceFee + deposit_cost
        ),
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/commute/calculate")
async def calculate_commute(request: CommuteRequest):
    api_key = get_api_key()
    async with httpx.AsyncClient(
        headers={"Authorization": f"KakaoAK {api_key}"}, timeout=15.0
    ) as client:
        home, destination = await asyncio.gather(
            address_to_coordinates(client, request.home_address),
            address_to_coordinates(client, request.destination_address),
        )
        costs = await calculate_round_trip_cost(
            client, home, destination, request.transport_mode
        )
    return {
        "home_address": request.home_address,
        "destination_address": request.destination_address,
        "transport_mode": request.transport_mode,
        "home_coordinates": home,
        "destination_coordinates": destination,
        **costs,
        "assumptions": calculation_assumptions(request.transport_mode),
    }


@app.post("/api/properties/evaluate")
async def evaluate_properties(request: PropertyEvaluateRequest):
    api_key = get_api_key()
    results = []
    # 한 요청 안에서 같은 주소의 좌표와 왕복 경로를 재사용합니다.
    address_results = {}
    async with httpx.AsyncClient(
        headers={"Authorization": f"KakaoAK {api_key}"}, timeout=15.0
    ) as client:
        destination = await address_to_coordinates(client, request.destination_address)
        for address in dict.fromkeys(item.address for item in MOCK_PROPERTIES):
            coordinates = None
            try:
                coordinates = await address_to_coordinates(client, address)
                commute = await calculate_round_trip_cost(
                    client, coordinates, destination, request.transport_mode
                )
                address_results[address] = {
                    "coordinates": coordinates, "commute": commute, "error": None
                }
            except HTTPException as exc:
                # 서버/API 인증·한도 장애는 전체 요청의 오류로 전달합니다.
                if exc.status_code != 422:
                    raise
                address_results[address] = {
                    "coordinates": coordinates, "commute": None, "error": exc.detail
                }

    for property_data in MOCK_PROPERTIES:
        route_result = address_results[property_data.address]
        housing = calculate_housing_cost(property_data)
        commute = route_result["commute"]
        costs = {
            **housing,
            "monthly_transport_cost": None,
            "monthly_opportunity_cost": None,
            "monthly_cash_expense": None,
            "monthly_total_cost": None,
        }
        if commute is not None:
            costs.update({
                "monthly_transport_cost": commute["monthly_transport_cost"],
                "monthly_opportunity_cost": commute["monthly_opportunity_cost"],
                "monthly_cash_expense": (
                    property_data.monthlyRent + property_data.maintenanceFee
                    + commute["monthly_transport_cost"]
                ),
                "monthly_total_cost": (
                    housing["monthly_housing_cost"] + commute["monthly_total_cost"]
                ),
            })
        results.append({
            **property_data.model_dump(),
            "coordinates": route_result["coordinates"],
            "calculation_status": "ok" if commute is not None else "unavailable",
            "error": route_result["error"],
            "commute": commute,
            "costs": costs,
        })

    # 계산 가능한 매물부터 비용순 정렬. 실패 매물은 금액 없이 마지막에 표시합니다.
    results.sort(key=lambda item: (
        item["costs"]["monthly_total_cost"] is None,
        item["costs"]["monthly_total_cost"] if item["costs"]["monthly_total_cost"] is not None else 0,
        item["id"],
    ))
    return {
        "destination_address": request.destination_address,
        "destination_coordinates": destination,
        "transport_mode": request.transport_mode,
        "data_source": "mock",
        "search_scope": "all_mock_properties",
        "assumptions": {
            **calculation_assumptions(request.transport_mode),
            "annual_base_rate": ANNUAL_BASE_RATE,
            "base_rate_source": "development_assumption",
        },
        "properties": results,
    }
