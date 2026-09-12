import asyncio
import os
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

load_dotenv()

app = FastAPI()

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
        fare = properties.get("fare", {}).get("value")

        if fare is None:
            raise HTTPException(422, "선택한 대중교통 경로의 요금을 확인할 수 없습니다.")

        return {
            "duration_seconds": properties["totalTime"],
            "distance_meters": properties["totalDistance"],
            "transport_cost": fare,
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
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/commute/calculate")
async def calculate_commute(request: CommuteRequest):
    api_key = os.getenv("KAKAO_REST_API_KEY")

    if not api_key:
        raise HTTPException(500, "KAKAO_REST_API_KEY가 설정되지 않았습니다.")

    async with httpx.AsyncClient(
        headers={"Authorization": f"KakaoAK {api_key}"},
        timeout=15.0,
    ) as client:
        home, destination = await asyncio.gather(
            address_to_coordinates(client, request.home_address),
            address_to_coordinates(client, request.destination_address),
        )

        outbound, inbound = await asyncio.gather(
            get_one_way_route(
                client, home, destination, request.transport_mode
            ),
            get_one_way_route(
                client, destination, home, request.transport_mode
            ),
        )

    round_trip_seconds = (
        outbound["duration_seconds"]
        + inbound["duration_seconds"]
    )

    daily_transport_cost = (
        outbound["transport_cost"]
        + inbound["transport_cost"]
    )
    daily_opportunity_cost = (
        round_trip_seconds / 3600 * MINIMUM_WAGE
    )
    daily_total_cost = daily_transport_cost + daily_opportunity_cost

    return {
        "home_address": request.home_address,
        "destination_address": request.destination_address,
        "transport_mode": request.transport_mode,
        "home_coordinates": home,
        "destination_coordinates": destination,

        # 기존 one_way 필드는 가는 길 기준
        "one_way_time_minutes": round(
            outbound["duration_seconds"] / 60, 1
        ),
        "return_time_minutes": round(
            inbound["duration_seconds"] / 60, 1
        ),
        "round_trip_time_minutes": round(round_trip_seconds / 60, 1),
        "round_trip_distance_km": round(
            (
                outbound["distance_meters"]
                + inbound["distance_meters"]
            ) / 1000,
            2,
        ),

        "daily_transport_cost": round(daily_transport_cost),
        "daily_opportunity_cost": round(daily_opportunity_cost),
        "daily_total_cost": round(daily_total_cost),

        "monthly_transport_cost": round(
            daily_transport_cost * COMMUTE_DAYS_PER_MONTH
        ),
        "monthly_opportunity_cost": round(
            daily_opportunity_cost * COMMUTE_DAYS_PER_MONTH
        ),
        "monthly_total_cost": round(
            daily_total_cost * COMMUTE_DAYS_PER_MONTH
        ),

        "assumptions": {
            "minimum_wage": MINIMUM_WAGE,
            "commute_days_per_month": COMMUTE_DAYS_PER_MONTH,
            "fuel_efficiency_km_per_liter": (
                AVERAGE_FUEL_EFFICIENCY
                if request.transport_mode == "car" else None
            ),
            "fuel_price_per_liter": (
                FUEL_PRICE
                if request.transport_mode == "car" else None
            ),
            "fuel_price_source": (
                "fixed_assumption"
                if request.transport_mode == "car" else None
            ),
        },
    }