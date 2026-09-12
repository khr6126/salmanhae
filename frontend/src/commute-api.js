// frontend/.env.local에서 설정합니다. 값이 없으면 같은 컴퓨터의 백엔드에 연결합니다.
export const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '')
export const DEMO_MODE = false
export const COMMUTE_DAYS = 20

async function post(path, body, signal) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('서버에 연결하지 못했어요. 백엔드 실행 상태와 연결 주소, CORS 설정을 확인해주세요.')
  }
  let data
  try { data = await response.json() }
  catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('서버 응답을 읽지 못했어요. 백엔드 주소를 확인해주세요.')
  }
  if (!response.ok) {
    const detail = data?.detail
    const message = typeof detail === 'string' ? detail
      : Array.isArray(detail) ? detail.map(item => `${item.loc?.slice(1).join('.') || '입력'}: ${item.msg}`).join(' / ')
        : `요청에 실패했어요. (HTTP ${response.status})`
    throw new Error(message)
  }
  return data
}

export function getCommuteData(request, signal) {
  return post('/api/commute/calculate', {
    home_address: request.homeAddress,
    destination_address: request.destinationAddress,
    transport_mode: request.transport,
  }, signal)
}

export async function getPropertiesData(request, signal) {
  const data = await post('/api/properties/evaluate', {
    destination_address: request.destinationAddress,
    transport_mode: request.transport,
  }, signal)
  if (!Array.isArray(data?.properties)) throw new Error('매물 목록 응답 형식이 올바르지 않아요.')
  return data
}

function number(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} 정보가 없거나 올바르지 않아요.`)
  }
  return value
}

// 기존 화면에서 사용하는 이름으로 변환합니다. 비용은 다시 계산하지 않습니다.
export function calculateCommute(data, transport) {
  if (data.transport_mode !== transport) throw new Error('요청한 이동수단과 서버 응답이 다릅니다.')
  return {
    minutes: number(data.round_trip_time_minutes, '왕복 시간'),
    km: number(data.round_trip_distance_km, '왕복 거리'),
    wage: number(data.assumptions?.minimum_wage, '시급'),
    days: number(data.assumptions?.commute_days_per_month, '통근일수'),
    monthlyTravel: number(data.monthly_transport_cost, '월 이동 비용'),
    monthlyTime: number(data.monthly_opportunity_cost, '월 시간 비용'),
    total: number(data.monthly_total_cost, '월 전체 비용'),
  }
}
